import threading

from tui_gateway import prompt_execution, server


def test_projection_under_owned_nonreentrant_lock(monkeypatch):
    session = dict(history_lock=threading.Lock(), running=True, _execution_generation=4)
    with session["history_lock"]:
        info = prompt_execution.execution_snapshot(session)
    assert info["execution_epoch"]
    assert info["execution_generation"] == 4
    monkeypatch.setattr(server, "_resolve_model", lambda: "fixture")
    monkeypatch.setattr(server, "_session_cwd", lambda s: "/tmp")
    info = server._fallback_session_info(session)
    assert info["execution_epoch"]
    assert info["pending_submissions"] == []


def test_turn_frames_retain_captured_authority():
    from tui_gateway.prompt_execution import event_authority
    token = event_authority.set({"execution_epoch": "old", "execution_generation": 4})
    try:
        frame = server._event_frame("message.complete", "sid", {"status": "complete"})
        assert frame["params"]["payload"]["execution_epoch"] == "old"
    finally:
        event_authority.reset(token)
