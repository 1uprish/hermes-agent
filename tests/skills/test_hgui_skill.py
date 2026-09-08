"""Durable contracts for the bundled hgui skill (worktree desktop launcher)."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = REPO_ROOT / "skills" / "software-development" / "hgui"
SKILL_MD = SKILL_DIR / "SKILL.md"
TEMPLATE = SKILL_DIR / "templates" / "hgui.zsh"
FRESH_RUN = SKILL_DIR / "scripts" / "fresh-run.zsh"


def _parse_frontmatter(content: str) -> dict:
    from agent.skill_utils import parse_frontmatter

    frontmatter, _ = parse_frontmatter(content)
    return frontmatter


@pytest.fixture(scope="module")
def skill_text() -> str:
    return SKILL_MD.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def frontmatter(skill_text: str) -> dict:
    return _parse_frontmatter(skill_text)


def test_skill_frontmatter_is_valid_and_discoverable(frontmatter: dict):
    assert frontmatter.get("name") == "hgui"
    description = frontmatter.get("description")
    assert isinstance(description, str) and description.strip()
    assert len(description) <= 60
    assert description.endswith(".")
    assert frontmatter.get("license") == "MIT"
    # macOS/zsh launcher — must NOT claim linux/windows support.
    assert frontmatter.get("platforms") == ["macos"]


def test_author_credits_original_author_and_skill_author(frontmatter: dict):
    author = str(frontmatter.get("author"))
    # Human contributors first (AGENTS.md skill standard #4): Brooklyn wrote
    # hgui; Austin packaged the skill.
    assert "OutThisLife" in author
    assert "austinpickett" in author


def test_shipped_assets_exist_and_are_runnable():
    assert TEMPLATE.is_file()
    assert FRESH_RUN.is_file()
    assert os.access(FRESH_RUN, os.X_OK), "fresh-run.zsh must be executable"


def test_skill_prose_references_only_shipped_assets(skill_text: str):
    # Every skill-relative path named in the prose must exist on disk.
    # Lookbehind excludes repo-anchored paths (apps/desktop/scripts/...).
    for rel in re.findall(r"(?<![\w/])(?:templates|scripts)/[\w./-]+", skill_text):
        assert (SKILL_DIR / rel).exists(), f"SKILL.md references missing {rel}"


def test_no_machine_local_paths():
    pattern = re.compile(r"/Users/[a-z0-9_-]+/|/home/(?!runner\b)[a-z0-9_-]+/")
    for path in (SKILL_MD, TEMPLATE, FRESH_RUN):
        m = pattern.search(path.read_text(encoding="utf-8"))
        assert not m, f"{path.name}: machine-local path {m.group(0)!r}"


@pytest.mark.macos_only
@pytest.mark.skipif(shutil.which("zsh") is None, reason="zsh not installed")
def test_zsh_assets_parse():
    for script in (TEMPLATE, FRESH_RUN):
        proc = subprocess.run(
            ["zsh", "-n", str(script)], capture_output=True, text=True
        )
        assert proc.returncode == 0, f"{script.name}: {proc.stderr}"


@pytest.mark.macos_only
@pytest.mark.skipif(shutil.which("zsh") is None, reason="zsh not installed")
def test_template_guards_missing_main_checkout():
    """Sourcing without HERMES_MAIN_CHECKOUT must fail with guidance."""
    proc = subprocess.run(
        ["zsh", "-f", "-c", f"source {TEMPLATE}"],
        capture_output=True,
        text=True,
        env={"PATH": os.environ.get("PATH", "")},
    )
    assert proc.returncode != 0
    assert "HERMES_MAIN_CHECKOUT" in proc.stderr


@pytest.mark.macos_only
@pytest.mark.skipif(shutil.which("zsh") is None, reason="zsh not installed")
def test_template_defines_launchers(tmp_path):
    """With the env var set, sourcing defines all launcher functions."""
    proc = subprocess.run(
        [
            "zsh",
            "-f",
            "-c",
            f"export HERMES_MAIN_CHECKOUT={tmp_path}; "
            f"source {TEMPLATE} && whence -w hgui hermes htui",
        ],
        capture_output=True,
        text=True,
        env={"PATH": os.environ.get("PATH", "")},
    )
    assert proc.returncode == 0, proc.stderr
    for fn in ("hgui", "hermes", "htui"):
        assert f"{fn}: function" in proc.stdout


@pytest.mark.macos_only
@pytest.mark.skipif(shutil.which("zsh") is None, reason="zsh not installed")
def test_fresh_run_rejects_bad_usage(tmp_path):
    env = {"PATH": os.environ.get("PATH", ""), "HERMES_MAIN_CHECKOUT": str(tmp_path)}
    # Unknown flag
    proc = subprocess.run(
        ["zsh", str(FRESH_RUN), "--bogus"], capture_output=True, text=True, env=env
    )
    assert proc.returncode != 0
    # Missing worktree arg
    proc = subprocess.run(
        ["zsh", str(FRESH_RUN)], capture_output=True, text=True, env=env
    )
    assert proc.returncode != 0
    assert "usage" in proc.stderr.lower()
