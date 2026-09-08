"""The private owner handshake uses real registry, HTTP gates, and WS admission."""
import hashlib
import json
import threading
from urllib.parse import urlencode, urlsplit

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


pytestmark = pytest.mark.linux_only  # Private POSIX mode contract exercised on the real host.


@pytest.fixture
def owner(tmp_path, monkeypatch):
    from hermes_cli import web_server as web
    from tui_gateway import server
    from hermes_cli.active_sessions import active_session_registry_snapshot

    home = tmp_path / "profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(server, "_load_cfg", lambda: {})
    monkeypatch.setattr(server, "_sessions", {})
    from hermes_state import SessionDB
    db = SessionDB(home / "state.db")
    db.create_session("durable-owner", source="tui")
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(web.app.state, "bound_host", "127.0.0.1", raising=False)
    monkeypatch.setattr(web.app.state, "bound_port", 18765, raising=False)
    monkeypatch.setattr(web.app.state, "trusted_public_hosts", frozenset(), raising=False)
    monkeypatch.setattr(web.app.state, "auth_required", True, raising=False)
    monkeypatch.setattr(server, "resolve_skin", lambda: {})
    lease, error = server._claim_active_session_slot(
        "durable-owner", live_session_id="live-owner", profile_home=home)
    assert error is None
    session = {"session_key": "durable-owner", "profile_home": str(home),
               "active_session_lease": lease, "history_lock": threading.RLock()}
    server._sessions["live-owner"] = session
    client = TestClient(web.app, base_url="http://127.0.0.1:18765", client=("127.0.0.1", 50000))
    yield web, server, home, lease, client, active_session_registry_snapshot
    lease.release()
    client.close()
    db.close()


