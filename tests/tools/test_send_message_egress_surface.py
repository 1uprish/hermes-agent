"""Every DESTINATION-NAMING action of `send_message` must pass the egress guard.

WHY THIS FILE EXISTS
--------------------
The relay egress fix (#99220) authorizes a named destination before an
outbound act. It works by a guard call at each entry point that takes a
`target` — today `action="send"` and `action="react"/"unreact"`. That shape has
a failure mode the per-site tests cannot see: a NEW action added to the tool
later, with a `target` parameter and no guard call, is a silent bypass. Every
existing test still passes, because none of them know the new action exists.

So this file does not test a site. It derives the action set from
`SEND_MESSAGE_SCHEMA` — the tool's own declaration of what a model may ask for
— and drives each one against an unattested relay destination. A new action
appears in that enum automatically, so the coverage test below fails the moment
one is added without being classified, and the enforcement test fails if it
names a destination and skips the guard.

This deliberately does NOT read source text. `AGENTS.md` bans tests that
inspect `.py` files, and rightly: a regex over the source passes when a call
site is mis-wired and fails on a correct refactor. Everything here runs the
real `send_message_tool` entry point and asserts on observed behaviour.

CLASSIFICATION
--------------
`_READ_ONLY_ACTIONS` names actions that reach no destination and therefore
need no guard. It is a deliberate allow-list: adding an action to it is a
claim, and `test_read_only_actions_really_do_not_reach_a_destination` checks
that claim by driving the action and asserting nothing was sent.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any, Dict, List, Set

import pytest

from tools.send_message_tool import SEND_MESSAGE_SCHEMA, send_message_tool

# Actions that answer from local state and never name an outbound destination.
# Every entry is proven read-only by a test below.
_READ_ONLY_ACTIONS: Set[str] = {"list"}

# Actions known to name an outbound destination, and therefore required to
# consult the guard. Like `_READ_ONLY_ACTIONS` this is an explicit claim; the
# coverage test below fails if the schema declares an action in NEITHER list,
# which is the tripwire for a new action being added without a decision.
_DESTINATION_ACTIONS: Set[str] = {"send", "react", "unreact"}

# A relay-fronted platform with NO attestation for the chat we will name.
_PLATFORM = "discord"
_UNATTESTED_CHAT = "999888777"


def _declared_actions() -> List[str]:
    """The action set the tool advertises to the model."""
    enum = SEND_MESSAGE_SCHEMA["parameters"]["properties"]["action"]["enum"]
    assert enum, "the tool must advertise at least one action"
    return list(enum)


def _args_for(action: str) -> Dict[str, Any]:
    """Minimal well-formed arguments so the call reaches the guard.

    Each action's required fields differ; missing ones short-circuit on a
    validation error BEFORE the guard, which would make this test vacuous. The
    assertions below check the refusal is the guard's, not a validation error.
    """
    args: Dict[str, Any] = {
        "action": action,
        "target": f"{_PLATFORM}:{_UNATTESTED_CHAT}",
        "message": "spam",
    }
    if action in ("react", "unreact"):
        args["emoji"] = "❤️"
        args["message_id"] = "1234567890"
    return args


@pytest.fixture
def relay_no_attestation(monkeypatch, tmp_path):
    """A gateway where `discord` is relay-fronted and NOTHING is attested.

    Built the way the production path reads its state — the
    `GATEWAY_RELAY_*` deploy stamp plus a real (empty) channel-directory file
    — rather than by stubbing the guard's own helpers. That matters here: the
    `send` lane resolves platform config BEFORE the guard, so a fixture that
    only stubbed attestation made `send` fail with "platform not configured"
    and never reach the check under test.

    Records every wire send so a bypass is observable rather than inferred.
    """
    import gateway.channel_directory as cd

    monkeypatch.setenv("GATEWAY_RELAY_URL", "wss://connector.example/relay")
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", _PLATFORM)
    monkeypatch.setenv(
        "GATEWAY_RELAY_BOT_IDS", json.dumps({_PLATFORM: {"botId": "b1"}})
    )

    # A real directory file with NO entries: the honest "nothing attested".
    directory = tmp_path / "channel_directory.json"
    directory.write_text(
        json.dumps({"updated_at": None, "platforms": {_PLATFORM: []}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(cd, "DIRECTORY_PATH", directory)
    monkeypatch.setattr(cd, "CHANNEL_ALIASES_PATH", tmp_path / "channel_aliases.json")
    monkeypatch.setattr(cd, "_build_from_sessions", lambda _platform: [])

    sent: List[Dict[str, Any]] = []

    class RecordingAdapter:
        """Fails the test if reached: an unattested destination must be refused."""

        def fronts_platform(self, platform):
            return str(getattr(platform, "value", "")).lower() == _PLATFORM

        async def add_reaction(self, **kw):
            sent.append({"op": "react", **kw})
            return True

        async def remove_reaction(self, **kw):
            sent.append({"op": "unreact", **kw})
            return True

        async def send(self, *a, **kw):
            sent.append({"op": "send", "args": a, "kw": kw})
            return SimpleNamespace(success=True, message_id="1")

    adapter = RecordingAdapter()

    import gateway.run as gr_run
    from gateway.config import Platform

    monkeypatch.setattr(
        gr_run,
        "_gateway_runner_ref",
        lambda: SimpleNamespace(adapters={Platform.RELAY: adapter}),
        raising=False,
    )

    import tools.send_message_tool as smt

    monkeypatch.setattr(
        smt, "_live_adapter", lambda p: (Platform.RELAY, adapter), raising=False
    )

    # The `send` lane resolves platform config BEFORE the guard
    # (`_resolve_platform_config`, which returns "Platform 'discord' is not
    # configured" in a bare temp home) so without this the call never reaches
    # the check under test. A relay-fronted platform legitimately has no native
    # token, hence `token=None`.
    real_resolve = smt._resolve_platform_config

    def _resolve(platform_name, *args, **kwargs):
        if str(platform_name).strip().lower() == _PLATFORM:
            from gateway.config import Platform as _P

            return (
                _P.DISCORD,
                SimpleNamespace(token=None, enabled=True),
                SimpleNamespace(),
                None,
            )
        return real_resolve(platform_name, *args, **kwargs)

    monkeypatch.setattr(smt, "_resolve_platform_config", _resolve, raising=False)
    return sent


def _result_text(raw: Any) -> str:
    """Tool results are JSON strings or dicts depending on the lane."""
    if isinstance(raw, str):
        try:
            return json.dumps(json.loads(raw))
        except (ValueError, TypeError):
            return raw
    return json.dumps(raw, default=str)


def test_every_declared_action_is_classified():
    """A new action must be deliberately classified, not silently uncovered.

    This is the tripwire, and the reason this file exists. Both lists are
    written by hand; the action set is DERIVED from the tool's own schema. So
    an action added to the schema belongs to neither list and fails here —
    forcing the decision "does this name a destination?" instead of letting a
    new outbound lane ship unguarded while every existing test stays green.
    """
    declared = set(_declared_actions())

    unclassified = declared - _READ_ONLY_ACTIONS - _DESTINATION_ACTIONS
    assert not unclassified, (
        f"action(s) {sorted(unclassified)} are newly declared in "
        "SEND_MESSAGE_SCHEMA but classified in neither _READ_ONLY_ACTIONS nor "
        "_DESTINATION_ACTIONS. If the action names an outbound destination it "
        "MUST call the egress guard; add it to _DESTINATION_ACTIONS so the "
        "refusal test below covers it."
    )

    stale = (_READ_ONLY_ACTIONS | _DESTINATION_ACTIONS) - declared
    assert not stale, f"classified action(s) no longer declared: {sorted(stale)}"

    overlap = _READ_ONLY_ACTIONS & _DESTINATION_ACTIONS
    assert not overlap, f"action(s) in both lists: {sorted(overlap)}"

    assert _DESTINATION_ACTIONS, "expected at least one destination-naming action"


@pytest.mark.parametrize("action", sorted(_DESTINATION_ACTIONS))
def test_destination_action_refuses_an_unattested_relay_target(
    action, relay_no_attestation
):
    """Each destination-naming action must refuse, and must not reach the wire.

    Two assertions, because either alone is weak: a refusal message could be a
    validation error that never consulted the guard, and an empty wire log
    could mean the call failed for an unrelated reason.
    """
    sent = relay_no_attestation

    result = _result_text(send_message_tool(_args_for(action)))

    assert not sent, (
        f"action={action!r} reached the wire with an unattested destination: {sent}"
    )
    # The refusal must be the GUARD's, naming the target and the reason — not a
    # generic argument-validation failure.
    assert "Refusing to send to relay target" in result or "no record" in result, (
        f"action={action!r} was not refused by the egress guard; got: {result[:300]}"
    )


@pytest.mark.parametrize("action", sorted(_READ_ONLY_ACTIONS))
def test_read_only_actions_really_do_not_reach_a_destination(
    action, relay_no_attestation
):
    """Prove the allow-list claim rather than trusting it.

    If a listed action ever starts sending, it belongs in the guarded set and
    this fails.
    """
    sent = relay_no_attestation

    send_message_tool({"action": action})

    assert not sent, f"read-only action={action!r} performed an outbound act: {sent}"


def test_the_guard_admits_an_attested_destination(monkeypatch, tmp_path):
    """Liveness control: the tripwire above must not pass by refusing everything.

    Without this, deleting the whole tool body would satisfy every assertion in
    this file.
    """
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {_PLATFORM})
    monkeypatch.setattr(eg, "attested_relay_targets", lambda p: {_UNATTESTED_CHAT})

    denial = eg.authorize_relay_target(_PLATFORM, _UNATTESTED_CHAT)
    assert denial is None, f"an ATTESTED destination must be admitted; got {denial}"
