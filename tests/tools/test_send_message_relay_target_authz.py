"""P5(a): `send_message` cannot silently name an arbitrary relay target.

The `target` tool parameter is free-form (`'platform:chat_id'`), so before
this guard a model could name ANY chat id and the gateway would emit an
outbound relay frame for it — authenticating the sender while never
authorizing the destination. These tests drive the REAL `send_message_tool`
entrypoint through the REAL production wiring (`gateway.relay.egress`,
`gateway.channel_directory`, `gateway.relay.relay_fronted_platforms`) against
a temp HERMES_HOME; nothing under test is constructed by the test itself.
"""

from __future__ import annotations

import json

import pytest

from gateway.config import Platform
from tools.send_message_tool import send_message_tool

ATTESTED_CHAT = "111111111111111111"
ARBITRARY_CHAT = "999999999999999999"
HOME_CHAT = "222222222222222222"


@pytest.fixture
def relay_env(tmp_path, monkeypatch):
    """A gateway whose ONLY reachable Discord destinations are attested.

    Mirrors the production shape: `GATEWAY_RELAY_PLATFORMS` is the deploy
    stamp `gateway.relay.relay_fronted_platforms()` reads, the channel
    directory json is the file `channel_directory.load_directory()` reads, and
    no live native adapter exists in this process (so the relay owns egress
    for `discord`, exactly as `gateway/delivery.resolve_delivery_transport`
    decides it).
    """
    import gateway.channel_directory as cd

    monkeypatch.setenv("GATEWAY_RELAY_URL", "wss://connector.example/relay")
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", "discord")
    monkeypatch.setenv("GATEWAY_RELAY_BOT_IDS", json.dumps({"discord": {"botId": "b1"}}))

    directory = tmp_path / "channel_directory.json"
    directory.write_text(
        json.dumps(
            {
                "updated_at": None,
                "platforms": {
                    "discord": [
                        {"id": ATTESTED_CHAT, "name": "bot-home", "type": "channel"}
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cd, "DIRECTORY_PATH", directory)
    monkeypatch.setattr(cd, "CHANNEL_ALIASES_PATH", tmp_path / "channel_aliases.json")
    # No gateway-session origins for discord in this temp home.
    monkeypatch.setattr(cd, "_build_from_sessions", lambda _platform: [])
    return directory


def _send(target: str, sent):
    """Invoke the real tool, recording any egress it attempts."""
    from types import SimpleNamespace
    from unittest.mock import patch

    import asyncio

    discord_cfg = SimpleNamespace(enabled=True, token="t", extra={})
    config = SimpleNamespace(
        platforms={Platform.DISCORD: discord_cfg},
        get_home_channel=lambda _p: SimpleNamespace(chat_id=HOME_CHAT),
    )

    async def _record(platform, pconfig, chat_id, message, **kwargs):
        sent.append(chat_id)
        return {"success": True, "message_id": "m1"}

    with patch("gateway.config.load_gateway_config", return_value=config), patch(
        "tools.interrupt.is_interrupted", return_value=False
    ), patch("model_tools._run_async", side_effect=lambda c: asyncio.run(c)), patch(
        "tools.send_message_tool._send_to_platform", side_effect=_record
    ), patch(
        "gateway.mirror.mirror_to_session", return_value=False
    ):
        return json.loads(
            send_message_tool(
                {"action": "send", "target": target, "message": "hello"}
            )
        )


def test_arbitrary_relay_chat_id_is_refused_and_never_egresses(relay_env):
    """The whole observable: refused, naming THAT target, and ZERO egress."""
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result == {
        "error": (
            f"Refusing to send to unattested relay target 'discord:{ARBITRARY_CHAT}': "
            "this gateway has no record of that destination. Use "
            "send_message(action='list') to see the targets it can reach."
        )
    }
    assert sent == []


def test_attested_directory_chat_id_still_sends(relay_env):
    """The guard must not destroy the feature: an attested chat goes through."""
    sent: list[str] = []
    result = _send(f"discord:{ATTESTED_CHAT}", sent)

    assert result == {"success": True, "message_id": "m1"}
    assert sent == [ATTESTED_CHAT]


def test_home_channel_is_attested(relay_env):
    """The operator-configured home channel is a provenance, not a guess."""
    sent: list[str] = []
    result = _send("discord", sent)

    assert result["success"] is True
    assert sent == [HOME_CHAT]


def test_session_origin_chat_is_attested(relay_env, monkeypatch):
    """A chat this gateway actually holds a session in is reachable."""
    import gateway.channel_directory as cd

    monkeypatch.setattr(
        cd,
        "_build_from_sessions",
        lambda platform: (
            [{"id": ARBITRARY_CHAT, "name": "seen", "type": "channel"}]
            if platform == "discord"
            else []
        ),
    )
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_platform_not_fronted_by_relay_is_untouched(relay_env, monkeypatch):
    """Non-relay platforms keep their own adapters' authorization, unchanged."""
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", "telegram")
    monkeypatch.setenv(
        "GATEWAY_RELAY_BOT_IDS", json.dumps({"telegram": {"botId": "b1"}})
    )
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_live_native_adapter_takes_precedence_over_the_relay_guard(
    relay_env, monkeypatch
):
    """A platform served by a live NATIVE adapter here is not a relay egress.

    Same precedence `gateway/delivery.resolve_delivery_transport` applies: a
    concrete native adapter always wins over the relay, so this guard must not
    fire for it.
    """
    from types import SimpleNamespace

    import gateway.run

    runner = SimpleNamespace(adapters={Platform.DISCORD: object()})
    monkeypatch.setattr(gateway.run, "_gateway_runner_ref", lambda: runner)
    sent: list[str] = []
    result = _send(f"discord:{ARBITRARY_CHAT}", sent)

    assert result["success"] is True
    assert sent == [ARBITRARY_CHAT]


def test_react_refuses_an_arbitrary_relay_target(relay_env):
    """Reactions are outbound acts too — same floor, same refusal."""
    result = json.loads(
        send_message_tool(
            {
                "action": "react",
                "target": f"discord:{ARBITRARY_CHAT}",
                "emoji": "👍",
            }
        )
    )
    assert result == {
        "error": (
            f"Refusing to send to unattested relay target 'discord:{ARBITRARY_CHAT}': "
            "this gateway has no record of that destination. Use "
            "send_message(action='list') to see the targets it can reach."
        )
    }

# ── B-1: the guard must authorize the RESOLVED destination ──────────────────
#
# Slack `@handle` / `U...` targets are internal PSEUDO-ids
# (`user_name:ben`, `user:U...`) until `_resolve_slack_user_target` opens the
# DM and returns the real `D...` conversation. Provenances only ever hold
# resolved ids, so authorizing the pseudo-id compares a handle against a set
# of channel ids and refuses every Slack DM — an OUTAGE caused by a security
# fix. Review round 1 found this; reproduced before fixing.
#
# These tests are the falsifiable floor for the guard's POSITION: they pass
# only while authorization happens AFTER resolution.

SLACK_DM = "D01234567AB"
SLACK_USER = "U01234567AB"


@pytest.fixture
def slack_relay_env(tmp_path, monkeypatch):
    """A relay-fronted Slack gateway whose attested destination is a DM id."""
    import gateway.channel_directory as cd

    monkeypatch.setenv("GATEWAY_RELAY_URL", "wss://connector.example/relay")
    monkeypatch.setenv("GATEWAY_RELAY_PLATFORMS", "slack")
    monkeypatch.setenv("GATEWAY_RELAY_BOT_IDS", json.dumps({"slack": {"botId": "b1"}}))

    directory = tmp_path / "channel_directory.json"
    directory.write_text(
        json.dumps(
            {
                "updated_at": None,
                # The DM conversation id — what resolution produces, and the
                # only form any provenance ever stores.
                "platforms": {"slack": [{"id": SLACK_DM, "name": "ben", "type": "im"}]},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(cd, "DIRECTORY_PATH", directory)
    monkeypatch.setattr(cd, "CHANNEL_ALIASES_PATH", tmp_path / "channel_aliases.json")
    monkeypatch.setattr(cd, "_build_from_sessions", lambda _platform: [])
    return directory


def _send_slack(target: str, sent, *, resolves_to: str | None = SLACK_DM):
    """Invoke the real tool with the REAL Slack resolution step in the path.

    Only `conversations.open` is faked (a network call). The ordering of the
    guard against the resolver is production's.
    """
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import patch

    slack_cfg = SimpleNamespace(enabled=True, token="xoxb-t", extra={})
    config = SimpleNamespace(
        platforms={Platform.SLACK: slack_cfg},
        get_home_channel=lambda _p: SimpleNamespace(chat_id=SLACK_DM),
    )

    async def _record(platform, pconfig, chat_id, message, **kwargs):
        sent.append(chat_id)
        return {"success": True, "message_id": "m1"}

    async def _resolve(_token, target_ref):
        # Stands in for the Slack API call only; returns what production's
        # resolver returns — the opened DM channel id.
        return (resolves_to, None)

    with patch("gateway.config.load_gateway_config", return_value=config), patch(
        "tools.interrupt.is_interrupted", return_value=False
    ), patch("model_tools._run_async", side_effect=lambda c: asyncio.run(c)), patch(
        "tools.send_message_tool._send_to_platform", side_effect=_record
    ), patch(
        "tools.send_message_tool._resolve_slack_user_target", side_effect=_resolve
    ), patch(
        "gateway.mirror.mirror_to_session", return_value=False
    ):
        return json.loads(
            send_message_tool({"action": "send", "target": target, "message": "hello"})
        )


@pytest.mark.parametrize(
    "target",
    [f"slack:@ben", f"slack:{SLACK_USER}", f"slack:<@{SLACK_USER}>"],
)
def test_slack_user_targets_resolve_then_authorize(slack_relay_env, target):
    """An attested DM must SEND regardless of which alias names it.

    Fails if the guard runs before resolution: the pseudo-id
    (`user_name:ben` / `user:U...`) is not in any provenance, so the send is
    refused and `sent` stays empty.
    """
    sent: list[str] = []
    result = _send_slack(target, sent)

    assert result == {"success": True, "message_id": "m1"}
    # The whole observable: it egressed, and to the RESOLVED destination.
    assert sent == [SLACK_DM]


def test_slack_user_target_resolving_to_unattested_dm_is_refused(slack_relay_env):
    """Moving the guard must not disable it.

    A handle that resolves to a DM this gateway cannot attest is still
    refused — and the refusal names the RESOLVED id, which is the destination
    that was actually authorized.
    """
    sent: list[str] = []
    unattested = "D99999999XX"
    result = _send_slack("slack:@stranger", sent, resolves_to=unattested)

    assert result == {
        "error": (
            f"Refusing to send to unattested relay target 'slack:{unattested}': "
            "this gateway has no record of that destination. Use "
            "send_message(action='list') to see the targets it can reach."
        )
    }
    assert sent == []


# ── the guard must FAIL CLOSED on its own fault ─────────────────────────────
#
# Round-2 review: `_authorize_relay_target` wrapped BOTH the import and the
# call in one `except Exception: return None`, and None means AUTHORIZED. So
# any runtime bug inside the guard silently switched the whole P5(a) boundary
# off — the most expensive possible failure mode for an authorization check.


def test_guard_fault_refuses_rather_than_authorizing(relay_env, monkeypatch):
    """A guard that cannot answer must refuse, and must not egress."""
    import gateway.relay.egress as eg
    from tools import send_message_tool as smt

    def _boom(*_a, **_k):
        raise RuntimeError("bug inside the guard")

    monkeypatch.setattr(eg, "authorize_relay_target", _boom)

    denial = smt._authorize_relay_target("discord", ATTESTED_CHAT)
    assert denial is not None, "a faulting guard authorized the send"
    assert "authorization check failed" in denial

    # And end to end: nothing may egress.
    sent: list[str] = []
    result = _send(f"discord:{ATTESTED_CHAT}", sent)
    assert "error" in result
    assert sent == []


def test_missing_gateway_package_still_allows(relay_env, monkeypatch):
    """The tolerated case survives: no gateway ⇒ no relay egress to authorize.

    This is the distinction the original code collapsed. Keeping it tested
    stops a future "make it fail closed" change from breaking the CLI-only
    install.
    """
    import builtins

    from tools import send_message_tool as smt

    real_import = builtins.__import__

    def _no_gateway(name, *a, **k):
        if name.startswith("gateway.relay.egress"):
            # The shape real absence takes: ModuleNotFoundError WITH a name.
            # A bare ImportError is not something a missing module produces,
            # and treating it as absence was a fail-open (round 4, blocker 1).
            raise ModuleNotFoundError("no gateway package", name="gateway")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", _no_gateway)
    assert smt._authorize_relay_target("discord", ARBITRARY_CHAT) is None


# ── fail-open boundaries: ABSENCE is not FAULT ─────────────────────────────


def test_route_discovery_fault_refuses_rather_than_authorizing(relay_env, monkeypatch):
    """A fault while determining relay routing must DENY, not fall through.

    `_relay_fronted` used to swallow every exception and return an empty set,
    which `relay_routed_platform` reads as "not relay-routed" — skipping the
    guard entirely. Review injected a discovery fault and watched an
    unattested target get authorized.
    """
    import gateway.relay as gr
    from tools.send_message_tool import _authorize_relay_target

    def boom():
        raise RuntimeError("config unreadable while listing fronted platforms")

    monkeypatch.setattr(gr, "relay_fronted_platforms", boom)
    denial = _authorize_relay_target("discord", "999")
    assert denial is not None
    assert "could not be" in denial


def test_missing_relay_module_still_authorizes(relay_env, monkeypatch):
    """The converse: genuine ABSENCE must keep working (no gateway ⇒ no relay).

    Without this, "fail closed on faults" would silently become "refuse
    everything in CLI/cron contexts", which is the outage the original broad
    except was there to avoid.
    """
    import gateway.relay as gr
    from tools.send_message_tool import _authorize_relay_target

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: set())
    assert _authorize_relay_target("discord", "999") is None


def test_relay_module_import_fault_refuses(monkeypatch):
    """A module that EXISTS but fails to import is a fault, not an absence."""
    import builtins

    import tools.send_message_tool as smt

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "gateway.relay.egress":
            raise RuntimeError("broken dependency inside an installed gateway")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    denial = smt._authorize_relay_target("discord", "999")
    assert denial is not None
    assert "could not be" in denial


@pytest.mark.parametrize("configured", ["discord", "Discord", "DISCORD", " discord "])
def test_relay_fronted_matching_is_case_insensitive(relay_env, monkeypatch, configured):
    """Review round 3, finding 3 — an attestation bypass on a string compare.

    `relay_routed_platform` lowercases the REQUESTED name but `_relay_fronted`
    returned configured names verbatim, so a platform configured as "Discord"
    missed the membership test and looked native — skipping the guard entirely.
    """
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {configured})
    monkeypatch.setattr(eg, "attested_relay_targets", lambda p: set())
    assert eg.authorize_relay_target("discord", "999") is not None


def test_attested_target_still_allowed_when_config_case_differs(relay_env, monkeypatch):
    """Control: normalizing must not start refusing legitimate traffic."""
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"Discord"})
    monkeypatch.setattr(eg, "attested_relay_targets", lambda p: {"999"})
    assert eg.authorize_relay_target("discord", "999") is None


def test_nested_dependency_importerror_refuses(monkeypatch):
    """Review round 3, finding 2 — `except ImportError` was still fail-open.

    An ImportError naming a NESTED module means an installed gateway failed to
    load (broken dependency). That is a fault, not "there is no relay here",
    and returning None means authorized.
    """
    import builtins

    import tools.send_message_tool as smt

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "gateway.relay.egress":
            raise ModuleNotFoundError(
                "No module named 'gateway.relay.dependency'",
                name="gateway.relay.dependency",
            )
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    denial = smt._authorize_relay_target("discord", "999")
    assert denial is not None


def test_absent_gateway_module_importerror_still_authorizes(monkeypatch):
    """Control: genuine absence (CLI/cron) must keep working."""
    import builtins

    import tools.send_message_tool as smt

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "gateway.relay.egress":
            raise ModuleNotFoundError("No module named 'gateway'", name="gateway")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert smt._authorize_relay_target("discord", "999") is None


def test_nameless_importerror_refuses(monkeypatch):
    """Round 4, blocker 1 — a bare ImportError is a FAULT, not absence.

    Genuine absence raises ModuleNotFoundError with `.name` set (verified
    against the interpreter). A plain ImportError therefore comes from an
    import hook or a module that failed while initializing, and authorizing on
    it means any such fault silently disables the boundary.
    """
    import builtins

    import tools.send_message_tool as smt

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "gateway.relay.egress":
            raise ImportError("something went wrong during init")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert smt._authorize_relay_target("discord", "999") is not None


def test_session_attestation_does_not_invent_a_matrix_room_prefix(monkeypatch):
    """Round 4, blocker 2 — the attestation set must not FABRICATE ids.

    `_session_ids` split every id on the first colon to recover "chat" from
    "chat:thread". Matrix room ids contain a colon natively
    (`!room:server.org`), so the split attested a bare `!room` that no session
    ever used — the guard vouching for a destination on its own invention.
    """
    import gateway.channel_directory as cd
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"matrix"})
    # A Matrix room with NO thread: the colon is part of the address itself.
    monkeypatch.setattr(
        cd,
        "_build_from_sessions",
        lambda p: [{"id": "!owned:server.org", "thread_id": None}],
    )

    # The real session id is still attested...
    assert eg.authorize_relay_target("matrix", "!owned:server.org") is None
    # ...but the invented prefix is not.
    assert eg.authorize_relay_target("matrix", "!owned") is not None


def test_session_attestation_still_recovers_a_slack_thread_parent(monkeypatch):
    """Control: thread-parent recovery must keep working.

    Slack session ids are genuinely `chat:thread` and the connector authorizes
    the CHAT, so failing to recover the parent would refuse legitimate replies.
    """
    import gateway.channel_directory as cd
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"slack"})
    # A genuinely thread-qualified entry carries thread_id separately, which is
    # how the parent is recovered — no string guessing.
    monkeypatch.setattr(
        cd,
        "_build_from_sessions",
        lambda p: [{"id": "C123:1700000000.1", "thread_id": "1700000000.1"}],
    )

    assert eg.authorize_relay_target("slack", "C123") is None


