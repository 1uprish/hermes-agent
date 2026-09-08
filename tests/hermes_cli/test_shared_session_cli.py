"""Cooperative viewers never initialize an agent or close the owner."""
import argparse
import asyncio
import json

import pytest


@pytest.mark.parametrize("tui", [False, True])
def test_live_resume_bypasses_provider_setup(monkeypatch, tui):
    from hermes_cli import main, shared_session_attach
    from hermes_cli import shared_session_cli

    args = argparse.Namespace(resume="stored", tui=tui)
    for name in ("_apply_safe_mode", "_apply_user_config_bypass", "_guard_noninteractive_user_config",
                 "_resolve_chat_session_args"):
        monkeypatch.setattr(main, name, lambda *a: None)
    monkeypatch.setattr(main, "_resolve_use_tui", lambda a: tui)
    monkeypatch.setattr(main, "_has_any_provider_configured", lambda: pytest.fail("provider guard reached"))
    monkeypatch.setattr(shared_session_attach, "discover_attach_url", lambda sid: "ws://127.0.0.1:123/api/ws?token=test")
    launches = []
    monkeypatch.setattr(shared_session_cli, "run_attached_cli", lambda url, sid: launches.append((url, sid)))
    monkeypatch.setattr(main, "_launch_tui", lambda sid, **kw: launches.append(("tui", sid)))
    main.cmd_chat(args)
    assert launches and launches[0][1] == "stored"


def test_rpc_viewer_replays_routes_commands_and_only_detaches():
    from aiohttp import web
    from hermes_cli.shared_session_cli import AttachedCLI

    async def scenario():
        requests, output = [], []
        async def socket(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            async for frame in ws:
                msg = json.loads(frame.data)
                requests.append(msg)
                method = msg["method"]
                result = {"status": "queued"}
                if method == "session.resume":
                    result = {"session_id": "live", "messages": [{"role": "user", "text": "history"}],
                              "pending_approval": {"request_id": "approve-one", "command": "inert"}}
                if method == "session.events.since":
                    result = {"events": [{"session_id": "live", "seq": 1, "type": "tool.start",
                                          "payload": {"name": "test-tool"}}], "latest_seq": 1}
                if method == "approval.respond":
                    result = {"resolved": len([r for r in requests if r["method"] == method]) == 1}
                await ws.send_json({"jsonrpc": "2.0", "id": msg["id"], "result": result})
            return ws
        app = web.Application()
        app.router.add_get("/api/ws", socket)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with AttachedCLI(f"ws://127.0.0.1:{port}/api/ws", "stored", output.append) as viewer:
                await viewer.attach()
                for command in ("hello", "/steer focus", "/queue later", "/interrupt", "/approve approve-one", "/approve approve-one"):
                    await viewer.submit(command)
                assert await viewer.submit("/exit") is False
        finally:
            await runner.cleanup()
        methods = [msg["method"] for msg in requests]
        assert methods == ["session.resume", "session.events.since", "prompt.submit", "session.steer",
                           "prompt.submit", "session.interrupt", "approval.respond", "approval.respond"]
        assert requests[4]["params"]["queued"] is True
        assert requests[6]["params"] == {"session_id": "live", "request_id": "approve-one", "choice": "once", "all": False}
        assert "history" in "\n".join(output) and "test-tool" in "\n".join(output)
        assert "not accepted" in "\n".join(output)
    asyncio.run(scenario())
