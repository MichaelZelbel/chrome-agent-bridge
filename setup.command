#!/usr/bin/env bash
# ============================================================================
# Chrome Agent Bridge — macOS double-click installer
#
# Wraps scripts/macos-easy-install.command so the user can double-click this
# at the repo root in Finder. Mirror of setup.bat for Windows.
#
# Note for packagers: BOTH this file AND scripts/macos-easy-install.command
# must have the executable bit set (chmod +x) before being zipped or shipped
# in a DMG — otherwise Finder opens them in a text editor on double-click.
# ============================================================================

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$DIR/scripts/macos-easy-install.command"
