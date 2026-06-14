#!/usr/bin/env bash
# ============================================================================
# Chrome Agent Bridge — macOS / Linux double-click installer
#
# Dispatches to the OS-specific easy-installer based on `uname -s`. Mirror of
# setup.bat for Windows.
#
# Note for packagers: BOTH this file AND the per-OS scripts under scripts/
# must have the executable bit set (chmod +x) before being zipped or shipped
# in a tar.gz / DMG — otherwise Finder (macOS) and most Linux file managers
# open them in a text editor on double-click instead of running them.
# ============================================================================

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$(uname -s)" in
  Darwin)
    exec bash "$DIR/scripts/macos-easy-install.command"
    ;;
  Linux)
    exec bash "$DIR/scripts/linux-easy-install.sh"
    ;;
  *)
    echo "[ERROR] Unsupported OS: $(uname -s)" >&2
    echo "        For Windows, double-click setup.bat instead." >&2
    exit 1
    ;;
esac
