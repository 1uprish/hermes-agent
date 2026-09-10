"""Intent-aware prompt admission for continuous GUI chat surfaces.

The renderer supplies text and an idempotency key; the gateway decides how the
message joins the live session.  Routing stays outside the agent prompt so it
does not mutate conversation history or invalidate prompt caching.
"""

import re
import uuid

from .method_ctx import HandlerRegistry, bind_module

_registry = HandlerRegistry()
method = _registry.method


_DISPATCH_ROUTES = frozenset(("smart", "redirect", "steer", "parallel", "queue"))
_RECEIPT_LIMIT = 256
_WORD_RE = re.compile(r"[a-z0-9][a-z0-9_-]*", re.IGNORECASE)
_CLIENT_MESSAGE_ID_RE = re.compile(r"[a-z0-9._:-]+", re.IGNORECASE)
_STOP_WORDS = frozenset((
    "a", "an", "and", "are", "as", "at", "be", "do", "for", "from", "in", "is", "it", "of", "on", "or",
    "that", "the", "this", "to", "with", "you", "your",
))
_ROUTE_PATTERNS = (
    ("redirect", "explicit_redirect", re.compile(
        r"^\s*(?:(?:stop|cancel|forget|ignore|scratch)(?:\s+(?:that|this|it))?|actually|instead)\b",
        re.IGNORECASE)),
    ("queue", "explicit_queue", re.compile(
        r"^\s*(?:after\s+(?:this|that)|when\s+(?:you\s+are|you're)\s+done|"
        r"once\s+(?:this|that)(?:\s+is|'s)\s+done|then\b)",
        re.IGNORECASE)),
    ("parallel", "explicit_parallel", re.compile(
        r"^\s*(?:meanwhile|separately|in\s+parallel|also\s*,\s*separately|another\s+task|new\s+task)\b",
        re.IGNORECASE)),
    ("steer", "explicit_addition", re.compile(
        r"^\s*(?:(?:also|and)\s+(?:make\s+sure|ensure|include|add|change)|one\s+more\s+thing|additionally)\b",
        re.IGNORECASE)),
)


def _dispatch_words(text: str) -> set[str]:
    return {word.lower() for word in _WORD_RE.findall(text or "") if word.lower() not in _STOP_WORDS}


def _choose_dispatch_route(text: str, *, active_text: str, busy: bool, requested_route: str = "smart") -> dict:
    """Return a fast, conservative route decision.

    Explicit language wins.  Otherwise topical overlap steers the active task,
    a clear unrelated request runs beside it, and tiny/ambiguous messages queue
    so existing work is never destroyed by a guess.
    """
    if not busy:
        return {"confidence": 1.0, "reason_code": "session_idle", "route": "foreground"}
    if requested_route != "smart":
        return {"confidence": 1.0, "reason_code": "user_selected", "route": requested_route}
    for route, reason_code, pattern in _ROUTE_PATTERNS:
        if pattern.search(text):
            return {"confidence": 1.0, "reason_code": reason_code, "route": route}
    words = _dispatch_words(text)
    if len(words) < 2:
        return {"confidence": 0.35, "reason_code": "ambiguous_preserve_work", "route": "queue"}
    active_words = _dispatch_words(active_text)
    overlap = len(words & active_words) / max(1, min(len(words), len(active_words)))
    if overlap >= 0.25:
        return {"confidence": round(min(0.9, 0.65 + overlap), 2), "reason_code": "related_to_active", "route": "steer"}
    return {"confidence": 0.68, "reason_code": "independent_request", "route": "parallel"}


def _dispatch_params(route: str, sid: str, text: str) -> tuple[str, dict]:
    method_name = {
        "foreground": "prompt.submit",
        "parallel": "prompt.background",
        "queue": "prompt.submit",
        "redirect": "session.redirect",
        "steer": "session.steer",
    }[route]
    params = {"session_id": sid, "text": text}
    # ``queued`` is also set for an idle foreground admission.  It is ignored
    # while idle, but makes the busy race preserve the message instead of
    # applying the user's configured interrupt mode.
    if route in ("foreground", "queue"):
        params["queued"] = True
    return method_name, params


def _remember_dispatch_response(session: dict, client_message_id: str, response: dict) -> None:
    with session["history_lock"]:
        receipts = session.setdefault("_dispatch_responses", {})
        receipts[client_message_id] = response
        while len(receipts) > _RECEIPT_LIMIT:
            receipts.pop(next(iter(receipts)))


def _replay_dispatch_response(rid, stored: dict) -> dict:
    if "error" in stored:
        return {"jsonrpc": "2.0", "id": rid, "error": dict(stored["error"])}
    return _ok(rid, dict(stored.get("result") or {}))


@method("prompt.dispatch")
def _(rid, params: dict) -> dict:
    sid = str(params.get("session_id") or "")
    text = str(params.get("text") or "").strip()
    client_message_id = str(params.get("client_message_id") or "").strip()
    requested_route = str(params.get("requested_route") or "smart").strip().lower()
    if not text:
        return _err(rid, 4002, "text is required")
    if not client_message_id or len(client_message_id) > 128 or not _CLIENT_MESSAGE_ID_RE.fullmatch(client_message_id):
        return _err(rid, 4002, "valid client_message_id is required")
    if requested_route not in _DISPATCH_ROUTES:
        return _err(rid, 4002, "requested_route must be smart, redirect, steer, parallel, or queue")
    session, err = _sess_nowait(params, rid)
    if err:
        return err
    with session["history_lock"]:
        if stored := (session.get("_dispatch_responses") or {}).get(client_message_id):
            return _replay_dispatch_response(rid, stored)
        running = bool(session.get("running"))
        inflight = session.get("inflight_turn")
        active_text = str(inflight.get("user") or "") if isinstance(inflight, dict) else ""
        placeholder = _ok(rid, {
            "client_message_id": client_message_id,
            "dispatch_id": f"dispatch_{uuid.uuid4().hex[:12]}",
            "route": "routing",
            "state": "routing",
        })
        session.setdefault("_dispatch_responses", {})[client_message_id] = placeholder
    decision = _choose_dispatch_route(
        text, active_text=active_text, busy=running, requested_route=requested_route)
    method_name, forwarded = _dispatch_params(decision["route"], sid, text)
    response = _methods[method_name](rid, forwarded)
    dispatch_id = placeholder["result"]["dispatch_id"]
    if response.get("error"):
        _remember_dispatch_response(session, client_message_id, response)
        return response
    underlying = response.get("result") or {}
    accepted = str(underlying.get("status") or "") not in ("rejected", "not_interrupted")
    state = "queued" if decision["route"] == "queue" else "running"
    receipt = {
        "client_message_id": client_message_id,
        "confidence": decision["confidence"],
        "dispatch_id": dispatch_id,
        "reason_code": decision["reason_code"],
        "route": decision["route"],
        "state": state if accepted else "failed",
        **({"task_id": underlying["task_id"]} if underlying.get("task_id") else {}),
    }
    final_response = _ok(rid, receipt)
    _remember_dispatch_response(session, client_message_id, final_response)
    _emit("dispatch.accepted", sid, receipt)
    return final_response


def register(server) -> None:
    """Publish helpers and install the dispatch handler on the gateway facade."""
    bind_module(globals(), server, skip=("_",))
