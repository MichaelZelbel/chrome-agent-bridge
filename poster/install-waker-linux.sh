#!/usr/bin/env bash
# Install the Planino waker as a systemd user service (Linux).
# Run once from this folder after writing poster.env:  bash install-waker-linux.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT="$HOME/.config/systemd/user/planino-waker.service"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "[ERROR] node not found on PATH" >&2; exit 1; }
[ -f "$HERE/poster.env" ] || { echo "[ERROR] write $HERE/poster.env first (see poster.env.example)" >&2; exit 1; }
chmod +x "$HERE"/runners/*.sh 2>/dev/null || true
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=Planino waker (starts your AI when a browser post is due)
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
WorkingDirectory=$HERE
ExecStart=$NODE $HERE/wake.js
Restart=always
RestartSec=30s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now planino-waker.service
sleep 2
if systemctl --user is-active planino-waker.service | grep -q '^active$'; then
  echo "[install] planino-waker.service is active. Logs: journalctl --user -u planino-waker -f"
else
  echo "[install] the service did not start; see: journalctl --user -u planino-waker -n 50" >&2
  exit 1
fi
if ! loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then
  echo "[install] to keep it running after logout: sudo loginctl enable-linger $(id -un)"
fi
