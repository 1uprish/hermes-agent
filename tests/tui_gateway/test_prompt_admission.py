"""Durable human admission through the existing busy owner and real restart."""
import json
import os
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest

from tui_gateway import server


def owner(monkeypatch, home, *, key="conversation", running=True):
    session = dict(profile_home=str(home), session_key=key, history_lock=threading.RLock(),
                   running=running, attached_images=[], history=[], agent=SimpleNamespace(),
                   history_version=0, cols=80, title="")
    monkeypatch.setattr(server, "_sess_nowait", lambda *a: (session, None))
    monkeypatch.setattr(server, "_ensure_active_session_slot", lambda *a: None)
    monkeypatch.setattr(server, "_session_uses_compute_host", lambda *a: False)
    monkeypatch.setattr(server, "_reattach_refusal", lambda *a: None)
    monkeypatch.setattr(server, "_typed_stop_phrase_response", lambda *a: None)
    monkeypatch.setattr(server, "_load_busy_input_mode", lambda: "queue")
    monkeypatch.setattr(server, "_persist_session_row_for_submit", lambda *a: None)
    return session


def submit(text="later", submission_id="stable", **kw):
    return server._methods["prompt.submit"]("r", dict(session_id="ui", text=text,
                    submission_id=submission_id, queued=True, **kw))


def test_busy_admission_is_durable_before_ack_and_restart_reconstructs_fifo(monkeypatch, tmp_path):
    session = owner(monkeypatch, tmp_path)
    session["attached_images"] = ["/owned/image.png"]
    first = submit()["result"]
    assert first.get("admission_id") == "stable"
    session["attached_images"] = ["/owned/next.png"]
    assert submit()["result"] == first
    assert session["attached_images"] == ["/owned/next.png"]
    assert submit(text="conflict")["error"]["code"] == 4093
    server._enqueue_prompt(session, "legacy callback envelope", object())
    assert submit(submission_id="second")["result"]["status"] == "queued"
    assert [e.get("admission_id") for e in [session["queued_prompt"], *session["queued_prompts"]]] == ["stable", None, "second"]
    from tui_gateway.prompt_admission import admission_snapshot, cancel_admission
    # This is another interpreter: nothing from the owner's in-memory queue survives.
    script = '''import json, threading, sys
from tui_gateway.prompt_admission import admission_snapshot, restore_pending
s=dict(profile_home=sys.argv[1],session_key="conversation",history_lock=threading.RLock(),running=False)
restore_pending(s)
print(json.dumps({"snapshot":admission_snapshot(s),"queue":[s["queued_prompt"],*s.get("queued_prompts",[])]}), file=sys.__stdout__)
'''
    p = subprocess.run([sys.executable, "-c", script, str(tmp_path)], capture_output=True,
                       text=True, check=True, stdin=subprocess.DEVNULL, env=dict(os.environ))
    recovered = json.loads(p.stdout)
    assert [e["admission_id"] for e in recovered["queue"]] == ["stable", "second"]
    assert all("transport" not in e for e in recovered["queue"])
    assert cancel_admission(session, "stable")["outcome"] == "cancelled"
    assert [r["admission_id"] for r in admission_snapshot(session)["pending_submissions"]] == ["second"]
    # An ID in another profile is not evidence this profile accepted anything.
    other = owner(monkeypatch, tmp_path / "other")
    assert admission_snapshot(other)["pending_submissions"] == []
    assert submit(text="independent")["result"]["status"] == "queued"
    owner(monkeypatch, tmp_path, key="wrong-session")
    assert submit()["error"]["code"] == 4093


@pytest.mark.parametrize("stop_after_claim", [False, True])
def test_next_admission_resets_only_prior_stop(monkeypatch, tmp_path, stop_after_claim):
    _interrupt_session_turn = server._interrupt_session_turn

    session = owner(monkeypatch, tmp_path, running=False)
    _interrupt_session_turn("ui", session)
    stopped_generation = session["_queued_prompt_generation"]
    calls = []
    monkeypatch.setattr(server, "_restart_completed_failed_agent_build", lambda *a: True)

    def ready(*args):
        if stop_after_claim:
            _interrupt_session_turn("ui", session)
        return None

    def run(*args, **kwargs):
        calls.append((args[3], kwargs["queued_prompt_generation"]))
        session["running"] = False

    monkeypatch.setattr(server, "_wait_agent_for_prompt", ready)
    monkeypatch.setattr(server, "_run_prompt_submit", run)
    response = submit()
    session["_run_thread"].join(5)
    assert response["result"]["admission_id"] == "stable"
    assert not session["_run_thread"].is_alive()
    assert calls == ([] if stop_after_claim else [("later", stopped_generation)])
    assert session["_turn_cancel_requested"] is stop_after_claim
    assert session["_queued_prompt_generation"] == stopped_generation + int(stop_after_claim)


