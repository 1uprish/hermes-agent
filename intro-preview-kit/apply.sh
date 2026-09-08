#!/usr/bin/env bash
# Hermes Desktop — intro reveal preview patch
#
# Swaps your installed Hermes Desktop's app bundle (app.asar + app.asar.unpacked)
# for one built from the intro-reveal feature branch, so the first-run intro
# sequence runs INSIDE your real app (Settings → About → "Replay intro").
#
# Safe + reversible:
#   - your original bundle is backed up next to itself on first run
#   - ./revert.sh restores it exactly
#   - a normal `hermes update` / desktop reinstall also restores stock
#
# Usage:
#   ./apply.sh --check    # read-only: verify your install is patchable
#   ./apply.sh            # patch + re-sign + relaunch prompt
set -euo pipefail

APP="${HERMES_APP:-$HOME/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app}"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"
CHECK_ONLY="${1:-}"

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null || fail "node is required (any recent version)"
command -v codesign >/dev/null || fail "codesign is required (xcode-select --install)"
[ -d "$APP" ] || fail "Hermes.app not found at: $APP
Set HERMES_APP=/path/to/Hermes.app if your install lives elsewhere."
[ -f "$RES/app.asar" ] || fail "no app.asar inside $APP — not a packaged install?"
[ -f "$KIT_DIR/payload/app.asar" ] || fail "payload/app.asar missing — incomplete kit download"
[ -d "$KIT_DIR/payload/app.asar.unpacked" ] || fail "payload/app.asar.unpacked missing — incomplete kit download"

# Doctor: confirm the payload actually contains the intro feature. The main
# bundle ships in app.asar.unpacked (native-dep staging), so check there.
grep -qa "hermes:intro-reveal:open" "$KIT_DIR/payload/app.asar.unpacked/dist/electron-main.mjs" \
  || fail "payload lacks the intro IPC — wrong or corrupt payload"
echo "payload OK: intro-reveal IPC present"

if [ "$CHECK_ONLY" = "--check" ]; then
  echo "check OK: install at $APP is patchable."
  exit 0
fi

# Refuse to patch a RUNNING app — the swap would race the process.
if pgrep -f "$APP/Contents/MacOS/Hermes" >/dev/null 2>&1; then
  fail "Hermes is running. Quit it first (⌘Q), then re-run ./apply.sh"
fi

# One-time backup of the ORIGINAL bundle (never overwritten by re-applies).
if [ ! -f "$RES/app.asar.orig-backup" ]; then
  cp "$RES/app.asar" "$RES/app.asar.orig-backup"
  rm -rf "$RES/app.asar.unpacked.orig-backup"
  cp -R "$RES/app.asar.unpacked" "$RES/app.asar.unpacked.orig-backup"
  echo "backed up original bundle"
fi

cp "$KIT_DIR/payload/app.asar" "$RES/app.asar"
rm -rf "$RES/app.asar.unpacked"
cp -R "$KIT_DIR/payload/app.asar.unpacked" "$RES/app.asar.unpacked"
echo "bundle swapped"

# Regenerate ElectronAsarIntegrity (the app refuses a mismatched archive).
HASH=$(node "$KIT_DIR/asar-header-hash.js" "$RES/app.asar")
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $HASH" "$PLIST" \
  || fail "could not update ElectronAsarIntegrity in Info.plist"
echo "integrity hash updated"

codesign --force --deep --sign - "$APP" 2>/dev/null || fail "re-sign failed"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --verify --deep "$APP" || fail "signature verify failed after re-sign"
echo "re-signed (ad-hoc) and verified"

echo ""
echo "Done. Launch Hermes, then: Settings → About → 'Replay intro'."
echo "(On a fresh unconfigured install it plays automatically before setup.)"
echo "Revert any time with ./revert.sh"
