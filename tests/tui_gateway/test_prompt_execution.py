"""Execution terminal authority survives failures outside the conversation loop."""
import contextvars
import logging
import threading
import time
from types import SimpleNamespace

import pytest

from tui_gateway import prompt_turn
from tui_gateway.method_ctx import rebind


@pytest.mark.parametrize("failure", ["success", "marker", "prepare", "cleanup", "interrupt", "stale", "snapshot", "generation"])
def test_outermost_turn_settles_even_when_setup_or_cleanup_fails(failure, monkeypatch):
    agent = SimpleNamespace(session_id="chat")
    session = dict(agent=agent, session_key="chat", history_lock=threading.RLock(), running=True)
    events, receipts, followups = [], [], []
    def noop(*args, **kwargs):
        return None
    def fail(*args, **kwargs):
        raise RuntimeError(failure)
    def invoke(sid, session, st, *args):
        st.result = {"interrupted": failure == "interrupt"}
    def finish(*args):
        if failure == "stale":
            from tui_gateway.prompt_execution import begin_execution
            begin_execution(session)
            agent.interim_assistant_callback = "new callback"
            session["inflight_turn"] = {"text": "new turn"}
        elif failure == "cleanup":
            fail()
    env = {
        "threading": threading, "time": time, "logger": logging.getLogger(__name__),
        "_sessions_lock": threading.RLock(), "_sessions": {},
        "_admit_prompt_turn": lambda *args: ([], agent),
        "_emit": lambda event, sid, payload=None: events.append((event, payload)),
        "bind_transport": noop, "reset_transport": noop,
        "_current_runtime_session_record": contextvars.ContextVar("execution_test"),
        "_TurnRun": prompt_turn._TurnRun,
        "_record_turn_marker": fail if failure == "marker" else lambda *a, **k: "marker",
        "_prepare_turn_input": fail if failure == "prepare" else lambda *a: ("hi", "hi", 80, None),
        "_invoke_agent": invoke, "_absorb_turn_result": noop,
        "_complete_turn_payload": lambda *a: ({}, "ok", "interrupted" if failure == "interrupt" else "complete"),
        "_goal_followup_after_turn": noop, "_after_complete_turn": noop,
        "_publish_session_control_snapshot": noop,
        "_recover_turn_exception": lambda sid, session, st, exc: receipts.append(str(exc)),
        "_finish_turn": finish,
        "_clear_inflight_turn": noop, "_retire_turn_marker": noop,
        "_emit_settled_session_info": fail if failure == "snapshot" else noop,
        "_run_post_turn_followups": lambda *a: followups.append(True),
        "_result_status": prompt_turn._result_status,
    }
    submit = rebind(prompt_turn._run_prompt_submit, env)
    if failure == "generation":
        from tui_gateway import prompt_admission
        monkeypatch.setattr(prompt_admission, "next_generation", fail)
        with pytest.raises(RuntimeError, match="generation"):
            submit(None, "live", session, "hi")
        assert session["running"] is False
        assert events[-1][1]["execution_state"] == "error"
        return
    assert submit(None, "live", session, "hi")
    session["_run_thread"].join(5)
    assert not session["_run_thread"].is_alive()
    if failure == "stale":
        assert session["running"] is True
        assert session["_execution_state"] == "running"
        assert agent.interim_assistant_callback == "new callback"
        assert session["inflight_turn"] == {"text": "new turn"}
        assert not any(event == "session.info" for event, _ in events)
        return
    assert session["running"] is False
    assert followups == [True]
    state = "complete" if failure in {"success", "snapshot"} else "interrupted" if failure == "interrupt" else "error"
    assert session["_execution_state"] == state
    info = [payload for event, payload in events if event == "session.info"][-1]
    assert info["execution_generation"] == session["_execution_generation"]
    assert info["execution_state"] == state
    assert info["running"] is False


def test_stale_generation_cannot_settle_a_newer_execution():
    from tui_gateway import prompt_execution
    session = {"history_lock": threading.RLock(), "running": True, "_execution_state": "complete"}
    assert prompt_execution.execution_snapshot(session)["execution_state"] == "running"
    first = prompt_execution.begin_execution(session)
    second = prompt_execution.begin_execution(session)
    assert second > first
    assert not prompt_execution.settle_execution(session, first, "error")
    assert session["running"] is True
    assert prompt_execution.execution_snapshot(session) == {
        "execution_generation": second, "execution_state": "running", "running": True}
    assert prompt_execution.settle_execution(session, second, "complete")
    assert session["running"] is False
