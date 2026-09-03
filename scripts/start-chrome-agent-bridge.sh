#!/usr/bin/env bash
# ==============================================================================
# Chrome Agent Bridge — POSIX launcher (macOS + Linux)
#
# Starts Chrome with remote debugging bound to 127.0.0.1 using a dedicated
# user-data-dir, then starts the gateway.
#
# Chrome remote debugging is NEVER exposed to the network. Only the gateway
# (default port 3007) is reachable from your private network (e.g. Tailscale).
# ==============================================================================

set -uo pipefail

# --- Locate Chrome ----------------------------------------------------------
CHROME_BIN=""

case "$(uname -s)" in
  Darwin)  # macOS
    CANDIDATES=(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
      "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )
    DEFAULT_PROFILE_DIR="$HOME/Library/Application Support/ChromeAgentProfile"
    ;;
  Linux)
    CANDIDATES=(
      "/usr/bin/google-chrome-stable"
      "/usr/bin/google-chrome"
      "/usr/bin/chromium"
      "/usr/bin/chromium-browser"
      "/snap/bin/chromium"
      "/snap/bin/google-chrome"
      "/opt/google/chrome/google-chrome"
    )
    DEFAULT_PROFILE_DIR="$HOME/.local/share/chrome-agent-profile"
    ;;
  *)
    printf '[ERROR] Unsupported OS: %s. This launcher supports macOS and Linux.\n' "$(uname -s)" >&2
    printf '        For Windows, run scripts\\start-chrome-agent-bridge.bat instead.\n' >&2
    exit 1
    ;;
esac

for cand in "${CANDIDATES[@]}"; do
  if [ -x "$cand" ]; then
    CHROME_BIN="$cand"
    break
  fi
done

if [ -z "$CHROME_BIN" ]; then
  printf '[ERROR] Could not find Chrome or Chromium on this host.\n' >&2
  printf '        Looked in:\n' >&2
  for cand in "${CANDIDATES[@]}"; do
    printf '          %s\n' "$cand" >&2
  done
  printf '        Install Google Chrome from https://www.google.com/chrome/, OR\n' >&2
  printf '        set CHROME_BIN to your binary path before running this script:\n' >&2
  printf '          CHROME_BIN=/path/to/chrome %s\n' "$0" >&2
  exit 1
fi

# Allow CHROME_BIN env override
CHROME_BIN="${CHROME_BIN_OVERRIDE:-$CHROME_BIN}"

# --- Configuration ----------------------------------------------------------
# Multi-agent: override these env vars before calling this script (or set
# them inside a small wrapper script). The launcher-side contract is the
# CAB_* knobs below; we translate them into the env vars gateway/index.js
# actually reads (HOST / PORT / CDP_URL) right after.
USER_DATA_DIR="${CAB_PROFILE_DIR:-$DEFAULT_PROFILE_DIR}"
CDP_PORT="${CAB_CDP_PORT:-9222}"
CDP_ADDRESS="${CAB_CDP_ADDRESS:-127.0.0.1}"
GATEWAY_PORT="${CAB_GATEWAY_PORT:-3007}"
GATEWAY_HOST="${CAB_GATEWAY_HOST:-0.0.0.0}"
GATEWAY_DIR="$(cd "$(dirname "$0")/.." && pwd)/gateway"

# Translate to the gateway's own env-var contract.
export HOST="$GATEWAY_HOST"
export PORT="$GATEWAY_PORT"
export CDP_URL="http://$CDP_ADDRESS:$CDP_PORT"

# Hand the gateway what it needs to RELAUNCH Chrome if the CDP endpoint ever
# disappears (e.g. Chrome relaunched without the debug port after a background
# update). With these set, the gateway's watchdog kills any Chrome still holding
# THIS profile and restarts it with the right flags. Scoped to the dedicated
# profile only -- your personal Chrome (different profile) is never touched.
# Unset them to disable the watchdog.
export CAB_CHROME_BIN="$CHROME_BIN"
export CAB_PROFILE_DIR="$USER_DATA_DIR"

mkdir -p "$USER_DATA_DIR"

# --- Start Chrome -----------------------------------------------------------
printf 'Starting Chrome with remote debugging on %s:%s\n' "$CDP_ADDRESS" "$CDP_PORT"
printf 'Profile: %s\n' "$USER_DATA_DIR"
printf 'Binary:  %s\n' "$CHROME_BIN"

# Detach Chrome so the script can move on. setsid (Linux) or `&` + disown (macOS).
# --disable-component-update stops Chrome from swapping out components
# (Widevine, CRLSet, Origin Trials, ...) mid-session, which can briefly disrupt
# the page the agent is driving. NOTE: it does NOT stop Chrome from upgrading
# its own browser binary -- that is done by the OS-level updater (Keystone on
# macOS, the package manager on Linux), which ignores Chrome's command line.
#
# On an unattended Linux autologin, no keyring password is available. Chrome can
# wait forever for the keyring instead of opening its CDP endpoint, so use its
# basic local password store there. Dedicated bridge profiles and their host must
# therefore be protected like any other unencrypted browser session.
CHROME_SESSION_FLAGS=()
if [ "$(uname -s)" = "Linux" ]; then
  CHROME_SESSION_FLAGS+=(--password-store=basic)
fi

if command -v setsid >/dev/null 2>&1; then
  setsid -f "$CHROME_BIN" \
    --remote-debugging-port="$CDP_PORT" \
    --remote-debugging-address="$CDP_ADDRESS" \
    --disable-component-update \
    --no-first-run \
    "${CHROME_SESSION_FLAGS[@]}" \
    --user-data-dir="$USER_DATA_DIR" \
    about:blank \
    >/dev/null 2>&1 || true
else
  "$CHROME_BIN" \
    --remote-debugging-port="$CDP_PORT" \
    --remote-debugging-address="$CDP_ADDRESS" \
    --disable-component-update \
    --no-first-run \
    "${CHROME_SESSION_FLAGS[@]}" \
    --user-data-dir="$USER_DATA_DIR" \
    about:blank \
    >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

# Give Chrome a moment to initialize the debugging endpoint
sleep 5

# --- Start the gateway ------------------------------------------------------
printf 'Starting Chrome Agent Bridge gateway...\n'
cd "$GATEWAY_DIR" || { printf '[ERROR] gateway dir not found: %s\n' "$GATEWAY_DIR" >&2; exit 1; }
exec node index.js