def test_egress_module_own_import_boundary_fails_closed(monkeypatch):
    """Round 4, non-blocking finding: `gateway/relay/egress.py` has its OWN
    import boundary (`_relay_fronted` -> `from gateway.relay import ...`), and
    the existing nested-ImportError test intercepts the EARLIER import in
    tools/send_message_tool.py, so this one was never exercised.
    """
    import builtins

    import gateway.relay.egress as eg

    real_import = builtins.__import__

    def fake_import(name, *a, **kw):
        if name == "gateway.relay" and "relay_fronted_platforms" in (kw.get("fromlist") or a[2] if len(a) > 2 else []):
            raise ModuleNotFoundError("broken dep", name="gateway.relay.broken_dep")
        return real_import(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(eg.RelayRouteUnknown):
        eg._relay_fronted()


def test_matrix_thread_parent_is_recovered_without_splitting_the_room_id(monkeypatch):
    """The case the allow-list could never have handled correctly.

    A Matrix room id contains a colon AND the session can be thread-qualified:
    `!room:server.org:$thread`. Splitting on the FIRST colon yields `!room`
    (invented); using the structured `thread_id` yields the real room.
    """
    import gateway.channel_directory as cd
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"matrix"})
    monkeypatch.setattr(
        cd,
        "_build_from_sessions",
        lambda p: [{"id": "!room:server.org:$thr", "thread_id": "$thr"}],
    )

    assert eg.authorize_relay_target("matrix", "!room:server.org") is None
    assert eg.authorize_relay_target("matrix", "!room") is not None


