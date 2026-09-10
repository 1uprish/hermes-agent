#!/usr/bin/env python3
"""Prepare the pinned imsg release once, then delegate to it.

The helper deliberately uses only the Python standard library.  It is the
single entrypoint the iMessage skill calls, so first use and later reuse have
the same execution path.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TextIO


def _add_runtime_to_import_path() -> None:
    """Find hermes_constants from a checkout or an installed runtime."""
    checkout_root = Path(__file__).resolve().parents[4]
    candidates = [checkout_root]

    configured_home = os.environ.get("HERMES_HOME", "").strip()
    if configured_home:
        configured_path = Path(configured_home).expanduser()
        hermes_root = (
            configured_path.parent.parent
            if configured_path.parent.name == "profiles"
            else configured_path
        )
        candidates.append(hermes_root / "hermes-agent")

    candidates.append(Path.home() / ".hermes" / "hermes-agent")
    for candidate in candidates:
        if (candidate / "hermes_constants.py").is_file():
            candidate_text = str(candidate)
            if candidate_text not in sys.path:
                sys.path.insert(0, candidate_text)
            return


_add_runtime_to_import_path()

from hermes_constants import get_default_hermes_root  # noqa: E402


@dataclass(frozen=True)
class ReleaseSpec:
    version: str
    url: str
    archive_sha256: str
    archive_size: int


RELEASE = ReleaseSpec(
    version="0.15.3",
    url="https://github.com/openclaw/imsg/releases/download/v0.15.3/imsg-macos.zip",
    archive_sha256="97accf99be783ad605c01b441556de0bd40b74233d98da50ca7a43d996a6ee68",
    archive_size=3_925_978,
)

_EXPECTED_IDENTIFIER = "com.steipete.imsg"
_EXPECTED_TEAM_ID = "Y5PE65HELJ"
_MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024
_RESOURCE_FILES = {
    "SQLite.swift_SQLite.bundle/PrivacyInfo.xcprivacy",
    "PhoneNumberKit_PhoneNumberKit.bundle/PhoneNumberMetadata.json",
    "PhoneNumberKit_PhoneNumberKit.bundle/PrivacyInfo.xcprivacy",
}
_REQUIRED_ARCHIVE_FILES = {"imsg", *_RESOURCE_FILES}


class CapabilityPreparationError(RuntimeError):
    """The pinned Messages capability could not be prepared safely."""


def _download(url: str, destination: Path, max_bytes: int) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "MacMan/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            length_header = response.headers.get("Content-Length")
            if length_header and int(length_header) > max_bytes:
                raise CapabilityPreparationError("Messages support download is too large")

            received = 0
            with destination.open("xb") as output:
                while chunk := response.read(128 * 1024):
                    received += len(chunk)
                    if received > max_bytes:
                        raise CapabilityPreparationError(
                            "Messages support download exceeded its size limit"
                        )
                    output.write(chunk)
    except CapabilityPreparationError:
        raise
    except Exception as exc:
        raise CapabilityPreparationError(
            f"Messages support download failed: {exc}"
        ) from exc


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(128 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_verified_archive(archive: Path, destination: Path) -> None:
    try:
        with zipfile.ZipFile(archive) as bundle:
            infos = bundle.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise CapabilityPreparationError(
                    "Messages support archive contains duplicate files"
                )

            available = set(names)
            missing = _REQUIRED_ARCHIVE_FILES - available
            if missing:
                raise CapabilityPreparationError(
                    "Messages support archive is incomplete: " + ", ".join(sorted(missing))
                )

            approved_infos = [
                info for info in infos if info.filename in _REQUIRED_ARCHIVE_FILES
            ]
            if sum(info.file_size for info in approved_infos) > _MAX_UNCOMPRESSED_BYTES:
                raise CapabilityPreparationError(
                    "Messages support archive exceeds its extracted size limit"
                )

            for info in approved_infos:
                output = destination / info.filename
                output.parent.mkdir(parents=True, exist_ok=True)
                contents = bundle.read(info)
                if len(contents) != info.file_size:
                    raise CapabilityPreparationError(
                        f"Messages support archive entry is truncated: {info.filename}"
                    )
                output.write_bytes(contents)
    except CapabilityPreparationError:
        raise
    except (OSError, zipfile.BadZipFile) as exc:
        raise CapabilityPreparationError(
            f"Messages support archive could not be unpacked: {exc}"
        ) from exc


def _verify_macos_signature(binary: Path) -> None:
    try:
        subprocess.run(
            ["/usr/bin/codesign", "--verify", "--strict", "--verbose=2", str(binary)],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        details = subprocess.run(
            ["/usr/bin/codesign", "-d", "--verbose=4", str(binary)],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CapabilityPreparationError(
            f"Messages support signature verification failed: {exc}"
        ) from exc

    signature_details = f"{details.stdout}\n{details.stderr}"
    if f"Identifier={_EXPECTED_IDENTIFIER}" not in signature_details:
        raise CapabilityPreparationError(
            "Messages support has an unexpected signing identifier"
        )
    if f"TeamIdentifier={_EXPECTED_TEAM_ID}" not in signature_details:
        raise CapabilityPreparationError("Messages support has an unexpected signer")


def _read_version(binary: Path) -> str:
    try:
        result = subprocess.run(
            [str(binary), "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise CapabilityPreparationError(
            f"Messages support version check failed: {exc}"
        ) from exc
    return result.stdout.strip()


def _receipt_matches(receipt_path: Path, release: ReleaseSpec) -> bool:
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return False
    return receipt == {
        "archive_sha256": release.archive_sha256,
        "identifier": _EXPECTED_IDENTIFIER,
        "team_id": _EXPECTED_TEAM_ID,
        "version": release.version,
    }


def _install_is_valid(
    install_dir: Path,
    release: ReleaseSpec,
    signature_checker: Callable[[Path], None],
    version_reader: Callable[[Path], str],
) -> bool:
    binary = install_dir / "imsg"
    if not binary.is_file() or not _receipt_matches(install_dir / "receipt.json", release):
        return False
    if any(not (install_dir / resource).is_file() for resource in _RESOURCE_FILES):
        return False
    try:
        signature_checker(binary)
        return version_reader(binary) == release.version
    except Exception:
        return False


def _write_receipt(destination: Path, release: ReleaseSpec) -> None:
    receipt = {
        "archive_sha256": release.archive_sha256,
        "identifier": _EXPECTED_IDENTIFIER,
        "team_id": _EXPECTED_TEAM_ID,
        "version": release.version,
    }
    (destination / "receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def ensure_imsg(
    capability_root: Path | None = None,
    *,
    release: ReleaseSpec = RELEASE,
    downloader: Callable[[str, Path, int], None] = _download,
    signature_checker: Callable[[Path], None] = _verify_macos_signature,
    version_reader: Callable[[Path], str] = _read_version,
    stderr: TextIO = sys.stderr,
) -> Path:
    """Return a verified persistent imsg binary, preparing it on first use."""
    root = capability_root or (get_default_hermes_root() / "capabilities")
    tool_root = root / "imsg"
    install_dir = tool_root / release.version
    binary = install_dir / "imsg"
    tool_root.mkdir(parents=True, exist_ok=True)

    lock_path = tool_root / ".install.lock"
    with lock_path.open("a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)

        if _install_is_valid(
            install_dir, release, signature_checker, version_reader
        ):
            return binary

        print("Preparing Messages support...", file=stderr, flush=True)
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=tool_root) as temp_dir:
            temp_root = Path(temp_dir)
            archive = temp_root / "imsg-macos.zip"
            staged_install = temp_root / release.version

            print("Downloading signed Messages support...", file=stderr, flush=True)
            downloader(release.url, archive, _MAX_DOWNLOAD_BYTES)
            try:
                archive_size = archive.stat().st_size
            except OSError as exc:
                raise CapabilityPreparationError(
                    "Messages support download did not produce an archive"
                ) from exc
            if archive_size != release.archive_size:
                raise CapabilityPreparationError(
                    "Messages support download size did not match the pinned release"
                )
            if _sha256(archive) != release.archive_sha256:
                raise CapabilityPreparationError(
                    "Messages support download checksum did not match the pinned release"
                )

            staged_install.mkdir()
            _extract_verified_archive(archive, staged_install)
            staged_binary = staged_install / "imsg"
            staged_binary.chmod(0o755)

            print("Verifying Messages support...", file=stderr, flush=True)
            signature_checker(staged_binary)
            installed_version = version_reader(staged_binary)
            if installed_version != release.version:
                raise CapabilityPreparationError(
                    "Messages support version did not match the pinned release"
                )
            _write_receipt(staged_install, release)

            if install_dir.exists():
                shutil.rmtree(install_dir)
            os.replace(staged_install, install_dir)

        print("Messages support ready.", file=stderr, flush=True)
        return binary


def main(
    argv: list[str] | None = None,
    *,
    ensure: Callable[[], Path] = ensure_imsg,
    execv: Callable[[str, list[str]], object] = os.execv,
    platform: str = sys.platform,
) -> None:
    if platform != "darwin":
        raise CapabilityPreparationError("Messages support is available only on macOS")
    arguments = list(sys.argv[1:] if argv is None else argv)
    binary = ensure()
    execv(str(binary), [str(binary), *arguments])


if __name__ == "__main__":
    try:
        main()
    except CapabilityPreparationError as exc:
        print(f"Messages support could not be prepared: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
