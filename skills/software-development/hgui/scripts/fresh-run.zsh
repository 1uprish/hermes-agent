#!/usr/bin/env zsh
# fresh-run.zsh — launch the Hermes desktop app with fresh state.
#
# Usage: fresh-run.zsh [--keep-auth] [--reset] <worktree>
#
#   (default)    Blank new user: tmp HERMES_HOME + tmp userData. No providers,
#                no sessions — the Nous Portal login wall is expected.
#   --keep-auth  Fresh state that inherits real auth: HERMES_HOME becomes
#                ~/.hermes/profiles/fresh-<worktree-name>, so per-provider
#                credentials (Nous Portal, ...) shadow through read-only from
#                the global ~/.hermes/auth.json (profile-mode fallback,
#                hermes_cli/auth.py, issue #18594). Sessions/config/skills
#                still start empty. Rerun to continue the same user.
#   --reset      With --keep-auth: wipe the profile before launching.
#
# Onboarding stage vars pass straight through the environment:
#   VITE_INTRO_REVEAL=1 VITE_ONBOARDING_STAGE=full fresh-run.zsh --keep-auth <wt>
#
# Do NOT copy ~/.hermes/auth.json into a scratch home instead: Nous refresh
# tokens are single-use and rotate; a forked store replays a consumed token
# and logs your real install out. The profile fallback writes rotations back
# to the source store — that is the designed path.
#
# hgui by Brooklyn (@OutThisLife); this wrapper by Austin Pickett.

emulate -L zsh
set -u

keep_auth=0
reset=0
while (( $# )); do
  case "$1" in
    --keep-auth) keep_auth=1; shift ;;
    --reset) reset=1; shift ;;
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
      exit 0
      ;;
    --*) echo "fresh-run: unknown flag $1 (see --help)" >&2; exit 1 ;;
    *) break ;;
  esac
done

wt="${1:-}"
if [[ -z "$wt" || ! -d "$wt" ]]; then
  echo "usage: fresh-run.zsh [--keep-auth] [--reset] <worktree>" >&2
  exit 1
fi
wt="${wt:A}"

if (( reset && !keep_auth )); then
  echo "fresh-run: --reset only applies with --keep-auth (default mode is always fresh)" >&2
fi

: "${HERMES_MAIN_CHECKOUT:?fresh-run: export HERMES_MAIN_CHECKOUT=<main hermes checkout> first}"

# hgui is a shell function — source the template shipped beside this script.
script_dir="${0:A:h}"
hgui_lib="$script_dir/../templates/hgui.zsh"
if [[ ! -f "$hgui_lib" ]]; then
  echo "fresh-run: missing $hgui_lib (keep the skill's scripts/ and templates/ dirs together)" >&2
  exit 1
fi
source "$hgui_lib"

if (( keep_auth )); then
  profile="$HOME/.hermes/profiles/fresh-${wt:t}"
  if (( reset )); then
    echo "fresh-run: wiping $profile" >&2
    rm -rf "$profile"
  fi
  mkdir -p "$profile/userdata"
  echo "fresh-run: HERMES_HOME=$profile (per-provider auth inherited from ~/.hermes)" >&2
  echo "fresh-run: rerun to continue this user; full reset: rm -rf $profile" >&2
  HERMES_HOME="$profile" HERMES_GUI_USER_DATA_DIR="$profile/userdata" hgui "$wt"
else
  fresh="$(mktemp -d /tmp/hermes-fresh.XXXX)"
  mkdir -p "$fresh/home" "$fresh/userdata"
  echo "fresh-run: scratch state in $fresh" >&2
  echo "fresh-run: continue this user later with:" >&2
  echo "  HERMES_HOME=$fresh/home HERMES_GUI_USER_DATA_DIR=$fresh/userdata hgui $wt" >&2
  HERMES_HOME="$fresh/home" HERMES_GUI_USER_DATA_DIR="$fresh/userdata" hgui "$wt"
fi