# ── round 5 ────────────────────────────────────────────────────────────────


def test_disabled_native_adapter_is_not_treated_as_native(monkeypatch):
    """R5-1: the guard and the delivery router must not disagree about routing.

    `resolve_delivery_transport` ignores a native adapter whose config is
    DISABLED and routes over Relay. `_has_live_native_adapter` treated mere
    presence in the adapter map as native, so the guard skipped authorization
    for a send that actually went over the relay.
    """
    from types import SimpleNamespace

    import gateway.relay.egress as eg
    from gateway.config import Platform

    monkeypatch.setattr(
        eg,
        "_gateway_runner_ref",
        lambda: SimpleNamespace(adapters={Platform.DISCORD: object()}),
        raising=False,
    )
    import gateway.run as gr_run

    monkeypatch.setattr(gr_run, "_gateway_runner_ref", eg._gateway_runner_ref, raising=False)
    monkeypatch.setattr(
        eg,
        "load_gateway_config",
        lambda: SimpleNamespace(
            platforms={Platform.DISCORD: SimpleNamespace(enabled=False)}
        ),
        raising=False,
    )
    import gateway.config as gc

    monkeypatch.setattr(
        gc,
        "load_gateway_config",
        lambda: SimpleNamespace(
            platforms={Platform.DISCORD: SimpleNamespace(enabled=False)}
        ),
    )
    assert eg._has_live_native_adapter("discord") is False


