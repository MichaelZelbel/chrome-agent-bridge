#!/usr/bin/env bash
# ==============================================================================
# Chrome Agent Bridge — macOS auto-start install (launchd LaunchAgent)
#
# Sets up the bridge to auto-start when the user logs in, and to auto-restart
# if it crashes. Run this once on the laptop.
#
# Usage:
#   bash scripts/install-autostart-macos.sh
#
# What it does:
#   1. Substitutes paths into the launchd plist template
#   2. Writes it to ~/Library/LaunchAgents/com.michaelzelbel.chrome-agent-bridge.plist
#   3. Loads it with `launchctl bootstrap` (modern macOS) or `launchctl load`
#   4. Verifies the agent is registered
# ==============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$REPO_ROOT/scripts/start-chrome-agent-bridge.sh"
TEMPLATE="$REPO_ROOT/templates/com.michaelzelbel.chrome-agent-bridge.plist.template"
TARGET="$HOME/Library/LaunchAgents/com.michaelzelbel.chrome-agent-bridge.plist"
LOG_DIR="$HOME/Library/Logs/chrome-agent-bridge"
LABEL="com.michaelzelbel.chrome-agent-bridge"

if [ "$(uname -s)" != "Darwin" ]; then
  printf '[ERROR] This installer is for macOS only.\n' >&2
  printf '        For Linux,   run scripts/install-autostart-linux.sh\n' >&2
  printf '        For Windows, run scripts\\install-autostart-windows.ps1 (PowerShell)\n' >&2
  exit 1
fi

if [ ! -x "$LAUNCHER" ]; then
  chmod +x "$LAUNCHER" || { printf '[ERROR] cannot chmod +x %s\n' "$LAUNCHER" >&2; exit 1; }
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$TARGET")"

# Substitute paths into the template
sed -e "s#{{LAUNCHER_PATH}}#$LAUNCHER#g" \
    -e "s#{{LOG_DIR}}#$LOG_DIR#g" \
    "$TEMPLATE" > "$TARGET"

printf '[install] wrote launchd plist: %s\n' "$TARGET"

# Load the agent
DOMAIN="gui/$(id -u)"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  printf '[install] agent already registered — bootout-then-bootstrap to refresh\n'
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
fi

if launchctl bootstrap "$DOMAIN" "$TARGET" 2>/dev/null; then
  printf '[install] launchctl bootstrap succeeded\n'
else
  printf '[install] bootstrap failed; falling back to legacy launchctl load\n'
  launchctl load -w "$TARGET"
fi

# Verify
sleep 2
if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q "state = running\|state = waiting"; then
  printf '[install] agent registered and running. Health check:\n'
  sleep 3
  if curl -fsSL --max-time 5 http://127.0.0.1:3007/health 2>/dev/null; then
    echo
    printf '[install] gateway is responding on 127.0.0.1:3007\n'
  else
    printf '[install] gateway not yet responding — give Chrome ~10s to come up, then retry:\n'
    printf '            curl http://127.0.0.1:3007/health\n'
  fi
else
  printf '[install] agent state unknown — check with:\n'
  printf '            launchctl print %s/%s\n' "$DOMAIN" "$LABEL"
fi

cat <<EOF

Installed. Auto-start active:
  Plist:   $TARGET
  Launcher: $LAUNCHER
  Logs:    $LOG_DIR/

To stop:    launchctl bootout $DOMAIN/$LABEL
To start:   launchctl bootstrap $DOMAIN $TARGET
To uninstall: bash scripts/uninstall-autostart-macos.sh
EOF