def test_private_advertisement_auth_and_identity_fences(owner, monkeypatch):
    web, server, home, lease, client, snapshot = owner
    row = snapshot(home, strict=True)[0]
    origin = row["metadata"].get("shared_runtime_url")
    assert origin == "http://127.0.0.1:18765"
    path = home / "runtime" / "session-attach" / (hashlib.sha256(origin.encode()).hexdigest() + ".json")
    record = json.loads(path.read_text())
    assert path.stat().st_mode & 0o077 == 0
    assert path.parent.stat().st_mode & 0o077 == 0
    assert record["authorization"] not in json.dumps(row)
    assert record["profile_home"] == str(home)
    pins = {"session_id": "durable-owner", "lease_id": lease.lease_id, "profile_home": str(home)}
    headers = {"Authorization": record["authorization"]}
    route = "/api/session-attach"
    assert client.get(route, params=pins).status_code == 401
    assert client.get(route, params=pins, headers={"Authorization": "Bearer " + web._SESSION_TOKEN}).status_code == 401
    assert client.get(route, params=pins, headers={**headers, "Origin": origin}).status_code == 403
    assert client.get(route, params=pins, headers={**headers, "Host": "evil.example"}).status_code == 403
    assert client.post(route, params=pins, headers=headers).status_code == 405
    remote = TestClient(web.app, base_url=origin, client=("192.0.2.1", 50000))
    assert remote.get(route, params=pins, headers=headers).status_code == 403
    remote.close()
    for field, bad in [("lease_id", "stale"), ("session_id", "other"), ("profile_home", str(home.parent))]:
        assert client.get(route, params={**pins, field: bad}, headers=headers).status_code == 409
    response = client.get(route, params=pins, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    reply = response.json()
    assert all(reply[key] == value for key, value in pins.items())
    assert urlsplit(reply["websocket_url"]).netloc == urlsplit(origin).netloc
    assert snapshot(home, strict=True)[0]["lease_id"] == lease.lease_id
    # Legacy bearer must not gain authority on any other gated route.
    assert client.get("/api/sessions", headers=headers).status_code in (401, 403)
    session = server._sessions.pop("live-owner")
    assert client.get(route, params=pins, headers=headers).status_code == 409
    server._sessions["live-owner"] = session
    assert server._transfer_active_session_slot("live-owner", session, new_session_id="compressed-owner")
    session["session_key"] = "compressed-owner"
    assert snapshot(home, strict=True)[0]["metadata"]["shared_runtime_url"] == origin
    assert client.get(route, params=pins, headers=headers).status_code == 409
    assert client.get(route, params={**pins, "session_id": "compressed-owner"}, headers=headers).status_code == 200
    monkeypatch.setattr(web.app.state, "bound_host", "192.0.2.1")
    from tui_gateway.session_attach import owner_metadata
    assert "shared_runtime_url" not in owner_metadata("another-live", home)


@pytest.mark.parametrize("gated, bind_host", [(False, "127.0.0.1"), (True, "127.0.0.1"), (True, "0.0.0.0")])
def test_upgrade_rechecks_owner_after_handshake(owner, monkeypatch, gated, bind_host):
    web, server, home, lease, client, snapshot = owner
    monkeypatch.setattr(web.app.state, "auth_required", gated)
    monkeypatch.setattr(web.app.state, "bound_host", bind_host)
    # Claim another owner after changing auth mode, exercising credential publication.
    second, error = server._claim_active_session_slot(
        "second-owner", live_session_id="second-live", profile_home=home)
    assert error is None
    server._sessions["second-live"] = {**server._sessions["live-owner"],
        "session_key": "second-owner", "active_session_lease": second}
    try:
        origin = snapshot(home, strict=True)[0]["metadata"].get("shared_runtime_url")
        assert origin
        record = json.loads((home / "runtime" / "session-attach" /
            (hashlib.sha256(origin.encode()).hexdigest() + ".json")).read_text())
        pins = {"session_id": "second-owner", "lease_id": second.lease_id, "profile_home": str(home)}
        response = client.get("/api/session-attach?" + urlencode(pins),
                              headers={"Authorization": record["authorization"]})
        assert response.status_code == 200, response.text
        url = response.json()["websocket_url"]
        with client.websocket_connect(url) as ws:
            frame = json.loads(ws.receive_text())
            assert frame["params"]["type"] == "gateway.ready"
        # A stale URL must not connect even though its process credential remains valid.
        second.release()
        with pytest.raises(WebSocketDisconnect) as caught:
            with client.websocket_connect(url):
                pass
        assert caught.value.code == 4409
        assert client.get("/api/session-attach", params=pins,
                          headers={"Authorization": record["authorization"]}).status_code == 409
    finally:
        second.release()


def rpc(ws, method, **params):
    ws.send_json({"jsonrpc": "2.0", "id": method, "method": method, "params": params})
    while True:
        frame = json.loads(ws.receive_text())
        if frame.get("id") == method:
            return frame


def attach_url(home, lease, client):
    record = json.loads(next((home / "runtime/session-attach").glob("*.json")).read_text())
    response = client.get("/api/session-attach", params={
        "session_id": "durable-owner", "lease_id": lease.lease_id, "profile_home": str(home)},
        headers={"Authorization": record["authorization"]})
    assert response.status_code == 200
    return response.json()["websocket_url"]


@pytest.mark.linux_only
@pytest.mark.parametrize("lost", ["released", "replaced", "removed"])
def test_resume_after_upgrade_never_recreates_or_reclaims_owner(owner, lost):
    _, server, home, lease, client, snapshot = owner
    original = server._sessions["live-owner"]
    with client.websocket_connect(attach_url(home, lease, client)) as ws:
        ws.receive_text()
        if lost == "released":
            lease.release()
        elif lost == "replaced":
            server._sessions["live-owner"] = dict(original)
        else:
            server._sessions.pop("live-owner")
        before = snapshot(home, strict=True)
        result = rpc(ws, "session.resume", session_id="durable-owner", lazy=True, force=True)
        assert result.get("error", {}).get("code") == 4409, result
        assert snapshot(home, strict=True) == before
        assert len(server._sessions) == (0 if lost == "removed" else 1)


@pytest.mark.linux_only
def test_same_socket_follows_own_compression_but_not_a_replacement_lease(owner):
    _, server, home, lease, client, snapshot = owner
    original = server._sessions["live-owner"]
    original.update(history=[], agent=None, running=False)
    with client.websocket_connect(attach_url(home, lease, client)) as ws:
        ws.receive_text()
        first = rpc(ws, "session.resume", session_id="durable-owner", lazy=True)
        assert first.get("result", {}).get("session_id") == "live-owner", first
        assert server._transfer_active_session_slot("live-owner", original, new_session_id="compressed")
        original["session_key"] = "compressed"
        resumed = rpc(ws, "session.resume", session_id="durable-owner", lazy=True)
        assert resumed.get("result", {}).get("session_id") == "live-owner", resumed
        assert resumed["result"]["resumed"] == "compressed"
        lease.release()
        replacement, error = server._claim_active_session_slot(
            "compressed", live_session_id="live-owner", profile_home=home)
        assert error is None
        original["active_session_lease"] = replacement
        try:
            before = snapshot(home, strict=True)
            refused = rpc(ws, "session.resume", session_id="compressed", lazy=True, force=True)
            assert refused.get("error", {}).get("code") == 4409, refused
            assert rpc(ws, "prompt.submit", session_id="live-owner", prompt="not admitted").get(
                "error", {}).get("code") == 4409
            assert snapshot(home, strict=True) == before
            assert server._sessions["live-owner"] is original
        finally:
            replacement.release()
