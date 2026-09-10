#!/usr/bin/env python3
"""Stable command boundary for MacMan's local messaging connectors."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Mapping, Sequence


Resolver = Callable[[str], str | None]


def _required_binary(name: str, resolve: Resolver) -> str:
    binary = resolve(name)
    if not binary:
        raise RuntimeError(f"{name} is not available in this MacMan release")
    return binary


def build_provider_command(
    provider: str,
    arguments: Sequence[str],
    *,
    env: Mapping[str, str] = os.environ,
    resolve: Resolver = shutil.which,
) -> list[str]:
    if provider == "gmail":
        return [
            _required_binary("gog", resolve),
            "--json",
            "--no-input",
            "--wrap-untrusted",
            "gmail",
            *arguments,
        ]

    if provider == "imessage":
        hermes_home = env.get("HERMES_HOME") or str(Path.home() / ".hermes")
        data_dir = env.get("MACMAN_IMESSAGE_DATA_DIR") or str(Path(hermes_home) / "connections" / "imessage")
        return [
            _required_binary("imessage-cli", resolve),
            "--data-dir",
            data_dir,
            "--json",
            "--no-events",
            *arguments,
        ]

    raise ValueError(f"Unsupported connected messaging provider: {provider}")


def _whatsapp_target(target: str) -> str:
    normalized = target.strip()
    if not normalized:
        raise ValueError("WhatsApp target must not be empty")
    return normalized if normalized.lower().startswith("whatsapp:") else f"whatsapp:{normalized}"


def build_whatsapp_send_command(target: str, message: str, *, resolve: Resolver = shutil.which) -> list[str]:
    if not message.strip():
        raise ValueError("WhatsApp message must not be empty")
    return [
        _required_binary("hermes", resolve),
        "send",
        "--to",
        _whatsapp_target(target),
        message,
        "--json",
    ]


def build_whatsapp_list_command(*, resolve: Resolver = shutil.which) -> list[str]:
    return [_required_binary("hermes", resolve), "send", "--list", "whatsapp", "--json"]


def _command_from_cli(provider: str, arguments: list[str]) -> list[str]:
    if provider in {"gmail", "imessage"}:
        if not arguments:
            raise ValueError(f"{provider} requires a connector command")
        return build_provider_command(provider, arguments)

    if arguments == ["list"]:
        return build_whatsapp_list_command()
    if len(arguments) >= 3 and arguments[0] == "send":
        return build_whatsapp_send_command(arguments[1], " ".join(arguments[2:]))
    raise ValueError("WhatsApp usage: whatsapp list | whatsapp send TARGET MESSAGE")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Use MacMan's connected messaging accounts")
    parser.add_argument("provider", choices=("gmail", "imessage", "whatsapp"))
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    parsed = parser.parse_args(argv)

    try:
        command = _command_from_cli(parsed.provider, parsed.arguments)
    except (RuntimeError, ValueError) as error:
        print(f"connected-messaging: {error}", file=sys.stderr)
        return 2

    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
