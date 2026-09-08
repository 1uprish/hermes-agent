"""Generation-fenced authority for in-process prompt executions.

Only explicit turn completion releases running; elapsed time is not ownership.
These helpers retain their own globals rather than the gateway facade's bindings.
"""


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
    with session["history_lock"]:
        return {
            "execution_generation": int(session.get("_execution_generation", 0)),
            "execution_state": "running" if session.get("running") else session.get("_execution_state", "idle"),
            "running": bool(session.get("running")),
        }
