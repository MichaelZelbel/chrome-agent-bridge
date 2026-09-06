#!/usr/bin/env bash
# Install the Planino waker as a launchd user agent (macOS).
# Run once from this folder after writing poster.env:  bash install-waker-macos.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="studio.planino.waker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "[ERROR] node not found on PATH" >&2; exit 1; }
[ -f "$HERE/poster.env" ] || { echo "[ERROR] write $HERE/poster.env first (see poster.env.example)" >&2; exit 1; }
chmod +x "$HERE"/runners/*.sh 2>/dev/null || true
mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$HERE/wake.js</string></array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/planino-waker.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/planino-waker.log</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "[install] loaded $LABEL. Log: $HOME/Library/Logs/planino-waker.log"
