#!/usr/bin/env bash
# ==============================================================================
# Chrome Agent Bridge — macOS auto-start uninstall
# ==============================================================================

set -uo pipefail

LABEL="com.michaelzelbel.chrome-agent-bridge"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  printf '[ERROR] This uninstaller is for macOS only.\n' >&2
  exit 1
fi

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl unload "$TARGET" 2>/dev/null || true
  printf '[uninstall] unloaded launchd agent\n'
fi

if [ -f "$TARGET" ]; then
  rm -f "$TARGET"
  printf '[uninstall] removed %s\n' "$TARGET"
fi

# Stop any running gateway / Chrome started via the launcher
pkill -f "gateway/index.js" 2>/dev/null || true
pkill -f "ChromeAgentProfile" 2>/dev/null || true

printf '[uninstall] done. Logs preserved at ~/Library/Logs/chrome-agent-bridge/\n'
