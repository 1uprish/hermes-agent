---
name: hgui
description: Set up hgui and launch Hermes desktop from worktrees.
version: 1.0.0
author: Brooklyn (@OutThisLife, original hgui), Austin Pickett (@austinpickett, skill author), Hermes Agent
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [hermes, desktop, electron, worktree, onboarding]
    category: software-development
    related_skills: []
---

# hgui Skill

Worktree-aware launchers for Hermes development: `hgui` (Electron desktop
app), `hermes`/`htui` (CLI/TUI), plus a bootstrap script for fresh-state
runs — including "new user but keep my Nous Portal login". macOS + zsh.
`hgui` itself was written by Brooklyn (@OutThisLife); this skill packages
her launcher and the fresh-state bootstrap for team setup.

## When to Use

- Setting up the team launcher functions on a new machine.
- Running the desktop app from any PR checkout/worktree without touching
  the installed Hermes.app.
- Testing onboarding flows as a fresh user — with or without real auth.

## Prerequisites

- macOS, zsh, `lsof` (stock). Node on PATH with npm `<11.10.0 || >=11.17.0`
  (repo `.npmrc` is engine-strict; 11.10–11.16 banned).
- A main Hermes checkout with a working venv:
  `$HERMES_MAIN_CHECKOUT/.venv/bin/python -c "import yaml, hermes_cli"`.
- `npm ci` run in the main checkout. Worktrees of a *different* repo than
  the main checkout (e.g. hermes-magic worktrees when main is hermes-agent)
  each need their own `npm ci --no-fund` — the node_modules linker only
  links from the same-repo deps checkout (`HERMES_GUI_DEPS_CHECKOUT`).

## How to Run

### One-time setup

1. Copy `templates/hgui.zsh` (in this skill dir) somewhere stable, e.g.
   `~/.config/zsh/hgui.zsh`.
2. Add to `~/.zshrc`:

   ```zsh
   export HERMES_MAIN_CHECKOUT="$HOME/projects/nous/hermes-agent"  # your path
   source ~/.config/zsh/hgui.zsh
   ```

3. New shell, then verify: `type hgui hermes htui` prints function defs.

### Daily use

| Command | What it does |
|---|---|
| `hgui` | Desktop app from the checkout you're inside |
| `hgui <worktree>` | Desktop app from that checkout |
| `hermes …` | CLI from current worktree (main checkout's venv) |
| `htui` | TUI in dev mode from current worktree |
| `scripts/fresh-run.zsh <wt>` | Desktop as a blank new user (no auth) |
| `scripts/fresh-run.zsh --keep-auth <wt>` | Fresh state, real Nous Portal auth |

Plain `hgui` shares your real `~/.hermes` (sessions, providers, auth) but
uses isolated Electron userData (`~/Library/Application Support/Hermes-dev`)
so it can run beside the installed app.

## Fresh-state modes (fresh-run.zsh)

`scripts/fresh-run.zsh [--keep-auth] [--reset] <worktree>`

1. **Blank user** (default): mktemp `HERMES_HOME` + mktemp userData. No
   providers, no sessions, no intro-seen keys. Guided-chat onboarding will
   ask for an API key mid-flow — intended. Hits the Nous Portal login wall.
2. **`--keep-auth`**: `HERMES_HOME=$HOME/.hermes/profiles/fresh-<wt-name>`.
   Sessions/config/skills start empty, but per-provider auth (nous, copilot
   pool, …) is inherited read-only from the global `~/.hermes/auth.json` —
   `_load_provider_state` (hermes_cli/auth.py, issue #18594) falls back
   per-provider ONLY in profile mode. A `/tmp` home gets NO fallback
   (classified as a Docker-style root), which is why mode 1 is logged out.
   Reuse the profile to continue; `--reset` wipes it first.
3. **Continue a prior fresh user**: rerun with the same profile (mode 2
   without `--reset`), or reuse a mode-1 tmp dir manually.

Onboarding stage vars pass through the environment (only wired on
onboarding branches — check `apps/desktop/package.json` for `dev:*` stages):

```zsh
VITE_INTRO_REVEAL=1 VITE_ONBOARDING_STAGE=full scripts/fresh-run.zsh --keep-auth <wt>
```

**Never `cp ~/.hermes/auth.json` into a scratch home.** Nous refresh tokens
are single-use and rotate on every refresh; a forked copy means one store
replays a consumed token and your real install gets logged out. The profile
fallback is the designed path — token rotations write back to the source
store (`_provider_state_transaction`).

## Pitfalls

- **Silent instant exit / bogus `dev:renderer SIGTERM`**: userData collision
  with the installed app → Electron single-instance lock. `hgui` prevents
  this; bare `npm run dev` does not.
- **Port 5174 is fixed** (vite dev server). `hgui` kills a stale holder —
  which includes another teammate-visible dev session you meant to keep.
  One hgui session per machine.
- **Boot screen stuck at "bundling dependencies…"**: vite first-run
  dep-optimizer stall. Reload renderer (Cmd+R); cache is warm after.
- **Backend dies `ModuleNotFoundError: No module named 'yaml'`**: wrong
  python rung. hgui sets `HERMES_DESKTOP_PYTHON` to the main checkout's
  venv; bare `npm run dev:*` gets no override and needs `<root>/.venv`.
- **npm engine rejection**: upgrade scoped to the nvm tree only —
  `npm install -g npm@11.17.0 --prefix ~/.nvm/versions/node/vX` (bare `-g`
  can EEXIST on hermes-managed symlinks in `~/.local`).
- **`VITE_ONBOARDING_STAGE` does nothing**: the branch has no stage gate;
  vars are inert on non-onboarding branches.
- **Setup-bot branches: rerun skips the question flow.** Flows that mint
  persistent profiles (e.g. `hermes-setup`) write them to
  `~/.hermes/profiles/` — HOME-anchored, deliberately OUTSIDE `HERMES_HOME`
  — and adopt-before-mint resumes the existing Bot Chat wherever it left
  off. Wiping your fresh dirs is not enough: also
  `rm -rf ~/.hermes/profiles/hermes-setup` (and any task-bot profiles the
  run minted), or use the branch's `npm run dev:fresh` (dev-fresh.mjs
  overrides HOME so the profiles root is sandboxed too; pass
  `HERMES_DESKTOP_PYTHON=$HERMES_MAIN_CHECKOUT/.venv/bin/python` when
  running it bare).
- **Windows**: template is zsh-only. A PowerShell port exists on some team
  machines but is not shipped here.

## Verification

- Cheap pre-flight: `node apps/desktop/scripts/assert-root-install.mjs`
  run from `apps/desktop` (the same gate `npm run dev` runs).
- Boot failures: `$HERMES_HOME/logs/desktop.log`.
- Prove `--keep-auth` sees your login (run from the worktree):

  ```zsh
  env -u PYTHONPATH HERMES_HOME=$HOME/.hermes/profiles/<name> \
    "$HERMES_MAIN_CHECKOUT/.venv/bin/python" -c \
    "from hermes_cli.auth import get_nous_auth_status_local as s; print(s().get('logged_in'))"
  ```

  `True` = the profile fallback found your global Nous session.

## Sharing

This skill ships bundled in the repo. Outside a checkout, drop the whole
directory into `~/.hermes/skills/software-development/hgui/`, or take just
`templates/hgui.zsh` for teammates who don't run Hermes skills. The
template is self-contained; only `HERMES_MAIN_CHECKOUT` is machine-specific.
