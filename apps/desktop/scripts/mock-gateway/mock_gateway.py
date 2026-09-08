#!/usr/bin/env python3
"""
Mock Hermes gateway — a scripted, deterministic stand-in for the real
`hermes serve` backend, so the desktop renderer (Electron) can be developed
and demoed with ZERO dependencies: no backend spawn, no venv, no portal
auth, no LLM calls, no network.

Two ways the desktop app can land on this gateway:

1. HERMES_DESKTOP_PYTHON=<dir>/mock_hermes_shim.py — the app spawns its local
   backend per profile as `<python> -m hermes_cli.main serve --port 0`; the
   shim intercepts that spawn and runs this gateway, announcing
   HERMES_BACKEND_READY on stdout. This is the recommended dev path (see
   dev-magic-mock.sh). Each PROFILE gets its own process; all processes share
   ONE state file (HERMES_MOCK_STATE) so Setup's chat, the task bot's chat,
   and the roster stay one logical gateway.

2. HERMES_DESKTOP_REMOTE_URL=http://127.0.0.1:8778 + _REMOTE_TOKEN — token-auth
   remote mode; the app never spawns anything. `python3 mock_gateway.py` runs
   the same server standalone.

Protocol surface implemented:
  * REST: /api/status, /api/health, /api/config*, /api/model/*, /api/sessions*
    (incl. messages hydration), profiles (+ /active, /sessions, /sidebar),
    cron, skills, env, memory, toolsets, fs/default-cwd, mcp, messaging,
    pairing, analytics, gh-auth, update-check, actions — canned but
    shape-correct so boot surfaces stay quiet. `/` serves the injected
    dashboard-token page the desktop main process reads after spawn.
  * WS JSON-RPC 2.0: session.create (with seeded messages / hidden / title),
    session.list (include_hidden + title filters), session.title / resume /
    close / interrupt / set_hidden, config.set/get, setup.status /
    setup.runtime_check (boot-paced), prompt.submit (scenario-driven),
    profiles.create / configure / list (bot minting), model.options,
    commands.catalog, cron.manage, plus quiet stubs.
  * Events: session.info, message.start, message.delta, message.complete —
    broadcast to every open WS, exactly like the real gateway.

prompt.submit is answered by scenario.py, which replays scripted agent turns
for the guided onboarding flow. Everything else returns canned-but-shaped data.

Stdlib only. Run:  python3 mock_gateway.py  (port 8778 unless MOCK_PORT set)
"""

import json
import os
import re
import struct
import sys
import tempfile
import threading
import time
from base64 import b64encode
from hashlib import sha1
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import fcntl  # POSIX advisory locks (macOS/Linux)
except ImportError:  # pragma: no cover — dev tool targets mac/linux
    fcntl = None

HOST = os.environ.get('MOCK_HOST', '127.0.0.1')
PORT = int(os.environ.get('MOCK_PORT', '8778'))
# ms per ~3-char delta chunk on visible turns. 28 → ~110 chars/s, a
# fast-model feel. Hidden turns skip deltas entirely (complete in ~120ms).
CHAR_MS = float(os.environ.get('MOCK_CHAR_MS', '28'))
# Boot window in which readiness answers "unconfigured" so the first-run
# intro plays (see Gateway._configured).
MOCK_UNCONFIGURED_MS = float(os.environ.get('MOCK_UNCONFIGURED_MS', '6000'))
# Shared state file. Every shim process (one per profile) opens this, so the
# whole guided flow — Setup's chat, the minted task bot, the roster — reads
# and writes ONE logical store.
STATE_PATH = os.environ.get(
    'HERMES_MOCK_STATE',
    os.path.join(os.environ.get('HERMES_HOME') or tempfile.gettempdir(), 'mock-state.json'),
)

WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

# ─────────────────────────────────────────────────────────────────────────────
# WebSocket frame codec (RFC 6455, text frames, server side)
# ─────────────────────────────────────────────────────────────────────────────


def _recv_exact(conn, n):
    buf = b''
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError('socket closed mid-frame')
        buf += chunk
    return buf


def read_ws_frame(conn):
    b1, b2 = _recv_exact(conn, 2)
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack('>H', _recv_exact(conn, 2))[0]
    elif length == 127:
        length = struct.unpack('>Q', _recv_exact(conn, 8))[0]
    mask = _recv_exact(conn, 4) if masked else None
    payload = _recv_exact(conn, length)
    if mask:
        payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
    return opcode, payload


def send_ws_frame(conn, payload, opcode=1):
    if isinstance(payload, str):
        payload = payload.encode('utf-8')
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + struct.pack('>H', n)
    else:
        header += bytes([127]) + struct.pack('>Q', n)
    conn.sendall(header + payload)


