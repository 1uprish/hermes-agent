"""Behavior tests for the connected-messaging edge adapter."""

import importlib.util
from pathlib import Path

import pytest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2]
    / "skills/communication/connected-messaging/scripts/connected_messaging.py"
)


@pytest.fixture
def adapter():
    spec = importlib.util.spec_from_file_location("connected_messaging_test", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_gmail_commands_use_the_bundled_authenticated_home(adapter):
    command = adapter.build_provider_command(
        "gmail",
        ["search", "from:annie newer_than:7d", "--max", "5"],
        env={"GOG_HOME": "/private/macman/gmail"},
        resolve=lambda name: f"/bundle/{name}",
    )

    assert command == [
        "/bundle/gog",
        "--json",
        "--no-input",
        "--wrap-untrusted",
        "gmail",
        "search",
        "from:annie newer_than:7d",
        "--max",
        "5",
    ]


def test_imessage_commands_are_scoped_to_macman_state(adapter):
    command = adapter.build_provider_command(
        "imessage",
        ["send", "+15551234567", "Running ten minutes late"],
        env={"MACMAN_IMESSAGE_DATA_DIR": "/private/macman/imessage"},
        resolve=lambda name: f"/bundle/{name}",
    )

    assert command == [
        "/bundle/imessage-cli",
        "--data-dir",
        "/private/macman/imessage",
        "--json",
        "--no-events",
        "send",
        "+15551234567",
        "Running ten minutes late",
    ]


def test_whatsapp_send_reuses_the_configured_gateway_without_double_prefixing(adapter):
    direct = adapter.build_whatsapp_send_command(
        "15551234567", "Passport scan received", resolve=lambda name: f"/bundle/{name}"
    )
    prefixed = adapter.build_whatsapp_send_command(
        "whatsapp:15551234567", "Passport scan received", resolve=lambda name: f"/bundle/{name}"
    )

    assert direct == [
        "/bundle/hermes",
        "send",
        "--to",
        "whatsapp:15551234567",
        "Passport scan received",
        "--json",
    ]
    assert prefixed == direct


def test_adapter_fails_loud_when_a_release_connector_is_missing(adapter):
    with pytest.raises(RuntimeError, match="gog.*not available"):
        adapter.build_provider_command("gmail", ["search", "is:unread"], env={}, resolve=lambda _name: None)
