"""Private same-user discovery on the existing serve listener.

Registry metadata locates the runtime but never authorizes access. Only a native
client holding its profile's private copy of the existing runtime credential can
complete the handshake; browser and non-loopback callers cannot use this route.
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
import stat
import sys
from pathlib import Path
from urllib.parse import urlencode, urlsplit

from hermes_constants import get_hermes_home

_log = logging.getLogger(__name__)
ATTACH_PATH = "/api/session-attach"


def _loopback(host: str) -> bool:
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _origin(web) -> str | None:
    host = getattr(web.app.state, "bound_host", "") or ""
    port = getattr(web.app.state, "bound_port", None)
    # Wildcard listeners also serve loopback; never advertise their public address.
    host = {"localhost": "127.0.0.1", "0.0.0.0": "127.0.0.1", "::": "::1"}.get(host, host)
    if not _loopback(host) or not isinstance(port, int) or not 0 < port < 65536:
        return None
    authority = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
    return f"http://{authority}"


def _credential(web) -> tuple[str, str]:
    if getattr(web.app.state, "auth_required", False):
        from hermes_cli.dashboard_auth.ws_tickets import internal_ws_credential
        return "internal", internal_ws_credential()
    return "token", web._SESSION_TOKEN


def owner_metadata(live_session_id: str, profile_home=None) -> dict:
    metadata = {"live_session_id": live_session_id, "bot_live_delivery_consumer": True}
    # A standalone stdio backend must not import/start a dashboard to advertise.
    web = sys.modules.get("hermes_cli.web_server")
    if web is None or (origin := _origin(web)) is None:
        return metadata
    home = Path(profile_home or get_hermes_home()).resolve()
    directory = home / "runtime" / "session-attach"
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
                or directory.resolve() != directory):
            raise OSError("private discovery directory is not private")
        from utils import atomic_json_write
        _, credential = _credential(web)
        atomic_json_write(directory / (hashlib.sha256(origin.encode()).hexdigest() + ".json"),
                          {"shared_runtime_url": origin, "profile_home": str(home),
                           "authorization": f"Bearer {credential}"}, mode=0o600)
    except OSError:
        # Discovery is optional; a filesystem problem must not prevent the owner
        # working, nor publish an endpoint the next local client cannot authorize.
        _log.warning("Could not publish private session attachment discovery")
        return metadata
    metadata["shared_runtime_url"] = origin
    return metadata


def _owner_matches(session_id: str, lease_id: str, profile_home: str) -> bool:
    from tui_gateway import server
    from hermes_cli.active_sessions import active_session_registry_snapshot

    if not session_id or not lease_id or not profile_home:
        return False
    # Match an already-open profile before touching a client-supplied path.
    with server._sessions_lock:
        matches = [session for session in server._sessions.values()
                   if session.get("session_key") == session_id
                   and str(Path(session.get("profile_home") or get_hermes_home()).resolve()) == profile_home
                   and not session.get("_closing") and not session.get("_finalized")]
        if len(matches) != 1:
            return False
        lease = matches[0].get("active_session_lease")
        if (lease is None or lease.lease_id != lease_id or lease.released
                or not lease.enabled or lease.session_id != session_id):
            return False
        try:
            owners = [row for row in active_session_registry_snapshot(profile_home, strict=True)
                      if row.get("session_id") == session_id]
        except Exception:
            _log.warning("Could not verify session attachment ownership")
            return False
        return len(owners) == 1 and owners[0].get("lease_id") == lease_id


def _local_native(request, web) -> bool:
    from hermes_cli.web_server import _is_accepted_host
    origin = _origin(web)
    return bool(origin and request.client and _loopback(request.client.host)
                and "origin" not in request.headers
                and _is_accepted_host(request.headers.get("host", ""), urlsplit(origin).hostname or "", frozenset()))


async def handshake(request):
    """Exact-path HTTP auth seam; never sets an auth bypass flag for other routes."""
    import asyncio
    from fastapi.responses import JSONResponse
    from hermes_cli import web_server as web

    def reply(status, content):
        return JSONResponse(content, status_code=status, headers={"Cache-Control": "no-store"})

    origin = _origin(web)
    if origin is None or not _local_native(request, web):
        return reply(403, {"detail": "Local native attachment only"})
    if request.method != "GET":
        return reply(405, {"detail": "GET required"})
    auth = request.headers.get("authorization", "")
    if getattr(web.app.state, "auth_required", False):
        from hermes_cli.dashboard_auth.ws_tickets import TicketInvalid, consume_internal_credential
        try:
            consume_internal_credential(auth.removeprefix("Bearer ") if auth.startswith("Bearer ") else "")
        except TicketInvalid:
            return reply(401, {"detail": "Unauthorized"})
    elif not web._has_valid_session_token(request):
        return reply(401, {"detail": "Unauthorized"})
    fields = ("session_id", "lease_id", "profile_home")
    pins = {key: request.query_params.get(key, "") for key in fields}
    if (any(len(request.query_params.getlist(key)) != 1 for key in fields)
            or not await asyncio.to_thread(_owner_matches, **pins)):
        return reply(409, {"detail": "Session owner changed or unavailable"})
    key, credential = _credential(web)
    qs = {key: credential, **{f"attach_{key}": value for key, value in pins.items()}}
    return reply(200, {**pins, "websocket_url": origin.replace("http://", "ws://", 1)
                      + "/api/ws?" + urlencode(qs)})


async def allow_upgrade(ws) -> bool:
    """Fence a discovered URL again after normal WS authentication, before accept."""
    import asyncio
    from hermes_cli import web_server as web

    fields = ("session_id", "lease_id", "profile_home")
    if not any(f"attach_{key}" in ws.query_params for key in fields):
        return True
    pins = {key: ws.query_params.get(f"attach_{key}", "") for key in fields}
    if (not _local_native(ws, web)
            or any(len(ws.query_params.getlist(f"attach_{key}")) != 1 for key in fields)
            or not await asyncio.to_thread(_owner_matches, **pins)):
        await ws.close(code=4409, reason="session owner changed or unavailable")
        return False
    return True
