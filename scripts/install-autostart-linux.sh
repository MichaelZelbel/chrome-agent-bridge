#!/usr/bin/env bash
# ==============================================================================
# Chrome Agent Bridge — Linux auto-start install (systemd user unit)
#
# Sets up the bridge to auto-start when the user logs in (or always, if
# linger is enabled), and to auto-restart on failure. Run once on the laptop.
#
# Usage:
#   bash scripts/install-autostart-linux.sh
#
# What it does:
#   1. Substitutes paths into the systemd unit template
#   2. Writes ~/.config/systemd/user/chrome-agent-bridge.service
#   3. systemctl --user daemon-reload + enable --now
#   4. (If running as root or via sudo) loginctl enable-linger so it
#      survives logout — important for headless laptops or always-on PCs
#   5. Verifies the gateway responds on 127.0.0.1:3007
# ==============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$REPO_ROOT/scripts/start-chrome-agent-bridge.sh"
TEMPLATE="$REPO_ROOT/templates/chrome-agent-bridge.service.template"
TARGET="$HOME/.config/systemd/user/chrome-agent-bridge.service"

if [ "$(uname -s)" != "Linux" ]; then
  printf '[ERROR] This installer is for Linux only.\n' >&2
  printf '        For macOS,  run scripts/install-autostart-macos.sh\n' >&2
  printf '        For Windows, run scripts\\install-autostart-windows.ps1 (PowerShell)\n' >&2
  exit 1
fi

if [ ! -x "$LAUNCHER" ]; then
  chmod +x "$LAUNCHER" || { printf '[ERROR] cannot chmod +x %s\n' "$LAUNCHER" >&2; exit 1; }
fi

if ! command -v systemctl >/dev/null 2>&1; then
  printf '[ERROR] systemctl not found. This installer requires systemd.\n' >&2
  printf '        On systems without systemd (musl-based, very old, or\n' >&2
  printf '        containers), set up a per-user supervisor manually\n' >&2
  printf '        and call %s on login.\n' "$LAUNCHER" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

# Substitute the launcher path into the template
sed -e "s#{{LAUNCHER_PATH}}#$LAUNCHER#g" "$TEMPLATE" > "$TARGET"

printf '[install] wrote systemd user unit: %s\n' "$TARGET"

# Reload + enable + start
systemctl --user daemon-reload
systemctl --user enable --now chrome-agent-bridge.service

# Try to enable linger so the unit survives logout. Needs sudo.
if loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then
  printf '[install] linger already enabled (unit will survive logout)\n'
else
  if command -v sudo >/dev/null 2>&1; then
    if sudo loginctl enable-linger "$(id -un)" 2>/dev/null; then
      printf '[install] enabled linger (unit now survives logout)\n'
    else
      printf '[install] could not enable linger (sudo refused).\n'
      printf '          The unit will still run while you are logged in;\n'
      printf '          to make it survive logout, run manually:\n'
      printf '            sudo loginctl enable-linger %s\n' "$(id -un)"
    fi
  else
    printf '[install] sudo not available — skipping linger setup.\n'
    printf '          Unit runs while you are logged in.\n'
  fi
fi

# Verify
sleep 3
if systemctl --user is-active chrome-agent-bridge.service | grep -q '^active$'; then
  printf '[install] systemd unit is active\n'
  if curl -fsSL --max-time 5 http://127.0.0.1:3007/health 2>/dev/null; then
    echo
    printf '[install] gateway is responding on 127.0.0.1:3007\n'
  else
    printf '[install] gateway not yet responding — give Chrome ~10s, then retry:\n'
    printf '            curl http://127.0.0.1:3007/health\n'
    printf '          or watch logs with:\n'
    printf '            journalctl --user -u chrome-agent-bridge -f\n'
  fi
else
  printf '[install] unit state is %s — check logs:\n' "$(systemctl --user is-active chrome-agent-bridge.service)"
  printf '            journalctl --user -u chrome-agent-bridge -n 50 --no-pager\n'
fi

cat <<EOF

Installed. Auto-start active:
  Unit:     $TARGET
  Launcher: $LAUNCHER
  Logs:     journalctl --user -u chrome-agent-bridge

To stop:    systemctl --user stop chrome-agent-bridge
To start:   systemctl --user start chrome-agent-bridge
To uninstall: bash scripts/uninstall-autostart-linux.sh
EOF
