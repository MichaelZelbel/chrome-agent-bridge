#!/usr/bin/env bash
# ==============================================================================
# Chrome Agent Bridge — Linux auto-start uninstall
# ==============================================================================

set -uo pipefail

TARGET="$HOME/.config/systemd/user/chrome-agent-bridge.service"

if [ "$(uname -s)" != "Linux" ]; then
  printf '[ERROR] This uninstaller is for Linux only.\n' >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now chrome-agent-bridge.service 2>/dev/null || true
  systemctl --user daemon-reload 2>/dev/null || true
fi

if [ -f "$TARGET" ]; then
  rm -f "$TARGET"
  printf '[uninstall] removed %s\n' "$TARGET"
fi

# Stop any leftover processes
pkill -f "gateway/index.js" 2>/dev/null || true
pkill -f "chrome-agent-profile" 2>/dev/null || true

printf '[uninstall] done. Linger setting (if any) preserved — disable manually with:\n'
printf '            sudo loginctl disable-linger %s\n' "$(id -un)"
