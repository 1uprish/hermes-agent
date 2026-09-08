"""Profile-scoped human input ledger; persist identity/payload, never live transports.

The owner queue is the executor. A claim is irreversible: a dead owner's started
row is ambiguous, not permission to repeat arbitrary tool effects.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import uuid

_PROCESS = uuid.uuid4().hex


class AdmissionConflict(ValueError):
    pass


def _home(session):
    from hermes_constants import get_hermes_home
    return Path(session.get("profile_home") or get_hermes_home()).resolve()


@contextmanager
def _ledger(session):
    home = _home(session)
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(home / "prompt-admissions.db", timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("""CREATE TABLE IF NOT EXISTS admissions (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, admission_id TEXT UNIQUE NOT NULL,
            target_session_id TEXT NOT NULL, root TEXT NOT NULL, lineage TEXT NOT NULL,
            payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
            outcome TEXT, owner TEXT, generation INTEGER)""")
        with db:
            yield db
    finally:
        db.close()


def _target(session):
    key = str(session.get("session_key") or "")
    if not key:
        raise ValueError("durable admission requires a stored session identity")
    from . import server
    with server._session_db(session) as db:
        lineage = db.get_compression_lineage(key) if db is not None else []
    lineage = lineage or [key]
    return key, lineage[0], lineage


def _receipt(session, row):
    state = row["status"]
    if state == "started" and row["owner"] != _PROCESS:
        state = "unknown"
    return dict(admission_id=row["admission_id"], status=state, outcome=row["outcome"],
                target_session_id=row["target_session_id"], target_profile_home=str(_home(session)))


def accept_admission(session, admission_id, payload):
    if not isinstance(admission_id, str) or not admission_id or len(admission_id) > 200:
        raise ValueError("submission_id must be a nonempty string of at most 200 characters")
    key, root, lineage = _target(session)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    with _ledger(session) as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM admissions WHERE admission_id=?", (admission_id,)).fetchone()
        if row is not None:
            # Attached media was captured at first admission, not repasted on retry.
            prior = json.loads(row["payload"])
            retry = dict(payload, image_paths=prior.get("image_paths", []))
            if row["root"] != root or prior != retry:
                raise AdmissionConflict("submission_id already belongs to different input or target")
            return _receipt(session, row), False
        db.execute("INSERT INTO admissions(admission_id,target_session_id,root,lineage,payload) VALUES(?,?,?,?,?)",
                   (admission_id, key, root, json.dumps(lineage), encoded))
        row = db.execute("SELECT * FROM admissions WHERE admission_id=?", (admission_id,)).fetchone()
        receipt = _receipt(session, row)
    return receipt, True  # context manager committed before any acknowledgement


def next_generation(session, floor):
    """Persist epochs once a session has opted into durable admission."""
    if not (_home(session) / "prompt-admissions.db").exists():
        return floor + 1
    _, root, _ = _target(session)
    with _ledger(session) as db:
        db.execute("CREATE TABLE IF NOT EXISTS executions (root TEXT PRIMARY KEY, generation INTEGER NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT INTO executions(root,generation) VALUES(?,?) ON CONFLICT(root) DO UPDATE SET generation=MAX(generation,?)+1",
                   (root, floor + 1, floor))
        return db.execute("SELECT generation FROM executions WHERE root=?", (root,)).fetchone()[0]


def claim_admission(session, admission_id):
    _, root, _ = _target(session)
    with _ledger(session) as db:
        return db.execute("UPDATE admissions SET status='started',owner=? WHERE admission_id=? AND root=? AND status='queued'",
                          (_PROCESS, admission_id, root)).rowcount == 1


def bind_admission_generation(session, admission_id, generation):
    with _ledger(session) as db:
        db.execute("UPDATE admissions SET generation=? WHERE admission_id=? AND owner=? AND status='started' AND generation IS NULL",
                   (generation, admission_id, _PROCESS))


def finish_admission(session, admission_id, status, generation):
    with _ledger(session) as db:
        db.execute("UPDATE admissions SET status='terminal',outcome=?,generation=? WHERE admission_id=? AND owner=? AND status='started' AND (generation IS NULL OR generation=?)",
                   (status, generation, admission_id, _PROCESS, generation))


def cancel_admission(session, admission_id):
    _, root, _ = _target(session)
    with _ledger(session) as db:
        db.execute("UPDATE admissions SET status='terminal',outcome='cancelled' WHERE admission_id=? AND root=? AND status='queued'",
                   (admission_id, root))
        row = db.execute("SELECT * FROM admissions WHERE admission_id=? AND root=?", (admission_id, root)).fetchone()
        if row is None:
            raise ValueError("admission not found in this session")
        return _receipt(session, row)


def _pending(session):
    if not (_home(session) / "prompt-admissions.db").exists():
        return []
    _, root, _ = _target(session)
    with _ledger(session) as db:
        return list(db.execute("SELECT * FROM admissions WHERE root=? AND status!='terminal' ORDER BY seq", (root,)))


def admission_snapshot(session):
    return {"pending_submissions": [dict(_receipt(session, row), user=json.loads(row["payload"])["text"])
                                    for row in _pending(session)]}


def restore_pending(session):
    """Rebuild only never-started work; preserve opaque legacy envelopes by reference."""
    if not (_home(session) / "prompt-admissions.db").exists():
        return
    rows = _pending(session)
    with session["history_lock"]:
        old = ([session["queued_prompt"]] if session.get("queued_prompt") else []) + list(session.get("queued_prompts") or [])
        pending = {r["admission_id"]: r for r in rows if r["status"] == "queued"}
        # Preserve mixed legacy/durable FIFO and runtime-only callbacks by reference.
        entries = [e for e in old if not e.get("admission_id") or e["admission_id"] in pending]
        present = {e.get("admission_id") for e in entries}
        entries.extend(dict(json.loads(r["payload"]), admission_id=aid)
                       for aid, r in pending.items() if aid not in present)
        session["queued_prompt"] = entries[0] if entries else None
        session["queued_prompts"] = entries[1:]


def run_queued_admission(rid, sid, session, queued, kwargs):
    from . import server
    import threading

    admission_id = queued["admission_id"]

    def run():
        try:
            if not server._restart_completed_failed_agent_build(sid, session, session.get("agent_ready")):
                server._start_agent_build(sid, session)
            server._run_after_agent_ready(
                rid, sid, session, queued["text"], queued.get("display_kind"), None,
                admission_id=admission_id, **kwargs)
        except BaseException:
            # The build dispatcher stops owning lifecycle after handing off its thread.
            with session["history_lock"]:
                owns_dispatch = session.get("_run_thread") is thread
                if owns_dispatch:
                    session.update(running=False, _execution_state="error")
            try:
                finish_admission(session, admission_id, "error", session.get("_execution_generation", 0))
            finally:
                if owns_dispatch:
                    from .prompt_execution import execution_snapshot
                    server._emit("session.info", sid, execution_snapshot(session))
            raise
        else:
            if not session.get("running"):
                finish_admission(session, admission_id, "error", session.get("_execution_generation", 0))

    thread = threading.Thread(target=run, daemon=True)
    session["_run_thread"] = thread
    thread.start()


def submit_admission(rid, sid, session, params, text, transport):
    """Existing prompt.submit's opt-in durable branch, sharing its owner drain."""
    from . import server
    mode = "queue" if params.get("queued") else server._load_busy_input_mode()
    with session["history_lock"]:
        images = list(session.get("attached_images") or [])
        payload = dict(text=text, image_paths=images, display_kind="hidden" if params.get("display_kind") == "hidden" else None,
                       intent=mode)
        # Attachment retry does not consume a later paste or require repasting accepted media.
        receipt, fresh = accept_admission(session, params["submission_id"], payload)
        if not fresh:
            return server._ok(rid, receipt)
        session["attached_images"] = []
        busy = bool(session.get("running"))
    if busy and mode != "queue" and not images:
        # The durable started marker precedes steer/redirect. Crash here is unknown,
        # not a synthetic next-turn replay of a possibly already consumed correction.
        agent = session.get("agent")
        plain = server._coerce_message_text(text).strip() if server._is_text_only_busy_payload(text) else ""
        method, status = {"steer": ("steer", "steered"), "interrupt": ("redirect", "redirected")}.get(mode, (None, None))
        supported = method and agent is not None and hasattr(agent, method)
        if mode == "interrupt":
            supported = supported and getattr(agent, "_supports_active_turn_redirect", False) is True
        if plain and supported and claim_admission(session, receipt["admission_id"]):
            try:
                accepted = getattr(agent, method)(plain)
            except Exception:
                # The correction may have been consumed before an implementation raised.
                finish_admission(session, receipt["admission_id"], "correction_unknown", session.get("_execution_generation", 0))
                return server._ok(rid, dict(receipt, status="terminal", outcome="correction_unknown"))
            if accepted:
                with session["history_lock"]:
                    server._record_inflight_correction(session, plain)
                    server._drop_queued_duplicates_of_inflight_user(session)
                finish_admission(session, receipt["admission_id"], status, session.get("_execution_generation", 0))
                return server._ok(rid, dict(receipt, status="terminal", outcome=status))
            # A concrete refusal proves no correction was admitted. Preserve the
            # configured safe-boundary fallback (unlike a crash/exception ambiguity).
            with _ledger(session) as db:
                db.execute("UPDATE admissions SET status='queued',owner=NULL WHERE admission_id=? AND owner=? AND status='started'",
                           (receipt["admission_id"], _PROCESS))
    restore_pending(session)
    with session["history_lock"]:
        entries = ([session["queued_prompt"]] if session.get("queued_prompt") else []) + session.get("queued_prompts", [])
        for entry in entries:
            if entry.get("admission_id") == receipt["admission_id"]:
                entry["transport"] = transport
    if busy and mode == "interrupt" and not images:
        server._interrupt_busy_session(sid, session, session.get("agent"))
    # Recheck at the boundary: the busy turn may have settled while SQLite committed.
    server._drain_queued_prompt(rid, sid, session)
    # The submit ACK reaches only its sender; every attached viewer needs the
    # durable queue, even while the owner is blocked inside a model/tool call.
    server._emit("session.info", sid, {
        "stored_session_id": session.get("session_key") or sid,
        **admission_snapshot(session),
    })
    return server._ok(rid, receipt)
