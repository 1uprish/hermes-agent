#!/usr/bin/env bash
# Restore the original Hermes Desktop bundle backed up by apply.sh.
set -euo pipefail

APP="${HERMES_APP:-$HOME/.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app}"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -f "$RES/app.asar.orig-backup" ] || fail "no backup found — nothing to revert (or already reverted)"

if pgrep -f "$APP/Contents/MacOS/Hermes" >/dev/null 2>&1; then
  fail "Hermes is running. Quit it first (⌘Q), then re-run ./revert.sh"
fi

mv "$RES/app.asar.orig-backup" "$RES/app.asar"
rm -rf "$RES/app.asar.unpacked"
mv "$RES/app.asar.unpacked.orig-backup" "$RES/app.asar.unpacked"

HASH=$(node "$KIT_DIR/asar-header-hash.js" "$RES/app.asar")
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $HASH" "$PLIST" \
  || fail "could not update ElectronAsarIntegrity in Info.plist"

codesign --force --deep --sign - "$APP" 2>/dev/null || fail "re-sign failed"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --verify --deep "$APP" || fail "signature verify failed after re-sign"

echo "Original bundle restored. Launch Hermes normally."
