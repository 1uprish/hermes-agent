from __future__ import annotations

import builtins
import hashlib
import importlib.util
import io
import sys
import threading
import time
import zipfile
from pathlib import Path
from types import ModuleType

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = REPO_ROOT / "skills" / "apple" / "imessage"
HELPER_PATH = SKILL_DIR / "scripts" / "imsg.py"

_RESOURCE_FILES = {
    "SQLite.swift_SQLite.bundle/PrivacyInfo.xcprivacy": b"sqlite privacy",
    "PhoneNumberKit_PhoneNumberKit.bundle/PhoneNumberMetadata.json": b"{}",
    "PhoneNumberKit_PhoneNumberKit.bundle/PrivacyInfo.xcprivacy": b"phone privacy",
}


@pytest.fixture(scope="module")
def imsg_module() -> ModuleType:
    assert HELPER_PATH.is_file(), f"missing bundled capability helper: {HELPER_PATH}"
    module_name = "hermes_test_imessage_capability"
    spec = importlib.util.spec_from_file_location(module_name, HELPER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _archive_bytes(tmp_path: Path, *, binary: bytes = b"signed imsg binary") -> bytes:
    archive = tmp_path / "fixture.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("imsg", binary)
        for name, contents in _RESOURCE_FILES.items():
            bundle.writestr(name, contents)
    return archive.read_bytes()


def _release(imsg_module: ModuleType, archive: bytes):
    return imsg_module.ReleaseSpec(
        version="9.8.7",
        url="https://example.invalid/imsg.zip",
        archive_sha256=hashlib.sha256(archive).hexdigest(),
        archive_size=len(archive),
    )


def _write_downloader(archive: bytes, calls: list[str]):
    def download(url: str, destination: Path, max_bytes: int) -> None:
        calls.append(url)
        assert len(archive) <= max_bytes
        destination.write_bytes(archive)

    return download


def _verify_fixture_signature(binary: Path) -> None:
    assert binary.read_bytes() == b"signed imsg binary"


def _fixture_version(_binary: Path) -> str:
    return "9.8.7"


def test_first_use_prepares_verifies_and_persists_capability(
    imsg_module: ModuleType, tmp_path: Path
) -> None:
    archive = _archive_bytes(tmp_path)
    calls: list[str] = []
    progress = io.StringIO()

    binary = imsg_module.ensure_imsg(
        tmp_path / "capabilities",
        release=_release(imsg_module, archive),
        downloader=_write_downloader(archive, calls),
        signature_checker=_verify_fixture_signature,
        version_reader=_fixture_version,
        stderr=progress,
    )

    assert binary.is_file()
    assert binary.stat().st_mode & 0o111
    assert (binary.parent / "receipt.json").is_file()
    assert calls == ["https://example.invalid/imsg.zip"]
    assert progress.getvalue().splitlines() == [
        "Preparing Messages support...",
        "Downloading signed Messages support...",
        "Verifying Messages support...",
        "Messages support ready.",
    ]


def test_later_use_reuses_verified_install_without_downloading(
    imsg_module: ModuleType, tmp_path: Path
) -> None:
    archive = _archive_bytes(tmp_path)
    calls: list[str] = []
    kwargs = {
        "release": _release(imsg_module, archive),
        "downloader": _write_downloader(archive, calls),
        "signature_checker": _verify_fixture_signature,
        "version_reader": _fixture_version,
    }

    first = imsg_module.ensure_imsg(tmp_path / "capabilities", **kwargs)
    second_progress = io.StringIO()
    second = imsg_module.ensure_imsg(
        tmp_path / "capabilities", **kwargs, stderr=second_progress
    )

    assert first == second
    assert calls == ["https://example.invalid/imsg.zip"]
    assert second_progress.getvalue() == ""


def test_concurrent_first_use_downloads_only_once(
    imsg_module: ModuleType, tmp_path: Path
) -> None:
    archive = _archive_bytes(tmp_path)
    calls: list[str] = []
    calls_lock = threading.Lock()

    def slow_download(_url: str, destination: Path, _max_bytes: int) -> None:
        with calls_lock:
            calls.append("download")
        time.sleep(0.05)
        destination.write_bytes(archive)

    results: list[Path] = []
    errors: list[BaseException] = []

    def prepare() -> None:
        try:
            results.append(
                imsg_module.ensure_imsg(
                    tmp_path / "capabilities",
                    release=_release(imsg_module, archive),
                    downloader=slow_download,
                    signature_checker=_verify_fixture_signature,
                    version_reader=_fixture_version,
                    stderr=io.StringIO(),
                )
            )
        except BaseException as exc:  # pragma: no cover - assertion reports details
            errors.append(exc)

    threads = [threading.Thread(target=prepare) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert not errors
    assert not any(thread.is_alive() for thread in threads)
    assert len(results) == 2 and results[0] == results[1]
    assert calls == ["download"]


def test_checksum_failure_never_publishes_partial_install(
    imsg_module: ModuleType, tmp_path: Path
) -> None:
    archive = _archive_bytes(tmp_path)
    release = imsg_module.ReleaseSpec(
        version="9.8.7",
        url="https://example.invalid/imsg.zip",
        archive_sha256="0" * 64,
        archive_size=len(archive),
    )

    with pytest.raises(imsg_module.CapabilityPreparationError, match="checksum"):
        imsg_module.ensure_imsg(
            tmp_path / "capabilities",
            release=release,
            downloader=_write_downloader(archive, []),
            signature_checker=_verify_fixture_signature,
            version_reader=_fixture_version,
            stderr=io.StringIO(),
        )

    assert not (tmp_path / "capabilities" / "imsg" / "9.8.7").exists()


def test_corrupt_cached_binary_is_replaced(
    imsg_module: ModuleType, tmp_path: Path
) -> None:
    archive = _archive_bytes(tmp_path)
    calls: list[str] = []
    kwargs = {
        "release": _release(imsg_module, archive),
        "downloader": _write_downloader(archive, calls),
        "signature_checker": _verify_fixture_signature,
        "version_reader": _fixture_version,
        "stderr": io.StringIO(),
    }

    binary = imsg_module.ensure_imsg(tmp_path / "capabilities", **kwargs)
    binary.write_bytes(b"tampered")
    repaired = imsg_module.ensure_imsg(tmp_path / "capabilities", **kwargs)

    assert repaired.read_bytes() == b"signed imsg binary"
    assert calls == [
        "https://example.invalid/imsg.zip",
        "https://example.invalid/imsg.zip",
    ]


def test_main_executes_capability_without_asking_to_install(
    imsg_module: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binary = tmp_path / "imsg"
    binary.write_bytes(b"binary")
    executions: list[tuple[str, list[str]]] = []

    def unexpected_prompt(*_args, **_kwargs):
        raise AssertionError("capability preparation must never prompt the user")

    monkeypatch.setattr(builtins, "input", unexpected_prompt)
    imsg_module.main(
        ["chats", "--limit", "10", "--json"],
        ensure=lambda: binary,
        execv=lambda path, args: executions.append((path, args)),
        platform="darwin",
    )

    assert executions == [
        (str(binary), [str(binary), "chats", "--limit", "10", "--json"])
    ]


def test_skill_routes_every_command_through_automatic_helper() -> None:
    source = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")

    assert "commands: [imsg]" not in source
    assert "brew install" not in source
    assert 'python "$SKILL_DIR/scripts/imsg.py"' in source
    assert "Never ask" in source