def ws_accept(key):
    return b64encode(sha1((key + WS_MAGIC).encode('utf-8')).digest()).decode('ascii')


# ─────────────────────────────────────────────────────────────────────────────
# Shared state store (file-backed, safe across shim processes)
# ─────────────────────────────────────────────────────────────────────────────


def _default_state():
    return {
        'next_id': 1,
        'sessions': {},       # id -> session dict
        'profiles': {         # name -> {description, ui_meta, created}
            'default': {
                'description': 'Primary profile',
                'ui_meta': {},
                'created': int(time.time() * 1000),
            }
        },
        'config': {
            'model': {'provider': 'nous', 'default': 'deepseek/deepseek-v4-flash-0731'},
            'agent': {'reasoning_effort': 'minimal'},
            'web': {'backend': 'nous'},
            'tts': {'provider': 'nous'},
            'image_gen': {'provider': 'nous'},
        },
    }


def _new_session_dict(session_id, hidden=False, title='', profile='default', model=None):
    return {
        'id': session_id,
        'hidden': hidden,
        'title': title,
        'profile': profile,
        'model': model or 'deepseek/deepseek-v4-flash-0731',
        'messages': [],        # [{role, content, display_kind, created_at}]
        'created': time.time(),
        'last_active': time.time(),
        'step': 'name',        # scenario step machine (guide sessions)
    }


class Store:
    """Read-modify-write JSON store. Every op reloads the file, so concurrent
    shim processes always see each other's writes — guarded by an advisory
    lock so a load→mutate→save cycle is atomic ACROSS processes too."""

    def __init__(self):
        self.lock = threading.RLock()
        self._file_lock = open(STATE_PATH + '.lock', 'a+')

    def load(self):
        try:
            with open(STATE_PATH, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except (OSError, ValueError):
            state = _default_state()
        for key, value in _default_state().items():
            if key not in state:
                state[key] = value
        state.setdefault('sessions', {})
        state.setdefault('profiles', {})
        state.setdefault('config', {})
        return state

    def save(self, state):
        tmp = STATE_PATH + '.tmp'
        os.makedirs(os.path.dirname(STATE_PATH) or '.', exist_ok=True)
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f)
        os.replace(tmp, STATE_PATH)

    def _locked(self, fn, write):
        with self.lock:
            if fcntl is not None:
                fcntl.flock(self._file_lock, fcntl.LOCK_EX)
            try:
                state = self.load()
                result = fn(state)
                if write:
                    self.save(state)
                return result
            finally:
                if fcntl is not None:
                    fcntl.flock(self._file_lock, fcntl.LOCK_UN)

    def mutate(self, fn):
        return self._locked(fn, write=True)

    def read(self, fn):
        return self._locked(fn, write=False)