def test_enabled_native_adapter_is_still_native(monkeypatch):
    """Control: an ENABLED native adapter must keep bypassing the relay guard."""
    from types import SimpleNamespace

    import gateway.config as gc
    import gateway.relay.egress as eg
    import gateway.run as gr_run
    from gateway.config import Platform

    ref = lambda: SimpleNamespace(adapters={Platform.DISCORD: object()})  # noqa: E731
    monkeypatch.setattr(gr_run, "_gateway_runner_ref", ref, raising=False)
    monkeypatch.setattr(
        gc,
        "load_gateway_config",
        lambda: SimpleNamespace(
            platforms={Platform.DISCORD: SimpleNamespace(enabled=True)}
        ),
    )
    assert eg._has_live_native_adapter("discord") is True


def test_arbitrary_thread_under_an_attested_parent_is_refused(relay_env, monkeypatch):
    """R5-2: on Discord the THREAD is the REST destination.

    `POST /channels/{thread_id}/messages` — so an attested parent channel must
    not vouch for a caller-supplied thread the gateway has never seen.
    """
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"discord"})
    monkeypatch.setattr(eg, "attested_relay_targets", lambda p: {"111"})
    assert eg.authorize_relay_target("discord", "111", "999") is not None


@pytest.mark.parametrize("attested", [{"111", "999"}, {"111", "111:999"}])
def test_attested_thread_is_allowed(relay_env, monkeypatch, attested):
    """Control: a thread the gateway HAS a provenance for must still send.

    Both shapes count — the bare thread id, and the `chat:thread` form a
    session origin produces.
    """
    import gateway.relay as gr
    import gateway.relay.egress as eg

    monkeypatch.setattr(gr, "relay_fronted_platforms", lambda: {"discord"})
    monkeypatch.setattr(eg, "attested_relay_targets", lambda p: attested)
    assert eg.authorize_relay_target("discord", "111", "999") is None


def test_tool_guard_forwards_the_thread_id(monkeypatch):
    """The wrapper must PASS thread_id, not just accept it.

    Mutating `_authorize_relay_target` to drop the argument survived every
    other test here — they all call `authorize_relay_target` directly, so
    nothing observed what the tool wrapper forwards. Same gap as the caller
    findings: testing the callee never proves the caller uses it.
    """
    import tools.send_message_tool as smt

    seen = {}

    def fake_authorize(platform_name, chat_id, thread_id=None):
        seen["args"] = (platform_name, chat_id, thread_id)
        return None

    import gateway.relay.egress as eg

    monkeypatch.setattr(eg, "authorize_relay_target", fake_authorize)
    smt._authorize_relay_target("discord", "111", "999")
    assert seen["args"] == ("discord", "111", "999")
