"""Generation-fenced authority for in-process prompt executions.

Only explicit turn completion releases running; elapsed time is not ownership.
These helpers retain their own globals rather than the gateway facade's bindings.
"""

from contextvars import ContextVar
import uuid

_EPOCH = uuid.uuid4().hex
event_authority: ContextVar[dict | None] = ContextVar("prompt_event_authority", default=None)


def begin_execution(session: dict) -> int:
    from .prompt_admission import next_generation
    with session["history_lock"]:
        try:
            generation = next_generation(session, int(session.get("_execution_generation", 0)))
        except BaseException:
            session.update(_execution_state="error", running=False)
            raise
        session.update(_execution_generation=generation, _execution_state="running", running=True)
        return generation


def settle_execution(session: dict, generation: int, status: str) -> bool:
    with session["history_lock"]:
        if session.get("_execution_generation") != generation:
            return False
        session.update(_execution_state=status, running=False)
        return True


def execution_snapshot(session: dict) -> dict:
    # Copy the dictionary once: projections also run inside an already-owned
    # non-reentrant history lock. Writers publish authority with dict.update.
    state = session.copy()
    return {
        "execution_epoch": _EPOCH,
        "execution_generation": int(state.get("_execution_generation", 0)),
        "execution_state": "running" if state.get("running") else state.get("_execution_state", "idle"),
        "running": bool(state.get("running")),
    }


def session_authority(session: dict) -> dict:
    from .prompt_admission import admission_snapshot
    return {**admission_snapshot(session), **execution_snapshot(session)}
