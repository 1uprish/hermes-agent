"""Desktop cron ticker: every local profile's store must be ticked.

The desktop app pools per-profile backends and reaps them after ~10 idle
minutes, so a secondary profile's in-backend ticker dies with its backend and
that profile's cron jobs silently stop firing until the user next opens the
profile. The PRIMARY desktop backend outlives the pool, so its ticker must own
every profile's store — the desktop sibling of the multiplex-gateway fix for
#69377.

What it hands the scheduler is a LIVE view rather than a list, because desktop
bots are profiles the app mints while it is running: onboarding creates the
setup bot and then a task bot mid-session, and each schedules its own check-ins
into a home that did not exist when a startup snapshot would have been taken.
So these assert which homes a tick SEES, at the moment it looks — never the
shape of the argument that carries them.
"""

from pathlib import Path
import threading

import pytest

import hermes_cli.web_server as ws


class _RecordingBuiltin:
    """Stands in for InProcessCronScheduler; records start() kwargs."""

    name = "builtin"

    def __init__(self):
        self.start_kwargs = None

    def start(self, stop_event, **kwargs):
        self.start_kwargs = kwargs


class _RecordingExternal:
    """External provider double — must NOT receive profile_homes."""

    name = "chronos-test"

    def __init__(self):
        self.start_kwargs = None

    def start(self, stop_event, **kwargs):
        self.start_kwargs = kwargs


@pytest.fixture()
def _providers(monkeypatch):
    import cron.scheduler_provider as sp

    builtin = _RecordingBuiltin()
    # isinstance(provider, InProcessCronScheduler) gate: register our double
    # as that class for the module under test.
    monkeypatch.setattr(ws, "_log", ws._log)
    monkeypatch.setattr(sp, "resolve_cron_scheduler", lambda: builtin)
    monkeypatch.setattr(sp, "InProcessCronScheduler", _RecordingBuiltin)
    return sp, builtin


def test_every_profile_home_is_ticked(monkeypatch, _providers, tmp_path):
    _sp, builtin = _providers
    homes = [
        ("default", tmp_path / "root"),
        ("coder", tmp_path / "profiles" / "coder"),
    ]
    import hermes_cli.profiles as profiles_mod

    monkeypatch.setattr(profiles_mod, "profiles_to_serve", lambda **_kw: list(homes))

    ws._start_desktop_cron_ticker(threading.Event(), interval=7)

    assert builtin.start_kwargs["interval"] == 7
    assert list(builtin.start_kwargs["profile_homes"]) == homes


def test_a_profile_minted_after_start_is_ticked(monkeypatch, _providers, tmp_path):
    """The reason the view is live: onboarding mints its bots mid-session.

    A snapshot taken when the backend booted would never tick the setup bot's
    check-in, because the setup bot did not exist yet.
    """
    _sp, builtin = _providers
    import hermes_cli.profiles as profiles_mod

    homes = [("default", tmp_path / "root")]
    monkeypatch.setattr(profiles_mod, "profiles_to_serve", lambda **_kw: list(homes))

    ws._start_desktop_cron_ticker(threading.Event(), interval=7)
    homes.append(("hermes-setup", tmp_path / "profiles" / "hermes-setup"))

    assert [name for name, _home in builtin.start_kwargs["profile_homes"]] == ["default", "hermes-setup"]


def test_enumeration_failure_fails_open(monkeypatch, _providers):
    """The active profile's jobs keep firing even if profile listing breaks."""
    _sp, builtin = _providers
    import hermes_cli.profiles as profiles_mod

    def _boom(**_kw):
        raise RuntimeError("profiles dir unreadable")

    monkeypatch.setattr(profiles_mod, "profiles_to_serve", _boom)

    ws._start_desktop_cron_ticker(threading.Event(), interval=11)

    assert builtin.start_kwargs["interval"] == 11
    assert [name for name, _home in builtin.start_kwargs["profile_homes"]] == ["default"]


def test_external_provider_never_gets_profile_homes(monkeypatch, tmp_path):
    """External registries are not profile-scoped; keep single-store semantics."""
    import cron.scheduler_provider as sp

    external = _RecordingExternal()
    monkeypatch.setattr(sp, "resolve_cron_scheduler", lambda: external)

    import hermes_cli.profiles as profiles_mod

    monkeypatch.setattr(
        profiles_mod,
        "profiles_to_serve",
        lambda **_kw: [("default", tmp_path / "a"), ("b", tmp_path / "b")],
    )

    ws._start_desktop_cron_ticker(threading.Event(), interval=13)

    assert external.start_kwargs == {"interval": 13}