def _session_info(s):
    visible = [m for m in s['messages'] if m.get('display_kind') != 'hidden']
    return {
        'id': s['id'],
        'resolved_id': s['id'],
        'title': s['title'] or 'New chat',
        'message_count': len(visible),
        'model': s['model'],
        'provider': 'nous',
        'is_active': not s['hidden'],
        'hidden': s['hidden'],
        'last_active': int(s['last_active'] * 1000),
        'started_at': int(s['created'] * 1000),
        'ended_at': None,
        'input_tokens': 0,
        'output_tokens': 0,
        'archived': False,
        'pinned': False,
        'cwd': None,
        'git_branch': None,
        'git_repo_root': None,
        'source': 'desktop',
        'profile': s['profile'],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Gateway (RPC + events)
# ─────────────────────────────────────────────────────────────────────────────


class Gateway:
    def __init__(self, profile='default'):
        self.store = Store()
        self.conns = []             # [(socket, send_lock), ...] — every event
        self.scenario = None        # goes to every open WS, like the real gateway
        self.requests = 0           # rough traffic counter (status endpoint)
        self._started = time.time()
        self.profile = profile     # which profile THIS process serves

    # ── readiness pacing ──
    def _configured(self):
        """The first-run intro fires ONLY while the runtime reads UNCONFIGURED
        (configured === false exactly — null skips it too). Answer unconfigured
        for the first MOCK_UNCONFIGURED_MS of process life, then configured —
        the same shape a real backend boot produces."""
        return time.time() - self._started >= MOCK_UNCONFIGURED_MS / 1000.0

    # ── store helpers ──
    def get_session(self, sid):
        return self.store.read(lambda s: s['sessions'].get(sid))

    def record(self, sid, role, content, display_kind=None):
        def _do(state):
            session = state['sessions'].get(sid)
            if not session:
                return None
            session['messages'].append({
                'role': role,
                'content': content,
                'display_kind': display_kind,
                'created_at': int(time.time() * 1000),
            })
            session['last_active'] = time.time()
            return session
        return self.store.mutate(_do)

    def touch_step(self, sid, step):
        def _do(state):
            session = state['sessions'].get(sid)
            if session:
                session['step'] = step
            return session
        return self.store.mutate(_do)

    # ── event emission ──
    def emit(self, sid, event_type, payload=None, extra=None):
        frame = {
            'jsonrpc': '2.0',
            'method': 'event',
            'params': {'type': event_type, 'payload': payload or {}},
        }
        if sid:
            frame['params']['session_id'] = sid
        if extra:
            frame['params'].update(extra)
        conns = list(self.conns)
        data = json.dumps(frame)
        for conn, send_lock in conns:
            with send_lock:
                try:
                    send_ws_frame(conn, data)
                except OSError:
                    pass

    # ── scripted turn playback ──
    def play_turn(self, sid, reply_text):
        """Stream a scripted assistant reply exactly like the real gateway:
        session.info running=true → message.start → message.delta* →
        message.complete → session.info running=false."""
        session = self.get_session(sid)
        if not session:
            return

        self.emit(sid, 'session.info', {'running': True})
        self.emit(sid, 'message.start', {'display_kind': 'visible'})

        # Hidden HELPER sessions (populate / module-gen on the default profile)
        # complete instantly. The Setup chat and task-bot chats are "hidden"
        # canonicals too, but they are the user's ACTIVE views — stream them.
        stream = session.get('profile') != 'default'

        if not stream:
            time.sleep(0.12)
        else:
            i = 0
            while i < len(reply_text):
                chunk = reply_text[i:i + 3]
                self.emit(sid, 'message.delta', {'text': chunk})
                i += 3
                time.sleep(CHAR_MS / 1000.0)

        usage = {
            'calls': 1,
            'input': max(1, len(reply_text) // 4),
            'output': max(1, len(reply_text)),
            'total': max(2, len(reply_text) + len(reply_text) // 4),
        }
        self.emit(sid, 'message.complete', {
            'text': reply_text,
            'status': 'ok',
            'usage': usage,
        })
        self.record(sid, 'assistant', reply_text)
        self.emit(sid, 'session.info', {'running': False})

    # ── JSON-RPC dispatch ──
    def handle_rpc(self, method, params):
        params = params or {}
        sid = params.get('session_id')

        if method == 'session.create':
            # Adopt-before-mint: a hidden canonical ("Bot Chat") is unique per
            # profile on the real backend (UNIQUE(title) — the exact-title
            # session.list lookup the wiring performs exists for this reason).
            # Mirror it here so a double kickoff (intro chain + resume path
            # racing, dev re-kick) resumes the existing chat instead of
            # minting a second canonical whose title stamp loses to the index.
            want_title = params.get('title') or ''
            if bool(params.get('hidden')) and want_title == 'Bot Chat':
                def _find(state):
                    for s in state['sessions'].values():
                        if s['hidden'] and s['title'] == want_title and s['profile'] == self.profile:
                            return s
                    return None
                existing = self.store.read(_find)
                if existing:
                    return {
                        'session_id': existing['id'],
                        'stored_session_id': existing['id'],
                        'title': existing['title'],
                        'hidden': True,
                        'adopted': True,
                    }

            def _do(state):
                sid = 'mock-%d' % state['next_id']
                state['next_id'] += 1
                session = _new_session_dict(
                    sid,
                    hidden=bool(params.get('hidden')),
                    title=want_title,
                    profile=self.profile,
                    model=params.get('model'),
                )
                # Seeded history (guided onboarding runbook + greeting) rides
                # session.create so the rows exist server-side from instant one.
                for row in params.get('messages') or []:
                    if not isinstance(row, dict):
                        continue
                    session['messages'].append({
                        'role': row.get('role', 'user'),
                        'content': str(row.get('content', '')),
                        'display_kind': row.get('display_kind'),
                        'created_at': int(time.time() * 1000),
                    })
                state['sessions'][sid] = session
                return session
            session = self.store.mutate(_do)
            return {
                'session_id': session['id'],
                'stored_session_id': session['id'],
                'title': session['title'] or 'New chat',
                'hidden': session['hidden'],
            }

        if method == 'session.list':
            def _do(state):
                want_title = params.get('title')
                include_hidden = bool(params.get('include_hidden'))
                rows = [
                    s for s in state['sessions'].values()
                    if (include_hidden or not s['hidden'])
                    and (not want_title or s['title'] == want_title)
                ]
                rows.sort(key=lambda s: s['last_active'], reverse=True)
                return rows
            rows = self.store.read(_do)
            return {'sessions': [_session_info(s) for s in rows], 'total': len(rows)}

        if method == 'session.title':
            def _do(state):
                session = state['sessions'].get(sid)
                if session:
                    session['title'] = params.get('title', session['title'])
                return session
            self.store.mutate(_do)
            return {'ok': True}

        if method == 'session.resume':
            session = self.get_session(sid)
            if not session:
                return {'ok': False, 'error': 'session not found'}
            return {
                'ok': True,
                'session_id': session['id'],
                'stored_session_id': session['id'],
            }

        if method == 'session.close':
            return {'ok': True}

        if method == 'session.interrupt':
            return {'ok': True}

        if method == 'session.set_hidden':
            def _do(state):
                session = state['sessions'].get(sid)
                if session:
                    session['hidden'] = bool(params.get('hidden'))
                return session
            self.store.mutate(_do)
            return {'ok': True}

        if method == 'config.get':
            def _do(state):
                return dict(state['config'])
            return {'config': self.store.read(_do), 'ok': True}

        if method == 'setup.status':
            if not self._configured():
                return {'provider_configured': False, 'configured': False}
            return {'provider_configured': True, 'configured': True}

        if method == 'setup.runtime_check':
            if not self._configured():
                return {'ok': False, 'error': 'No inference provider configured (mock boot pacing).'}
            return {'ok': True, 'runtime_ok': True}

        if method == 'config.set':
            key = params.get('key')
            value = params.get('value')

            def _do(state):
                config = state['config']
                if key == 'model' and isinstance(value, str) and ' --' in value:
                    model = value.split(' --')[0].strip()
                    if model:
                        config['model'] = {**config.get('model', {}), 'default': model}
                        if '--provider' in value:
                            config['model']['provider'] = value.split('--provider ')[1].split(' ')[0]
                elif key == 'reasoning':
                    config.setdefault('agent', {})['reasoning_effort'] = value
            self.store.mutate(_do)
            return {'ok': True, 'confirm_required': False}

        if method == 'profiles.create':
            name = str(params.get('name') or '').strip()
            if not name:
                return {'ok': False, 'error': 'missing profile name'}

            def _do(state):
                if name in state['profiles']:
                    raise RuntimeError(f'profile "{name}" already exists')
                state['profiles'][name] = {
                    'description': params.get('description') or '',
                    'ui_meta': {},
                    'soul': params.get('soul') or '',
                    'created': int(time.time() * 1000),
                }
                # The desktop main process asserts the profile DIRECTORY exists
                # (HERMES_HOME/profiles/<name>) before spawning its backend —
                # mirror the real profiles.create's on-disk side effect.
                home = os.environ.get('HERMES_HOME', os.path.expanduser('~/.hermes'))
                os.makedirs(os.path.join(home, 'profiles', name), exist_ok=True)
            self.store.mutate(_do)
            return {'ok': True, 'name': name}

        if method == 'profiles.configure':
            name = str(params.get('name') or '')
            ui_meta = params.get('ui_meta') or {}

            def _do(state):
                profile = state['profiles'].get(name)
                if not profile:
                    raise RuntimeError(f'profile "{name}" does not exist')
                # The gateway merges per key: ui_meta['hermes-bots'] deep-merges.
                existing = profile.get('ui_meta', {})
                if isinstance(ui_meta, dict):
                    for key, value in ui_meta.items():
                        if isinstance(value, dict) and isinstance(existing.get(key), dict):
                            existing[key] = {**existing[key], **value}
                        else:
                            existing[key] = value
                profile['ui_meta'] = existing
            self.store.mutate(_do)
            return {'ok': True}

        if method == 'profiles.list':
            def _do(state):
                # canonical_session is the bot roster's whole identity contract:
                # the profile's `Bot Chat` row, resolved server-side by title,
                # so preview and click target the same session by construction.
                # A roster without it half-works in ways the real one cannot.
                canonical = {}
                for s in state['sessions'].values():
                    if s['hidden'] and s['title'] == 'Bot Chat':
                        canonical[s['profile']] = _session_info(s)

                return [
                    {
                        'name': name,
                        'description': p.get('description', ''),
                        'ui_meta': p.get('ui_meta', {}),
                        'is_active': name == self.profile,
                        'canonical_session': canonical.get(name),
                        'backend': 'local',
                    }
                    for name, p in state['profiles'].items()
                ]
            return {'profiles': self.store.read(_do)}

        if method == 'profiles.describe':
            def _do(state):
                name = str(params.get('name') or '')
                p = state['profiles'].get(name)
                return {
                    'name': name,
                    'description': p.get('description', '') if p else '',
                    'ui_meta': p.get('ui_meta', {}) if p else {},
                    'soul': p.get('soul', '') if p else '',
                }
            return self.store.read(_do)

        if method == 'model.options':
            return {
                'model': 'deepseek/deepseek-v4-flash-0731',
                'provider': 'nous',
                'providers': [
                    {
                        'slug': 'nous',
                        'name': 'Nous',
                        'is_current': True,
                        'total_models': 2,
                        'authenticated': True,
                        'models': [
                            'deepseek/deepseek-v4-flash-0731',
                            'deepseek/deepseek-v4-pro-0813',
                        ],
                    }
                ],
            }

        if method == 'commands.catalog':
            return {'commands': []}

        if method == 'slash.exec':
            return {'ok': True, 'dispatch': None}

        if method == 'complete.path':
            return {'paths': []}

        if method == 'complete.slash':
            return {'items': []}

        if method == 'prompt.submit':
            text = str(params.get('text') or '')
            display_kind = params.get('display_kind')
            session = self.get_session(sid)
            if not session:
                return {'ok': False, 'error': 'session not found'}
            if display_kind == 'hidden':
                self.record(sid, 'user', text, display_kind='hidden')
            else:
                self.record(sid, 'user', text)
            reply = None
            if self.scenario:
                try:
                    reply = self.scenario.reply(sid, text, display_kind)
                except Exception as exc:  # scenario bugs must not wedge the flow
                    print('[mock] scenario error:', exc, file=sys.stderr)
                    reply = None
                if os.environ.get('MOCK_TRACE') == '1':
                    _trace = {
                        'sid': sid,
                        'profile': session.get('profile'),
                        'step': session.get('step'),
                        'hidden': display_kind == 'hidden',
                        'text': text[:80],
                        'reply': (reply or '')[:80],
                    }
                    with open(os.path.join(tempfile.gettempdir(), 'mock-scenario.log'), 'a', encoding='utf-8') as f:
                        f.write(json.dumps(_trace) + '\n')
            if reply:
                threading.Thread(target=self.play_turn, args=(sid, reply), daemon=True).start()
            return {'ok': True}

        if method == 'llm.oneshot':
            return {'ok': True, 'text': ''}

        if method == 'mcp.catalog':
            return {'servers': []}

        if method == 'process.list':
            return {'processes': []}

        if method == 'pet.gallery':
            return {'pets': []}

        if method == 'pet.select':
            return {'ok': True}

        if method == 'pet.rename':
            return {'ok': True}

        if method == 'image.generate':
            return {'ok': True, 'path': None}

        if method in (
            'approval.respond',
            'approval.pending',
            'approval.received',
            'clarify.respond',
            'sudo.respond',
            'secret.respond',
            'tour.respond',
            'wake.start',
            'wake.status',
            'wake.stop',
            'wake.pause',
            'wake.feed',
            'cron.manage',
            'skills.manage',
            'reload.env',
            'reload.mcp',
            'message.react',
            'profiles.get_asset',
            'profiles.set_asset',
            'process.kill',
            'cli.exec',
            'browser.manage',
        ):
            return {'ok': True}

        # Unknown methods: the renderer treats a missing feature as an error;
        # returning ok keeps callers quiet without lying about capability.
        return {'ok': True, 'mock_stub': True}


# ─────────────────────────────────────────────────────────────────────────────
# REST routes
# ─────────────────────────────────────────────────────────────────────────────


def _json_ok(**extra):
    body = {'ok': True}
    body.update(extra)
    return body


def _sessions_page(gateway, limit, offset=0, min_messages=0, include_hidden=False):
    def _do(state):
        rows = [
            s for s in state['sessions'].values()
            if (include_hidden or not s['hidden'])
            and _session_info(s)['message_count'] >= min_messages
        ]
        rows.sort(key=lambda s: s['last_active'], reverse=True)
        return rows
    rows = gateway.store.read(_do)
    total = len(rows)
    return {
        'sessions': [_session_info(s) for s in rows[offset:offset + limit]],
        'total': total,
        'limit': limit,
        'offset': offset,
        'has_more': offset + limit < total,
    }


def _messages_response(gateway, sid):
    session = gateway.get_session(sid)
    if not session:
        return 404, {'error': 'session not found'}
    messages = []
    for i, m in enumerate(session['messages']):
        messages.append({
            'id': 'msg-%d' % i,
            'session_id': sid,
            'role': m['role'],
            'content': m['content'],
            'display_kind': m.get('display_kind'),
            'created_at': m['created_at'],
        })
    return 200, {
        'session_id': sid,
        'messages': messages,
        'pagination': {'limit': len(messages), 'offset': 0},
    }


class Route:
    def __init__(self, method, pattern, handler):
        self.method = method
        self.pattern = re.compile(pattern)
        self.handler = handler

    def match(self, method, path):
        if self.method != method:
            return None
        return self.pattern.fullmatch(path)


def route(method, pattern):
    def decorator(fn):
        return Route(method, pattern, fn)

    return decorator


@route('GET', r'/api/status')
def _status(gateway, match, query, body):
    gateway.requests += 1
    return _json_ok(
        version='0.0.0-mock',
        auth_required=False,
        platform='mock',
        gateway='mock-gateway',
        requests=gateway.requests,
    )


@route('GET', r'/api/health')
def _health(gateway, match, query, body):
    return _json_ok()


@route('GET', r'/api/profiles/active')
def _profiles_active(gateway, match, query, body):
    return {'active': 'default', 'current': 'default'}


@route('GET', r'/api/fs/default-cwd')
def _fs_default_cwd(gateway, match, query, body):
    return {'branch': None, 'cwd': None}


@route('GET', r'/api/config')
def _config_get(gateway, match, query, body):
    def _do(state):
        return dict(state['config'])
    return {'config': gateway.store.read(_do), 'ok': True}


@route('PUT', r'/api/config')
def _config_put(gateway, match, query, body):
    if isinstance(body, dict):
        def _do(state):
            for key, value in body.items():
                if key in ('model', 'agent', 'web', 'tts', 'image_gen'):
                    state['config'][key] = value
        gateway.store.mutate(_do)
    return _json_ok()


@route('GET', r'/api/config/defaults')
def _config_defaults(gateway, match, query, body):
    return {'defaults': _default_state()['config']}


@route('GET', r'/api/config/schema')
def _config_schema(gateway, match, query, body):
    return {'schema': {}}


@route('GET', r'/api/config/raw')
def _config_raw(gateway, match, query, body):
    def _do(state):
        return json.dumps(state['config'], indent=2)
    return {'raw': gateway.store.read(_do)}


@route('GET', r'/api/model/info')
def _model_info(gateway, match, query, body):
    return {
        'model': 'deepseek/deepseek-v4-flash-0731',
        'provider': 'nous',
        'auto_context_length': 128000,
        'config_context_length': 128000,
        'effective_context_length': 128000,
    }


@route('GET', r'/api/model/options')
def _model_options(gateway, match, query, body):
    return gateway.handle_rpc('model.options', {})


@route('GET', r'/api/model/auxiliary')
def _model_aux(gateway, match, query, body):
    return {'model': None, 'provider': None}


@route('GET', r'/api/model/moa')
def _model_moa(gateway, match, query, body):
    return {'enabled': False}


@route('PUT', r'/api/model/set')
def _model_set(gateway, match, query, body):
    return _json_ok()


@route('GET', r'/api/sessions')
def _sessions_list(gateway, match, query, body):
    limit = min(200, int(query.get('limit', ['40'])[0]))
    offset = int(query.get('offset', ['0'])[0])
    min_messages = int(query.get('min_messages', ['0'])[0])
    return _sessions_page(gateway, limit, offset, min_messages)


@route('GET', r'/api/sessions/search')
def _sessions_search(gateway, match, query, body):
    return {'sessions': [], 'total': 0}


@route('GET', r'/api/sessions/([^/]+)')
def _session_get(gateway, match, query, body):
    session = gateway.get_session(match.group(1))
    if not session:
        return 404, {'error': 'session not found'}
    return _session_info(session)


@route('GET', r'/api/sessions/([^/]+)/messages')
def _session_messages(gateway, match, query, body):
    return _messages_response(gateway, match.group(1))


@route('PATCH', r'/api/sessions/([^/]+)')
def _session_patch(gateway, match, query, body):
    sid = match.group(1)
    session = gateway.get_session(sid)
    if not session:
        return 404, {'error': 'session not found'}
    if isinstance(body, dict) and isinstance(body.get('title'), str):
        def _do(state):
            state['sessions'][sid]['title'] = body['title']
        gateway.store.mutate(_do)
        return _json_ok(title=body['title'])
    return _json_ok()


@route('DELETE', r'/api/sessions/([^/]+)')
def _session_delete(gateway, match, query, body):
    sid = match.group(1)
    def _do(state):
        state['sessions'].pop(sid, None)
    gateway.store.mutate(_do)
    return _json_ok()


@route('GET', r'/api/profiles')
def _profiles(gateway, match, query, body):
    result = gateway.handle_rpc('profiles.list', {})
    rows = [
        {
            'name': p['name'],
            'description': p['description'],
            'ui_meta': p['ui_meta'],
            'is_active': p['is_active'],
            'backend': 'local',
            'sessions': 0,
            'home': os.path.join(os.path.dirname(STATE_PATH), 'profiles', p['name']),
        }
        for p in result['profiles']
    ]
    return {'profiles': rows}


@route('GET', r'/api/profiles/sessions/sidebar')
def _profiles_sidebar(gateway, match, query, body):
    limit = int(query.get('recents_limit', ['40'])[0])
    page = _sessions_page(gateway, limit, min_messages=1)
    return {
        'recents': {'sessions': page['sessions'], 'profiles_truncated': {}},
        'cron': {'sessions': []},
        'messaging': {'sessions': []},
    }


@route('GET', r'/api/profiles/sessions')
def _profiles_sessions(gateway, match, query, body):
    limit = min(200, int(query.get('limit', ['40'])[0]))
    offset = int(query.get('offset', ['0'])[0])
    return _sessions_page(gateway, limit, offset)


@route('POST', r'/api/profiles/sessions/pull-requests')
def _pull_requests(gateway, match, query, body):
    return {'pull_requests': {}, 'scanned': []}


@route('GET', r'/api/cron/jobs')
def _cron_jobs(gateway, match, query, body):
    return {'jobs': []}


@route('GET', r'/api/cron/blueprints')
def _cron_blueprints(gateway, match, query, body):
    return {'blueprints': []}


@route('GET', r'/api/cron/delivery-targets')
def _cron_targets(gateway, match, query, body):
    return {'targets': []}


@route('GET', r'/api/skills')
def _skills(gateway, match, query, body):
    return {'skills': []}


@route('GET', r'/api/tools/toolsets')
def _toolsets(gateway, match, query, body):
    return {'toolsets': []}


@route('GET', r'/api/env')
def _env(gateway, match, query, body):
    return {'env': {}}


@route('GET', r'/api/mcp/servers')
def _mcp_servers(gateway, match, query, body):
    return {'servers': []}


@route('GET', r'/api/mcp/catalog')
def _mcp_catalog(gateway, match, query, body):
    return {'catalog': []}


@route('GET', r'/api/messaging/platforms')
def _platforms(gateway, match, query, body):
    return {'platforms': []}


@route('GET', r'/api/memory')
def _memory(gateway, match, query, body):
    return {'status': 'ok', 'memory': '', 'user': ''}


@route('GET', r'/api/curator')
def _curator(gateway, match, query, body):
    return {'status': 'idle', 'paused': False}


@route('GET', r'/api/analytics/usage')
def _analytics(gateway, match, query, body):
    return {'series': []}


@route('GET', r'/api/pairing')
def _pairing(gateway, match, query, body):
    return {'pairing': None}


@route('GET', r'/api/webhooks')
def _webhooks(gateway, match, query, body):
    return {'webhooks': []}


@route('GET', r'/api/git/gh-auth')
def _gh_auth(gateway, match, query, body):
    return {'available': False, 'authenticated': False}


@route('GET', r'/api/hermes/update/check')
def _update_check(gateway, match, query, body):
    return {'behind': 0, 'current': 'mock'}


@route('GET', r'/api/actions/([^/]+)/status')
def _action_status(gateway, match, query, body):
    return {'status': 'done', 'lines': ''}


@route('POST', r'/api/env/reveal')
def _env_reveal(gateway, match, query, body):
    return _json_ok()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP server
# ─────────────────────────────────────────────────────────────────────────────

ROUTES = [
    route_obj for name, route_obj in list(globals().items())
    if isinstance(route_obj, Route)
]


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # quiet

    def _send_json(self, status, payload):
        data = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def _route(self, method, path, body):
        parsed = urlparse(path)
        for r in ROUTES:
            match = r.match(method, parsed.path)
            if not match:
                continue
            result = r.handler(self.server.gateway, match, parse_qs(parsed.query), body)
            if isinstance(result, tuple):
                return result
            return 200, result
        print(f'[mock] 404 {method} {parsed.path}', flush=True)
        return 404, {'error': 'not found', 'detail': 'mock gateway: no such endpoint'}

    def do_GET(self):
        if self.path.startswith('/api/ws'):
            self._upgrade()
            return
        parsed_path = urlparse(self.path).path
        if parsed_path == '/':
            # The desktop main process fetches the dashboard index page to
            # adopt the token the backend actually serves. Serve the same
            # injected-token shape the real dashboard does.
            token = os.environ.get('HERMES_DASHBOARD_SESSION_TOKEN', 'mock-dashboard-token')
            html = (
                '<!doctype html><html><head><title>Hermes (mock)</title></head><body>'
                f'<script>window.__HERMES_SESSION_TOKEN__ = "{token}";</script>'
                '<p>Hermes mock backend</p></body></html>'
            ).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        status, payload = self._route('GET', self.path, None)
        self._send_json(status, payload)

    def do_POST(self):
        status, payload = self._route('POST', self.path, self._read_body())
        self._send_json(status, payload)

    def do_PUT(self):
        status, payload = self._route('PUT', self.path, self._read_body())
        self._send_json(status, payload)

    def do_PATCH(self):
        status, payload = self._route('PATCH', self.path, self._read_body())
        self._send_json(status, payload)

    def do_DELETE(self):
        status, payload = self._route('DELETE', self.path, self._read_body())
        self._send_json(status, payload)

    def _read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return {}

    # ── WebSocket ──
    def _upgrade(self):
        key = self.headers.get('Sec-WebSocket-Key')
        if not key:
            self._send_json(400, {'error': 'missing websocket key'})
            return
        self.send_response(101, 'Switching Protocols')
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', ws_accept(key))
        self.end_headers()

        conn = self.connection
        send_lock = threading.Lock()
        gateway = self.server.gateway
        gateway.conns.append((conn, send_lock))
        try:
            while True:
                opcode, payload = read_ws_frame(conn)
                if opcode == 8:      # close
                    break
                if opcode == 9:      # ping → pong
                    send_ws_frame(conn, payload, opcode=10)
                    continue
                if opcode != 1:      # ignore binary / continuation fragments
                    continue
                try:
                    frame = json.loads(payload.decode('utf-8'))
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(frame, dict):
                    continue
                req_id = frame.get('id')
                method = frame.get('method')

                if req_id is not None and method == 'ping':
                    with send_lock:
                        send_ws_frame(conn, json.dumps({
                            'jsonrpc': '2.0', 'id': req_id, 'result': {'ok': True},
                        }))
                    continue

                if method == 'event':
                    continue

                if req_id is not None and isinstance(method, str):
                    try:
                        result = gateway.handle_rpc(method, frame.get('params') or {})
                        with send_lock:
                            send_ws_frame(conn, json.dumps({
                                'jsonrpc': '2.0', 'id': req_id, 'result': result,
                            }))
                    except Exception as exc:  # keep the connection alive
                        with send_lock:
                            send_ws_frame(conn, json.dumps({
                                'jsonrpc': '2.0',
                                'id': req_id,
                                'error': {'code': -32603, 'message': str(exc)},
                            }))
        except (ConnectionError, OSError):
            pass
        finally:
            for entry in list(gateway.conns):
                if entry[0] is conn:
                    gateway.conns.remove(entry)


# ─────────────────────────────────────────────────────────────────────────────
# Entry points
# ─────────────────────────────────────────────────────────────────────────────


def build_server(host=None, port=None, profile='default'):
    """Gateway + scenario + bound HTTP/WS server. Returns (server, gateway).
    The server binds in the constructor, so the caller learns the real port
    from server.server_address[1] right after this returns."""
    host = host if host is not None else HOST
    port = int(port) if port is not None else PORT

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        import scenario  # noqa: F401  (side effect: registers itself)
    except ImportError:
        print('[mock] no scenario.py found — prompt.submit returns nothing',
              file=sys.stderr)

    gateway = Gateway(profile=profile)
    if 'scenario' in sys.modules:
        setup = getattr(sys.modules['scenario'], 'setup', None)
        if setup:
            setup(gateway)

    server = ThreadingHTTPServer((host, port), Handler)
    server.gateway = gateway
    return server, gateway


def main():
    if '--version' in sys.argv or '-V' in sys.argv:
        print('mock-hermes 0.0.1')
        sys.exit(0)

    host = HOST
    port = PORT
    profile = 'default'
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == '--host' and i + 1 < len(argv):
            host = argv[i + 1]
        if arg == '--port' and i + 1 < len(argv):
            port = int(argv[i + 1])
        if arg == '--profile' and i + 1 < len(argv):
            profile = argv[i + 1]

    server, gateway = build_server(host, port, profile=profile)
    print('[mock] mock gateway on http://%s:%d  (profile %s, token: anything, state: %s)' % (
        host, server.server_address[1], profile, STATE_PATH))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
