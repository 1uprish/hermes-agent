# Hermes intro reveal — in-app preview kit

Run the new first-run intro sequence inside YOUR installed Hermes Desktop —
your sessions, config, and backend untouched. The kit swaps only the app's
UI bundle for one built from the `hermes-intro-reveal` branch, and restores
the original with one command.

## Install

1. Download `intro-preview-kit.tar.gz` from this repo's Releases (repo access
   required) and extract it.
2. Quit Hermes (⌘Q).
3. In the extracted folder:

```bash
./apply.sh --check   # verifies your install is patchable (read-only)
./apply.sh           # swaps the bundle, fixes integrity, re-signs
```

4. Launch Hermes → Settings → About → **Replay intro**.

The sequence takes over the screen for ~18 seconds (frosted glass over your
desktop, the product story, the brand close) and returns on its own. Esc or
click skips instantly.

## Revert

```bash
./revert.sh
```

Restores your exact original bundle from the backup made on first apply.
A regular Hermes desktop update also replaces the patched bundle with stock.

## Notes

- macOS arm64 only (the payload is built for Apple Silicon).
- If your Hermes.app lives somewhere non-standard:
  `HERMES_APP=/path/to/Hermes.app ./apply.sh`
- The patch is UI-only. Nothing touches `~/.hermes` state, and the app's
  backend/agent runtime is exactly what you already had.
- If the app version you're on drifts far from this branch, prefer cloning
  the repo and running the dev build in the module README instead.
