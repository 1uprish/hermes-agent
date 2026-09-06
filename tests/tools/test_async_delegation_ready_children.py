"""A detached fan-out delivers each child as it finishes — never behind a slow sibling — exactly once,
including across a process crash between the first child's completion and the batch join."""

import json
import os
import subprocess
import sys
import threading
import time
from unittest.mock import MagicMock

import pytest

from tools import async_delegation as ad
from tools.process_registry import process_registry
from tools.process_registry_notifications import format_process_notification


@pytest.fixture(autouse=True)
def _clean_state():
    ad._reset_for_tests()
    while not process_registry.completion_queue.empty():
        process_registry.completion_queue.get_nowait()
    yield
    deadline = time.monotonic() + 2.0
    while ad.active_count() and time.monotonic() < deadline:
        time.sleep(0.02)
    ad._reset_for_tests()
    while not process_registry.completion_queue.empty():
        process_registry.completion_queue.get_nowait()


def _drain(timeout: float) -> list:
    deadline = time.monotonic() + timeout
    events = []
    while time.monotonic() < deadline:
        while not process_registry.completion_queue.empty():
            events.append(process_registry.completion_queue.get_nowait())
        if events:
            return events
        time.sleep(0.02)
    return events


def _task_indices(evt: dict) -> list:
    return sorted(r["task_index"] for r in evt.get("results") or [])


def test_fast_child_is_delivered_while_slow_sibling_runs_and_never_twice(monkeypatch):
    """Real ``delegate_task`` fan-out through the background path: the fast child's result reaches the
    completion queue (and a claimable durable row) before the slow sibling finishes; the batch aggregate
    then carries only what was not already delivered, so every child is delivered exactly once."""
    import tools.delegate_tool as dt

    parent = MagicMock()
    parent._delegate_depth = 0
    parent.session_id = "sess"
    parent._interrupt_requested = False
    parent._active_children = []
    parent._active_children_lock = None
    fake_child = MagicMock()
    fake_child._delegate_role = "leaf"
    fake_child._subagent_id = "s1"
    gate = threading.Event()

    def run_child(task_index, goal, child=None, parent_agent=None, **kw):
        if task_index == 1:
            gate.wait(timeout=30)
        return {"task_index": task_index, "status": "completed", "summary": f"done {goal}", "api_calls": 1,
                "duration_seconds": 0.1, "model": "m", "exit_reason": "completed"}

    creds = {"model": "m", "provider": None, "base_url": None, "api_key": None, "api_mode": None, "command": None,
             "args": None}
    monkeypatch.setattr(dt, "_build_child_agent", lambda **kw: fake_child)
    monkeypatch.setattr(dt, "_run_single_child", run_child)
    monkeypatch.setattr(dt, "_resolve_delegation_credentials", lambda *a, **k: creds)

    out = json.loads(dt.delegate_task(
        tasks=[{"goal": "fast task number one"}, {"goal": "slow task number two"}],
        background=True, parent_agent=parent))
    assert out["status"] == "dispatched"
    batch_id = out["delegation_id"]

    early = _drain(timeout=5.0)
    assert ad.active_count() == 1, "the batch unit must still be running (sibling gated)"
    assert [_task_indices(e) for e in early] == [[0]]
    fast = early[0]
    assert fast["delegation_id"] == f"{batch_id}.0" and fast["batch_id"] == batch_id
    assert fast["session_key"] == "sess" and fast["parent_session_id"] == "sess"
    # Same claim rail as every other delegation event: a competing consumer cannot claim it twice.
    claim = ad.claim_event_delivery(fast, "cli")
    assert claim and ad.claim_event_delivery(fast, "gateway") is None
    ad.complete_event_delivery(fast, claim)
    assert ad.get_durable_delegation(f"{batch_id}.0")["delivery_state"] == "delivered"
    text = format_process_notification(fast) or ""
    assert "task 1/2" in text and "done fast task number one" in text

    gate.set()
    late = _drain(timeout=5.0)
    delivered = [fast, *late]
    assert sorted(sum((_task_indices(e) for e in delivered), [])) == [0, 1], "each child exactly once"
    assert late[-1]["delegation_id"] == f"{batch_id}.1"
    # The aggregate row is settled without a queue event: nothing was left to deliver.
    assert ad.get_durable_delegation(batch_id)["delivery_state"] == "delivered"
    assert ad.get_durable_delegation(f"{batch_id}.1")["delivery_state"] == "pending"


def test_child_completed_before_crash_survives_restart_exactly_once(tmp_path):
    """Two real interpreters against one HERMES_HOME: process A finishes child 0 of a 2-task batch and
    dies mid-batch; process B's registry startup replays child 0 once and classifies the batch itself as
    ``unknown`` while naming the recorded child; a third start replays nothing after the ack."""
    repo = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    env = {**os.environ, "HERMES_HOME": str(tmp_path), "PYTHONPATH": repo}

    producer = r'''
import os, threading, time
from tools import async_delegation as ad
gate = threading.Event()
batch_id = ad._new_delegation_id()
def runner():
    ad.publish_batch_child(batch_id, 0, {"status": "completed", "summary": "child zero done",
                                         "api_calls": 1, "duration_seconds": 0.1})
    gate.wait(timeout=60)  # sibling never finishes: the process dies first
    return {"results": []}
rec = ad.dispatch_async_delegation_batch(
    goals=["child zero task", "child one task"], context=None, toolsets=None, role="leaf", model="m",
    session_key="owner-session", parent_session_id="durable-parent", runner=runner, delegation_id=batch_id)
deadline = time.time() + 5
while ad.get_durable_delegation(batch_id + ".0") is None and time.time() < deadline:
    time.sleep(0.01)
assert ad.get_durable_delegation(batch_id + ".0") is not None
print(batch_id, flush=True)
os._exit(1)  # crash: no finalize, no ack
'''
    first = subprocess.run([sys.executable, "-c", producer], cwd=repo, env=env, text=True, capture_output=True,
                           timeout=30)
    assert first.returncode == 1, first.stderr
    batch_id = first.stdout.strip().splitlines()[-1]

    consumer = r'''
import json
from tools.process_registry import process_registry
from tools import async_delegation as ad
events = []
while not process_registry.completion_queue.empty():
    events.append(process_registry.completion_queue.get_nowait())
for evt in events:
    claim = ad.claim_event_delivery(evt, "cli")
    assert claim, evt["delegation_id"]
    ad.complete_event_delivery(evt, claim)
print(json.dumps(events, sort_keys=True))
'''
    second = subprocess.run([sys.executable, "-c", consumer], cwd=repo, env=env, text=True, capture_output=True,
                            timeout=30, check=True)
    events = {e["delegation_id"]: e for e in json.loads(second.stdout.strip().splitlines()[-1])}
    assert set(events) == {f"{batch_id}.0", batch_id}
    child = events[f"{batch_id}.0"]
    assert child["restored"] is True and child["results"][0]["summary"] == "child zero done"
    assert child["session_key"] == "owner-session" and child["parent_session_id"] == "durable-parent"
    unknown = events[batch_id]
    assert unknown["status"] == "unknown" and "1/2 child results were recorded" in unknown["error"]

    third = subprocess.run(
        [sys.executable, "-c", "from tools.process_registry import process_registry; print(process_registry.completion_queue.qsize())"],
        cwd=repo, env=env, text=True, capture_output=True, timeout=30, check=True)
    assert third.stdout.strip().splitlines()[-1] == "0"
