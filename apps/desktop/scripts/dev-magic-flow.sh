#!/bin/bash
# Relaunch the onboarding dev chain on a CLEAN scratch profile with portal
# auth PRE-SEEDED from the real ~/.hermes — the chain then skips sign-in
# entirely (login mode is windowless since 1c3ed79689) and the guided chat
# has working inference from turn one. UI state (localStorage) still resets,
# so the intro plays like a true first run.
set -euo pipefail

PROFILE=/tmp/hermes-magic-flow
WORKTREE=~/Documents/Work/nous/hermes-agent-src/.worktrees/chat-onboarding-anim

# 1. Down the old instance (parent Electron only — helpers follow).
PARENT=$(ps -eo pid,ppid,command | grep "Electron\.app/Contents/MacOS/Electron" | grep -v Helper | grep -v grep | awk '{print $1}' | head -1 || true)
[ -n "${PARENT:-}" ] && kill "$PARENT" 2>/dev/null || true
sleep 3

# 2. Fresh profile, seeded auth.
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
cp ~/.hermes/auth.json "$PROFILE/auth.json"
cat > "$PROFILE/config.yaml" <<'EOF'
model:
  provider: nous
  default: deepseek/deepseek-v4-flash-0731
agent:
  reasoning_effort: minimal
web:
  backend: nous
tts:
  provider: nous
image_gen:
  provider: nous
EOF

# 3. Vite: start it if 5176 isn't already serving (it dies with the terminal
# session that started it; the chain must not depend on that).
if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:5176; then
  cd "$WORKTREE/apps/desktop"
  nohup env VITE_INTRO_REVEAL=1 npx vite --host 127.0.0.1 --port 5176 \
    > /tmp/magic-flow-vite.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s -o /dev/null --max-time 1 http://127.0.0.1:5176 && break
    sleep 1
  done
fi

# 4. Launch.
cd "$WORKTREE/apps/desktop"
exec env HERMES_HOME="$PROFILE" HERMES_DESKTOP_USER_DATA_DIR="$PROFILE" \
  HERMES_DESKTOP_CDP_PORT=9224 HERMES_DESKTOP_DEV_SERVER=http://127.0.0.1:5176 \
  VITE_INTRO_REVEAL=1 npx electron . \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding
