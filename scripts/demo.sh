#!/usr/bin/env bash
#
# One command: install, then run both apps.
#
# Habba is two apps that meet in the middle. الفحص is the clearest case — an
# inspector files a document in `apps/mobile` and a buyer reads it there, while
# the approval that let the inspector exist at all happens in `apps/admin`, and
# every such approval writes a row the console then shows. Trying any of that
# one app at a time means starting two terminals and remembering two commands
# and two sets of flags, which is three chances to get it wrong before seeing
# anything.
#
# So: `pnpm go`.
#
#   * `pnpm install`, because a fresh clone or a changed lockfile otherwise
#     fails several confusing steps later.
#   * The ops console in the background, on 3100.
#   * Metro in the foreground, with the dev flags set inline — see
#     `apps/mobile/README.md` for what they do and why one of them exists.
#
# Ctrl-C stops both. The tidy-up is not a nicety and it is not one `kill`:
# `pnpm` wraps `next dev` which spawns `next-server`, so signalling the wrapper
# leaves a server holding 3100 that the NEXT run cannot bind — reported as a
# port conflict rather than as the orphan it is.
#
# Nor is `set -m` the answer, which was the first attempt. Job control gives
# every job its own process group, so the group signal a terminal sends on
# Ctrl-C stops reaching the children this script started — measured, not
# assumed: with it on, an interrupt to the script's group left both servers
# running. Without it everything shares one group, Ctrl-C reaches all of it,
# and the trap below mops up whatever ignored the signal.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ADMIN_PORT="${HABBA_ADMIN_PORT:-3100}"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
# Refuse an orphan rather than starting on top of it
# ---------------------------------------------------------------------------
# A console left over from an earlier run answers on 3100 perfectly well, and
# it is serving the code it was started with. Starting "successfully" on top of
# it is how you spend twenty minutes wondering why an edit changed nothing.
if lsof -nP -iTCP:"$ADMIN_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $ADMIN_PORT is already in use:" >&2
  lsof -nP -iTCP:"$ADMIN_PORT" -sTCP:LISTEN >&2
  echo "       stop it first, or set HABBA_ADMIN_PORT to a free port." >&2
  exit 1
fi

bold "هبّة — installing"
pnpm install

# Depth-first, so a parent is not killed before its children can be found.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

ADMIN_PID=""
cleaned=""
cleanup() {
  # EXIT fires after INT/TERM have already run this, and killing a tree twice
  # prints noise about processes that are gone.
  #
  # An `if`, not `[ -n "$cleaned" ] && return`: under `set -e` that list exits
  # non-zero on the FIRST run — when there is nothing to skip — and takes the
  # rest of the tidy-up with it. The guard would then work only on the run
  # where it does nothing.
  if [ -n "$cleaned" ]; then
    return 0
  fi
  cleaned=1
  if [ -n "$ADMIN_PID" ]; then
    kill_tree "$ADMIN_PID"
    wait "$ADMIN_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

bold "هبّة — ops console on http://localhost:$ADMIN_PORT"
dim "   sign in: ops@habba.sa / any password of 8+ characters"
HABBA_ADMIN_PORT="$ADMIN_PORT" pnpm --filter @habba/admin exec next dev --port "$ADMIN_PORT" &
ADMIN_PID=$!

# Wait for it to answer rather than printing a URL that 404s for ten seconds.
# Not fatal if it never does: Metro is the main event, and a failed console
# should not stop you looking at the app.
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$ADMIN_PORT" 2>/dev/null; then break; fi
  if ! kill -0 "$ADMIN_PID" 2>/dev/null; then
    echo "warning: the ops console exited during startup — carrying on without it." >&2
    ADMIN_PID=""
    break
  fi
  sleep 0.5
done

echo
bold "هبّة — starting the app"
dim "   OTP code: 123456 · provider mode and dev approval are ON"
dim "   press i for the iOS simulator, a for Android, or scan the QR"
echo

# Foreground, so Ctrl-C reaches it and the trap above tidies up the console.
EXPO_PUBLIC_ENABLE_PROVIDER_MODE=true \
EXPO_PUBLIC_DEV_APPROVE_PROVIDER=true \
  pnpm --filter @habba/mobile start
