#!/usr/bin/env python3
"""
mock-hermes — a drop-in for the Python interpreter the desktop app spawns
as its local backend. Set HERMES_DESKTOP_PYTHON to this file and the app's
`<python> -m hermes_cli.main --profile X serve --host H --port P` spawn
becomes this process: it ignores the `-m hermes_cli.main` argv, runs the
mock gateway on the requested port, and speaks the two bits of the backend
spawn contract the desktop main process depends on:

  1. Prints `HERMES_BACKEND_READY port=<N>` on stdout once bound
     (backend-ready.ts watches for exactly this line).
  2. Serves `/` with the injected `window.__HERMES_SESSION_TOKEN__` shape
     so the served-token adoption in dashboard-token.ts resolves cleanly.

Stdlib only. Everything the renderer sends (REST + WS JSON-RPC) is answered
by the scenario in scenario.py, deterministically, with no model calls.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mock_gateway as mg  # noqa: E402


def _argval(args, name, default):
    try:
        return args[args.index(name) + 1]
    except (ValueError, IndexError):
        return default


def main():
    args = sys.argv[1:]

    if '--version' in args or '-V' in args:
        print('mock-hermes 0.0.1')
        sys.exit(0)

    # argv arrives as: -m hermes_cli.main --profile <p> serve --host <h> --port <p>
    host = _argval(args, '--host', '127.0.0.1')
    profile = _argval(args, '--profile', 'default')
    try:
        port = int(_argval(args, '--port', '0'))
    except (TypeError, ValueError):
        port = 0

    server, _gateway = mg.build_server(host, port, profile=profile)
    actual_port = server.server_address[1]

    # The announce line must start at column 0 on its own line — that is the
    # exact contract backend-ready.ts parses.
    sys.stdout.write(f'HERMES_BACKEND_READY port={actual_port}\n')
    sys.stdout.write(f'  Hermes mock backend listening on {host}:{actual_port} (profile {profile})\n')
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
