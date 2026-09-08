"""Disposable real owner/SQLite/process-death probe; only model/config edges are inert."""
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace

root, phase = Path(sys.argv[1]), sys.argv[2]
home = root
os.environ["HERMES_HOME"] = str(home)
from tui_gateway import server
from hermes_state import SessionDB
server._db = SessionDB(db_path=home / "state.db")

entered = threading.Event()
finished = threading.Event()
calls = []

def model(message, **kwargs):
    calls.append(message)
    if phase == "accept":
        entered.set()
        threading.Event().wait(30)
    return {"final_response": "done", "messages": [{"role": "user", "content": message},
                                                    {"role": "assistant", "content": "done"}]}

agent = SimpleNamespace(session_id="conversation", run_conversation=model, clear_interrupt=lambda: None)
ready = threading.Event()
ready.set()
session = dict(agent=agent, session_key="conversation", profile_home=str(home),
               history=[], history_lock=threading.RLock(), history_version=0, running=False,
               attached_images=[], image_counter=0, cols=80, slash_worker=None,
               show_reasoning=False, tool_progress_mode="all", inflight_turn=None,
               agent_ready=ready, title="Probe", source="tui")
server._sessions["ui"] = session
# Keep real owner acquisition, prompt handler, queue, run thread, and SQLite.
server._load_cfg = lambda: {}
server._load_busy_input_mode = lambda: "queue"
server._wire_callbacks = lambda *a: None
server._sync_agent_model_with_config = lambda *a: None
server._session_cwd = lambda *a: str(home)
server._register_session_cwd = lambda *a: None
server._tts_stream_begin = lambda: None
server._get_usage = lambda *a: {}
server._session_info = lambda agent, session: {"running": session["running"]}

def emit(event, sid, payload=None):
    if event == "session.info" and payload and payload.get("execution_state") in {"complete", "error"} and len(calls) == 2:
        finished.set()
server._emit = emit

if phase == "accept":
    initial = server._methods["prompt.submit"]("one", dict(session_id="ui", text="active", submission_id="active", queued=True))
    assert entered.wait(10), (initial, session)
    ack = server._methods["prompt.submit"]("two", dict(session_id="ui", text="later", submission_id="later", queued=True))
    assert ack.get("result", {}).get("status") == "queued", ack
    assert ack["result"].get("admission_id") == "later", ack
    from tui_gateway.prompt_admission import admission_snapshot
    third = server._methods["prompt.submit"]("three", dict(session_id="ui", text="last", submission_id="last", queued=True))
    assert third["result"]["status"] == "queued"
    assert session["active_session_lease"] is not None
    result = dict(ack=ack, snapshot=admission_snapshot(session), calls=calls, running=session["running"], generation=session.get("_execution_generation"))
    (root / "accepted.json").write_text(json.dumps(result))
    os._exit(0)  # No finally, queue serialization, graceful close, or manual restore.
else:
    from tui_gateway.prompt_admission import admission_snapshot
    server._maybe_schedule_auto_continue("ui", session, "conversation")
    assert finished.wait(10), session
    session["_run_thread"].join(5)
    result = dict(snapshot=admission_snapshot(session), calls=calls, running=session["running"],
                  generation=session.get("_execution_generation"))
    (root / "resumed.json").write_text(json.dumps(result))
    server._release_active_session_slot(session)