def test_deferred_dispatch_failure_cannot_release_newer_owner(monkeypatch, tmp_path):
    from tui_gateway.prompt_admission import run_queued_admission, claim_admission
    from tui_gateway.prompt_execution import begin_execution
    session = owner(monkeypatch, tmp_path)
    submit()
    claim_admission(session, "stable")
    monkeypatch.setattr(server, "_restart_completed_failed_agent_build", lambda *a: True)
    def newer(*a, **kw):
        begin_execution(session)
        session["_run_thread"] = "newer-owner"
        raise RuntimeError("old dispatcher failed")
    monkeypatch.setattr(server, "_run_after_agent_ready", newer)
    class Inline:
        def __init__(self, target, **kw):
            self.target = target
        def start(self):
            self.target()
    monkeypatch.setattr(threading, "Thread", Inline)
    with pytest.raises(RuntimeError, match="old dispatcher"):
        run_queued_admission("r", "ui", session, {"text": "later", "admission_id": "stable"}, {})
    assert session["running"] is True
    assert session["_run_thread"] == "newer-owner"


def test_compression_tip_recovers_original_target_but_branch_cannot_retarget(monkeypatch, tmp_path):
    from hermes_state import SessionDB
    from tui_gateway.prompt_admission import admission_snapshot, restore_pending
    with SessionDB(db_path=tmp_path / "state.db") as db:
        db.create_session("conversation", source="tui")
        session = owner(monkeypatch, tmp_path)
        original = submit()["result"]
        db.end_session("conversation", "compression")
        db.create_session("tip", source="tui", parent_session_id="conversation")
        db.create_session("branch", source="tui", parent_session_id="conversation", model_config={"_branched_from": "conversation"})
    tip = owner(monkeypatch, tmp_path, key="tip")
    restore_pending(tip)
    assert tip["queued_prompt"]["admission_id"] == "stable"
    assert submit()["result"] == original
    branch = owner(monkeypatch, tmp_path, key="branch")
    assert admission_snapshot(branch)["pending_submissions"] == []
    assert submit()["error"]["code"] == 4093


@pytest.mark.parametrize("accepted", [True, False])
def test_durable_steer_keeps_explicit_correction_and_queue_fallback(monkeypatch, tmp_path, accepted):
    session = owner(monkeypatch, tmp_path)
    calls = []
    def steer(text):
        calls.append(text)
        return accepted
    session["agent"] = SimpleNamespace(steer=steer)
    monkeypatch.setattr(server, "_load_busy_input_mode", lambda: "steer")
    response = server._methods["prompt.submit"]("r", dict(session_id="ui", text="correct", submission_id="steer"))["result"]
    assert calls == ["correct"]
    assert response["status"] == ("terminal" if accepted else "queued")
    assert bool(session.get("queued_prompt")) is (not accepted)
    retry = server._methods["prompt.submit"]("r2", dict(session_id="ui", text="correct", submission_id="steer"))
    assert retry["result"]["status"] == response["status"]
    assert calls == ["correct"]


def test_real_owner_crash_recovers_queued_not_started(tmp_path):
    from pathlib import Path
    probe = Path(__file__).parent / "fixtures" / "durable_prompt_owner.py"
    env = dict(os.environ, PYTHONPATH=str(Path.cwd()), HERMES_HOME=str(tmp_path))
    for phase in ("accept", "resume"):
        p = subprocess.run([sys.executable, str(probe), str(tmp_path), phase], env=env,
                           capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=25)
        assert p.returncode == 0, p.stdout + p.stderr
    accepted = json.loads((tmp_path / "accepted.json").read_text())
    resumed = json.loads((tmp_path / "resumed.json").read_text())
    assert accepted["running"] is True
    assert accepted["ack"]["result"]["admission_id"] == "later"
    assert len(resumed["calls"]) == 2
    assert "later" in resumed["calls"][0] and "last" in resumed["calls"][1]
    assert resumed["running"] is False
    assert resumed["generation"] > accepted["generation"]
    assert [(r["admission_id"], r["status"]) for r in resumed["snapshot"]["pending_submissions"]] == [("active", "unknown")]


def test_started_admission_is_not_replayed_and_runtime_objects_are_not_serialized(monkeypatch, tmp_path):
    session = owner(monkeypatch, tmp_path)
    receipt = submit()["result"]
    assert receipt.get("admission_id") == "stable"
    from tui_gateway.prompt_admission import claim_admission, restore_pending, admission_snapshot
    assert claim_admission(session, "stable")
    from tui_gateway.prompt_admission import bind_admission_generation, finish_admission
    bind_admission_generation(session, "stable", 2)
    finish_admission(session, "stable", "error", 1)
    assert admission_snapshot(session)["pending_submissions"][0]["status"] == "started"
    restarted = owner(monkeypatch, tmp_path, running=False)
    restore_pending(restarted)
    assert not restarted.get("queued_prompt")
    script = """import json, sys, threading
from tui_gateway.prompt_admission import admission_snapshot, restore_pending
s=dict(profile_home=sys.argv[1],session_key="conversation",history_lock=threading.RLock(),running=False)
restore_pending(s)
assert not s.get("queued_prompt")
print(json.dumps(admission_snapshot(s)), file=sys.__stdout__)
"""
    p = subprocess.run([sys.executable, "-c", script, str(tmp_path)], capture_output=True,
                       text=True, check=True, stdin=subprocess.DEVNULL)
    assert json.loads(p.stdout)["pending_submissions"][0]["status"] == "unknown"
    # The existing callback-bearing automation envelope is retained by reference.
    callback = lambda: None
    restarted["queued_prompt"] = {"text": "automation", "transport": object(), "callback": callback}
    restore_pending(restarted)
    assert restarted["queued_prompt"]["callback"] is callback
