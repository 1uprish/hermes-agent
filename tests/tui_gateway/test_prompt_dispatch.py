"""MacMan smart-dispatch contract.

The gateway owns intent routing because renderer guesses diverge across reconnects and
surfaces.  These tests pin the costly edges: false interruption and duplicate dispatch.
"""

from __future__ import annotations

import threading
from unittest.mock import patch

import pytest

from tui_gateway import server


@pytest.fixture(autouse=True)
def _restore_methods():
    methods = dict(server._methods)
    yield
    server._methods.clear()
    server._methods.update(methods)


def _session(*, running: bool, active: str = "") -> dict:
    return {
        "history": [],
        "history_lock": threading.RLock(),
        "inflight_turn": {"user": active, "streaming": running} if active else None,
        "running": running,
        "session_key": "stored-macman",
    }


@pytest.mark.parametrize(
    ("text", "active", "route"),
    [
        ("Stop that and make it a PDF instead", "Write the launch brief", "redirect"),
        ("Also make sure the launch brief cites sources", "Write the launch brief", "steer"),
        ("Meanwhile find flights to Tokyo", "Fix the reconnect bug", "parallel"),
        ("After this, draft the release notes", "Fix the reconnect bug", "queue"),
        ("Add reconnect tests for that socket", "Fix the reconnect bug", "steer"),
        ("Draft an invoice for Acme", "Fix the reconnect bug", "parallel"),
        ("hey", "Fix the reconnect bug", "queue"),
    ],
)
def test_dispatch_route_preserves_work_unless_intent_is_clear(text, active, route):
    decision = server._choose_dispatch_route(text, active_text=active, busy=True)

    assert decision["route"] == route


def test_idle_dispatch_uses_foreground_even_when_message_mentions_parallel():
    decision = server._choose_dispatch_route(
        "Meanwhile find flights to Tokyo", active_text="", busy=False
    )

    assert decision == {
        "confidence": 1.0,
        "reason_code": "session_idle",
        "route": "foreground",
    }


def test_prompt_dispatch_is_idempotent_for_the_same_client_message():
    session = _session(running=False)
    calls = []

    def submit(rid, params):
        calls.append((rid, params))
        return server._ok(rid, {"status": "streaming"})

    server._methods["prompt.submit"] = submit
    with patch.object(server, "_sess_nowait", return_value=(session, None)):
        first = server._methods["prompt.dispatch"](
            "rid-1",
            {
                "client_message_id": "client-1",
                "session_id": "runtime-macman",
                "text": "Write the launch brief",
            },
        )
        second = server._methods["prompt.dispatch"](
            "rid-2",
            {
                "client_message_id": "client-1",
                "session_id": "runtime-macman",
                "text": "Write the launch brief",
            },
        )

    assert len(calls) == 1
    assert calls[0][1] == {
        "queued": True,
        "session_id": "runtime-macman",
        "text": "Write the launch brief",
    }
    assert second["result"] == first["result"]
    assert first["result"]["route"] == "foreground"
    assert first["result"]["state"] == "running"


def test_busy_parallel_dispatch_uses_the_side_task_path():
    session = _session(running=True, active="Fix the reconnect bug")
    calls = []

    def background(rid, params):
        calls.append((rid, params))
        return server._ok(rid, {"task_id": "bg_123"})

    server._methods["prompt.background"] = background
    with patch.object(server, "_sess_nowait", return_value=(session, None)):
        response = server._methods["prompt.dispatch"](
            "rid-1",
            {
                "client_message_id": "client-2",
                "session_id": "runtime-macman",
                "text": "Meanwhile find flights to Tokyo",
            },
        )

    assert calls == [
        (
            "rid-1",
            {"session_id": "runtime-macman", "text": "Meanwhile find flights to Tokyo"},
        )
    ]
    assert response["result"] == {
        "client_message_id": "client-2",
        "confidence": 1.0,
        "dispatch_id": response["result"]["dispatch_id"],
        "reason_code": "explicit_parallel",
        "route": "parallel",
        "state": "running",
        "task_id": "bg_123",
    }


def test_busy_ambiguous_dispatch_queues_without_interrupting():
    session = _session(running=True, active="Fix the reconnect bug")
    calls = []

    def submit(rid, params):
        calls.append((rid, params))
        return server._ok(rid, {"status": "queued"})

    server._methods["prompt.submit"] = submit
    with patch.object(server, "_sess_nowait", return_value=(session, None)):
        response = server._methods["prompt.dispatch"](
            "rid-1",
            {
                "client_message_id": "client-3",
                "session_id": "runtime-macman",
                "text": "hey",
            },
        )

    assert calls[0][1]["queued"] is True
    assert response["result"]["route"] == "queue"
    assert response["result"]["state"] == "queued"


def test_requested_route_overrides_smart_routing():
    session = _session(running=True, active="Fix the reconnect bug")
    server._methods["session.redirect"] = lambda rid, _params: server._ok(
        rid, {"status": "redirected"}
    )

    with patch.object(server, "_sess_nowait", return_value=(session, None)):
        response = server._methods["prompt.dispatch"](
            "rid-1",
            {
                "client_message_id": "client-4",
                "requested_route": "redirect",
                "session_id": "runtime-macman",
                "text": "Actually do this",
            },
        )

    assert response["result"]["reason_code"] == "user_selected"
    assert response["result"]["route"] == "redirect"

