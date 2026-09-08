"""Small prompt_toolkit/Rich viewer for an existing cooperative RPC owner.

This module never imports the agent, acquires a lease, or writes a transcript.
The authenticated owner remains the sole authority for admission and approvals.
"""
from __future__ import annotations

import asyncio
import contextlib
import json


class AttachedCLI:
    def __init__(self, url, session_id, output):
        self.url, self.session_id, self.output = url, session_id, output
        self._pending = {}
        self._next_id = 0
        self._seq = 0
        self._ready = False
        self._buffer = []
        self._stream = ""
        self.closed = asyncio.Event()

    async def __aenter__(self):
        import aiohttp
        self._http = aiohttp.ClientSession(trust_env=False)
        try:
            self._ws = await self._http.ws_connect(self.url, max_msg_size=16 * 1024 * 1024)
        except BaseException:
            await self._http.close()
            raise
        self._reader = asyncio.create_task(self._receive())
        return self

    async def __aexit__(self, *exc):
        # Closing a viewer must not call session.close or session.interrupt.
        await self._ws.close()
        await self._reader
        await self._http.close()

    async def _receive(self):
        try:
            async for frame in self._ws:
                if not isinstance(frame.data, str):
                    continue
                for line in frame.data.splitlines():
                    msg = json.loads(line)
                    future = self._pending.get(msg.get("id"))
                    if future is not None and not future.done():
                        if "error" in msg:
                            future.set_exception(ValueError(str(msg["error"].get("message", "Request rejected"))))
                        else:
                            future.set_result(msg.get("result", {}))
                    if msg.get("method") == "event":
                        event = msg.get("params", {})
                        if self._ready:
                            self.event(event)
                        else:
                            self._buffer.append(event)
        finally:
            self.closed.set()
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(ConnectionError("Owner disconnected; viewer detached."))

    async def rpc(self, method, **params):
        self._next_id += 1
        rid = self._next_id
        future = asyncio.get_running_loop().create_future()
        self._pending[rid] = future
        try:
            await self._ws.send_json({"jsonrpc": "2.0", "id": rid, "method": method,
                                      "params": {"session_id": self.session_id, **params}})
            return await asyncio.wait_for(future, timeout=30)
        finally:
            self._pending.pop(rid, None)

    async def attach(self):
        snapshot = await self.rpc("session.resume")
        self.session_id = snapshot["session_id"]
        self.output("Attached to shared session. /exit detaches; /interrupt stops the shared turn.")
        for message in snapshot.get("messages", []):
            self.output(f"{message.get('role', 'message')}: {message.get('text', message.get('content', ''))}")
        inflight = snapshot.get("inflight") or {}
        if inflight.get("user"):
            self.output("user: " + inflight["user"])
        self._stream = inflight.get("assistant") or ""
        if self._stream:
            self.output("assistant: " + self._stream)
        for key in ("pending_approval", "pending_clarify"):
            if snapshot.get(key):
                self.output(key + ": " + json.dumps(snapshot[key], ensure_ascii=False))
        if snapshot.get("queued"):
            self.output("queued: " + json.dumps(snapshot["queued"], ensure_ascii=False))
        await self.replay(initial=True)
        self._ready = True
        for event in self._buffer:
            self.event(event)
        self._buffer.clear()

    async def replay(self, *, initial=False):
        result = await self.rpc("session.events.since", last_seen=self._seq)
        if result.get("truncated") and not initial:
            self.output("Replay window expired; /exit and resume to reload the transcript.")
        for event in result.get("events", []):
            # The initial transcript/inflight snapshot already renders message text.
            # Replay still restores tool activity and pending control events.
            live_seqs = {frame.get("seq") for frame in self._buffer}
            self.event(event, skip_messages=initial and event.get("seq") not in live_seqs)
        self._seq = max(self._seq, result.get("latest_seq", 0))

    def event(self, event, *, skip_messages=False):
        if event.get("session_id") != self.session_id:
            return
        seq = event.get("seq", 0)
        if seq and seq <= self._seq:
            return
        self._seq = max(self._seq, seq)
        kind, payload = event.get("type", ""), event.get("payload") or {}
        if kind == "message.delta":
            if not skip_messages:
                text = payload.get("delta", payload.get("text", ""))
                self._stream += text
                self.output(text)
            return
        if kind == "message.complete":
            if not skip_messages:
                text = payload.get("text", "")
                if text and not self._stream:
                    self.output("assistant: " + text)
                self.output("[turn complete]")
                self._stream = ""
            return
        if kind.startswith(("tool.", "approval.", "clarify.", "session.", "prompt.")):
            self.output(kind + ": " + json.dumps(payload, ensure_ascii=False))

    async def submit(self, text):
        command, _, arg = text.strip().partition(" ")
        if command in ("/exit", "/quit", "/detach"):
            return False
        if command == "/help":
            self.output("Text sends to owner. /steer TEXT, /queue TEXT, /interrupt, /replay, "
                        "/approve REQUEST_ID, /deny REQUEST_ID, /clarify REQUEST_ID ANSWER, /exit")
            return True
        if command == "/replay":
            await self.replay()
            return True
        if command in ("/approve", "/deny"):
            if not arg.strip():
                self.output("An exact approval request ID is required.")
                return True
            result = await self.rpc("approval.respond", request_id=arg.strip(),
                                    choice="once" if command == "/approve" else "deny", all=False)
            self.output("Approval accepted." if result.get("resolved") else "Approval not accepted (already resolved or stale).")
            return True
        if command == "/clarify":
            request_id, _, answer = arg.partition(" ")
            result = await self.rpc("clarify.respond", request_id=request_id, answer=answer)
        else:
            routes = {"/steer": ("session.steer", {"text": arg}),
                      "/queue": ("prompt.submit", {"text": arg, "queued": True}),
                      "/interrupt": ("session.interrupt", {})}
            if command.startswith("/") and command not in routes:
                self.output("Unknown viewer command. /help lists supported commands.")
                return True
            method, params = routes.get(command, ("prompt.submit", {"text": text, "queued": False}))
            result = await self.rpc(method, **params)
        self.output(json.dumps(result, ensure_ascii=False))
        return True


async def _run(url, session_id):
    from prompt_toolkit import PromptSession
    from prompt_toolkit.patch_stdout import patch_stdout
    from rich.console import Console

    console = Console()
    prompt = PromptSession()
    with patch_stdout():
        async with AttachedCLI(url, session_id, lambda text: console.print(text, markup=False, highlight=False)) as viewer:
            await viewer.attach()
            while not viewer.closed.is_set():
                read = asyncio.create_task(prompt.prompt_async("shared> "))
                disconnected = asyncio.create_task(viewer.closed.wait())
                try:
                    done, _ = await asyncio.wait((read, disconnected), return_when=asyncio.FIRST_COMPLETED)
                    if disconnected in done:
                        console.print("Owner disconnected; viewer detached.")
                        break
                    text = read.result()
                    if text.strip() and not await viewer.submit(text):
                        break
                except KeyboardInterrupt:
                    await viewer.submit("/interrupt")
                except EOFError:
                    break
                except ValueError as exc:
                    console.print(str(exc), markup=False)
                finally:
                    for task in (read, disconnected):
                        if not task.done():
                            task.cancel()
                            with contextlib.suppress(asyncio.CancelledError):
                                await task


def run_attached_cli(url, session_id):
    try:
        asyncio.run(_run(url, session_id))
    except (OSError, TimeoutError, ValueError):
        # Transport exceptions may contain the credential-bearing URL.
        print("Could not attach to the live owner; its session was left intact.")
        raise SystemExit(1) from None
