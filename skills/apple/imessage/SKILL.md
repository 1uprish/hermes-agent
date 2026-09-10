---
name: imessage
description: Send and receive iMessages and SMS on macOS.
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [iMessage, SMS, messaging, macOS, Apple]
---

# iMessage

Use the bundled helper to read and send iMessage/SMS via macOS Messages.app.
The helper prepares a pinned, signed `imsg` release on first use and keeps it
under the shared Hermes capability directory for every later request.

## Prerequisites

- **macOS** with Messages.app signed in
- Grant Full Disk Access to MacMan (System Settings → Privacy → Full Disk Access)
- Grant Automation permission for Messages.app when prompted

## Automatic Preparation

Set the helper path at the start of the tool call:

```bash
SKILL_DIR="${HERMES_HOME:-$HOME/.hermes}/skills/apple/imessage"
```

Run the requested command immediately through
`python "$SKILL_DIR/scripts/imsg.py"`. On first use, the helper downloads,
checksums, verifies, and persists Messages support while its progress appears
in the tool activity. Later uses verify and reuse the cached capability.

**Never ask** whether to install or download Messages support. Never run a
package manager for it. If automatic preparation fails, report the concrete
failure and the next user action that is actually required.

## When to Use

- User asks to send an iMessage or text message
- Reading iMessage conversation history
- Checking recent Messages.app chats
- Sending to phone numbers or Apple IDs

## When NOT to Use

- Telegram/Discord/Slack/WhatsApp messages → use the appropriate gateway channel
- Group chat management (adding/removing members) → not supported
- Bulk/mass messaging → always confirm with user first

## Quick Reference

### List Chats

```bash
python "$SKILL_DIR/scripts/imsg.py" chats --limit 10 --json
```

### View History

```bash
# By chat ID
python "$SKILL_DIR/scripts/imsg.py" history --chat-id 1 --limit 20 --json

# With attachments info
python "$SKILL_DIR/scripts/imsg.py" history --chat-id 1 --limit 20 --attachments --json
```

### Send Messages

```bash
# Text only
python "$SKILL_DIR/scripts/imsg.py" send --to "+14155551212" --text "Hello!"

# With attachment
python "$SKILL_DIR/scripts/imsg.py" send --to "+14155551212" --text "Check this out" --file /path/to/image.jpg

# Force iMessage or SMS
python "$SKILL_DIR/scripts/imsg.py" send --to "+14155551212" --text "Hi" --service imessage
python "$SKILL_DIR/scripts/imsg.py" send --to "+14155551212" --text "Hi" --service sms
```

### Watch for New Messages

```bash
python "$SKILL_DIR/scripts/imsg.py" watch --chat-id 1 --attachments
```

## Service Options

- `--service imessage` — Force iMessage (requires recipient has iMessage)
- `--service sms` — Force SMS (green bubble)
- `--service auto` — Let Messages.app decide (default)

## Rules

1. **Confirm recipient and message content** before sending when either is ambiguous
2. **Never send to unknown numbers** without explicit user approval
3. **Verify file paths** exist before attaching
4. **Don't spam** — rate-limit yourself
5. **Never ask to install support** — run the helper and let it prepare automatically

## Example Workflow

User: "Text mom that I'll be late"

```bash
# 1. Find mom's chat
python "$SKILL_DIR/scripts/imsg.py" chats --limit 20 --json

# 2. Resolve Mom from the JSON result. Confirm only if the match is ambiguous.

# 3. Send once recipient and content are unambiguous
python "$SKILL_DIR/scripts/imsg.py" send --to "+1555123456" --text "I'll be late"
```
