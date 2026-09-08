# hgui.zsh — Hermes worktree-aware launchers (zsh, macOS)
#
# hgui originally written by Brooklyn (@OutThisLife); packaged as a team
# skill by Austin Pickett (@austinpickett). One deliberate change from the
# original: the port-5174 cleanup falls back to lsof+kill when the
# `killport` utility isn't installed (_hermes_free_port).
#
# Setup (~/.zshrc):
#   export HERMES_MAIN_CHECKOUT="$HOME/projects/nous/hermes-agent"   # your path
#   source /path/to/hgui.zsh
#
# Optional env:
#   HERMES_GUI_DEPS_CHECKOUT  checkout providing apps/desktop node_modules
#                             (defaults to HERMES_MAIN_CHECKOUT; worktrees of a
#                             DIFFERENT repo need their own `npm ci`)
#   HERMES_GUI_USER_DATA_DIR  Electron userData override (fresh-run.zsh uses this)
#   HERMES_HOME               backend state override (defaults to ~/.hermes)

if [[ -z "${HERMES_MAIN_CHECKOUT:-}" ]]; then
  echo "hgui.zsh: export HERMES_MAIN_CHECKOUT=<path to main hermes checkout> before sourcing" >&2
  return 1
fi

_hermes_root() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ -f "$root/hermes_cli/main.py" && -d "$root/ui-tui" ]] || return 1
  print -r "$root"
}

# Run the Hermes CLI from whatever checkout you're inside, on the main
# checkout's venv. Outside a checkout, falls through to the installed hermes.
hermes() {
  local root arg use_tui_dir
  use_tui_dir=1
  root="$(_hermes_root)" || {
    command hermes "$@"
    return
  }

  for arg in "$@"; do
    case "$arg" in
      --dev|--dev=*)
        use_tui_dir=0
        break
        ;;
    esac
  done

  if [[ ! -e "$root/ui-tui/node_modules" && -d "$HERMES_MAIN_CHECKOUT/ui-tui/node_modules" ]]; then
    ln -s "$HERMES_MAIN_CHECKOUT/ui-tui/node_modules" "$root/ui-tui/node_modules"
  fi

  if (( use_tui_dir )); then
    PYTHONPATH="$root" \
    HERMES_TUI_DIR="$root/ui-tui" \
    "$HERMES_MAIN_CHECKOUT/.venv/bin/python" -m hermes_cli.main "$@"
  else
    # Force-disable prebuilt override for --dev flow.
    env -u HERMES_TUI_DIR \
      PYTHONPATH="$root" \
      "$HERMES_MAIN_CHECKOUT/.venv/bin/python" -m hermes_cli.main "$@"
  fi
}

htui() {
  hermes --tui --dev "$@"
}

_hermes_npm_root_ok() {
  local root="$1"
  [[ -f "${root%/}/node_modules/vite/package.json" ]]
}

# Symlink node_modules from deps checkout when missing or a broken partial install.
_hermes_link_node_modules() {
  local target="$1" source="$2"
  local dest="${target%/}/node_modules" src="${source%/}/node_modules"

  [[ -d "$src" ]] || return 1

  if [[ -L "$dest" ]]; then
    return 0
  fi

  if [[ -e "$dest" ]]; then
    if _hermes_npm_root_ok "$target"; then
      return 0
    fi
    if _hermes_npm_root_ok "$source"; then
      rm -rf "$dest"
    else
      return 1
    fi
  fi

  ln -s "$src" "$dest"
}

_hermes_resolve_checkout() {
  local arg="${1:-}" root

  if [[ -n "$arg" ]]; then
    root="$(cd "$arg" 2>/dev/null && pwd)" || return 1
    [[ -f "$root/hermes_cli/main.py" ]] || return 1
    print -r "$root"
    return 0
  fi

  _hermes_root
}

# Free a TCP port. Prefers killport when installed; falls back to lsof+kill.
_hermes_free_port() {
  local port="$1"
  if command -v killport >/dev/null 2>&1; then
    killport "$port"
  else
    lsof -t -i:"$port" | xargs kill 2>/dev/null
  fi
}

# Launch the Electron desktop app from a worktree, isolated from the
# installed Hermes.app but (by default) sharing the real ~/.hermes state.
hgui() {
  local root deps desktop deps_desktop py arg userdata

  arg="${1:-}"
  root="$(_hermes_resolve_checkout "$arg")" || {
    if [[ -n "$arg" ]]; then
      echo "hgui: $arg is not a Hermes checkout" >&2
    else
      echo "hgui: not inside a Hermes checkout (usage: hgui [path])" >&2
    fi
    return 1
  }

  deps="${HERMES_GUI_DEPS_CHECKOUT:-$HERMES_MAIN_CHECKOUT}"
  desktop="$root/apps/desktop"
  deps_desktop="$deps/apps/desktop"

  if [[ ! -d "$desktop" ]]; then
    echo "hgui: $root does not have apps/desktop" >&2
    return 1
  fi

  if [[ ! -d "$deps_desktop" ]]; then
    echo "hgui: set HERMES_GUI_DEPS_CHECKOUT to a checkout with apps/desktop deps" >&2
    return 1
  fi

  _hermes_link_node_modules "$desktop" "$deps_desktop" || true
  _hermes_link_node_modules "$root" "$deps" || true

  if [[ ! -e "$desktop/node_modules" ]]; then
    echo "hgui: run once: cd $deps && npm ci" >&2
    return 1
  fi

  if ! _hermes_npm_root_ok "$root"; then
    echo "hgui: run once: cd $deps && npm ci" >&2
    return 1
  fi

  py="$HERMES_MAIN_CHECKOUT/.venv/bin/python"
  [[ -x "$py" ]] || py="$(command -v python3)"

  # Vite dev server is fixed at 5174; clear a stale session from another hgui.
  if lsof -t -i:5174 >/dev/null 2>&1; then
    echo "hgui: stopping process on port 5174" >&2
    _hermes_free_port 5174
  fi

  # The dev build and the installed Hermes.app both resolve productName
  # "Hermes", so both land on ~/Library/Application Support/Hermes. Electron's
  # requestSingleInstanceLock() then makes whichever boots second call
  # app.quit() — silently, exit 0 — and `concurrently -k` tears down Vite with
  # it, surfacing as a bogus "dev:renderer exited with SIGTERM". Giving dev its
  # own userData lets both run side by side.
  userdata="${HERMES_GUI_USER_DATA_DIR:-$HOME/Library/Application Support/Hermes-dev}"
  mkdir -p "$userdata"

  # Quick Entry's global chord is first-come-first-served at the OS level, so a
  # dev run would steal it from (or lose it to) the installed app. Seeded once —
  # enable it in dev Settings if you actually want it there.
  [[ -e "$userdata/quick-entry.json" ]] || print -r '{"enabled":false}' >"$userdata/quick-entry.json"

  (
    cd "$desktop" || return
    export PATH="$root/node_modules/.bin:$PATH"
    # HERMES_DESKTOP_USER_DATA_DIR on its own ALSO re-homes HERMES_HOME to
    # "$userdata/hermes-home" (a blank Hermes: no providers, no keys, no
    # sessions). An explicit HERMES_HOME is checked first, so dev keeps sharing
    # the real config/sessions with the installed app.
    HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}" \
    HERMES_DESKTOP_USER_DATA_DIR="$userdata" \
    HERMES_DESKTOP_HERMES_ROOT="$root" \
    HERMES_DESKTOP_PYTHON="$py" \
    HERMES_DESKTOP_IGNORE_EXISTING=1 \
    HERMES_DESKTOP_CWD="$root" \
    npm run dev
  )
}
