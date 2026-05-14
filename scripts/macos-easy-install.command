#!/usr/bin/env bash
# ============================================================================
# Chrome Agent Bridge — macOS Easy Install
#
# One-shot installer for non-technical users. Handles every step end-to-end:
#   1. Verifies macOS 12+
#   2. Installs Homebrew if missing (with the customer's consent)
#   3. Installs Node.js 18+ via Homebrew if missing
#   4. Verifies Google Chrome is present (warns + offers brew install)
#   5. Uses the repo this script is part of (release ZIP / DMG case) OR
#      clones the bridge from GitHub if run standalone
#   6. Runs `npm install`
#   7. Calls install-autostart-macos.sh to register the launchd LaunchAgent
#   8. Verifies the gateway responds on http://127.0.0.1:3007/health
#
# Double-click in Finder, OR run from Terminal:
#   bash scripts/macos-easy-install.command
#
# Idempotent — safe to re-run.
# ============================================================================

set -u

# Colors --------------------------------------------------------------------
if [ -t 1 ]; then
  C_CYAN='\033[1;36m'; C_GREEN='\033[1;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[1;31m'; C_RESET='\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi
step() { printf "${C_CYAN}[install]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[ ok    ]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[ warn  ]${C_RESET} %s\n" "$*"; }
fail() { printf "${C_RED}[ fail  ]${C_RESET} %s\n" "$*"; }

# Banner --------------------------------------------------------------------
echo ""
printf "${C_CYAN}===================================================================${C_RESET}\n"
printf "${C_CYAN} Chrome Agent Bridge — macOS Easy Install${C_RESET}\n"
printf "${C_CYAN}===================================================================${C_RESET}\n"
echo ""

# Keep terminal open at the end if double-clicked from Finder
# (the .command file launches Terminal.app which closes when the script exits
# unless the user has "Close window when shell exits" disabled)
trap 'echo ""; read -p "Press Enter to close this window..." _' EXIT

# 1. macOS version ----------------------------------------------------------
step "Checking macOS version..."
if [ "$(uname -s)" != "Darwin" ]; then
  fail "This installer is macOS-only. You're on: $(uname -s)"
  exit 1
fi
macos_major=$(sw_vers -productVersion | cut -d. -f1)
if [ "$macos_major" -lt 12 ]; then
  fail "macOS 12 (Monterey) or newer is required. Detected: $(sw_vers -productVersion)"
  exit 1
fi
ok "macOS $(sw_vers -productVersion)"

# 2. Homebrew ---------------------------------------------------------------
step "Checking Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew is not installed."
  warn "The installer uses Homebrew to install Node.js (and optionally Chrome)."
  echo ""
  read -p "Install Homebrew now? (y/n) " reply
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    fail "Cannot continue without Homebrew. Install it from https://brew.sh and re-run."
    exit 1
  fi
  step "Installing Homebrew (this takes a few minutes — Apple Silicon installs to /opt/homebrew, Intel to /usr/local)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Source Homebrew shellenv for this session
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  if ! command -v brew >/dev/null 2>&1; then
    fail "Homebrew install didn't put brew on PATH. Open a NEW Terminal window and re-run."
    exit 1
  fi
fi
ok "Homebrew: $(brew --version | head -1)"

# 3. Node.js ----------------------------------------------------------------
step "Checking Node.js..."
need_node_install=0
if command -v node >/dev/null 2>&1; then
  node_version=$(node --version | sed 's/^v//')
  node_major=$(echo "$node_version" | cut -d. -f1)
  if [ "$node_major" -lt 18 ]; then
    warn "Node.js v$node_version is too old (need 18+). Upgrading via brew..."
    need_node_install=1
  else
    ok "Node.js v$node_version (>= 18 required)"
  fi
else
  need_node_install=1
fi
if [ "$need_node_install" -eq 1 ]; then
  step "Installing Node.js via Homebrew..."
  brew install node || { fail "brew install node failed"; exit 1; }
  ok "Node.js installed: $(node --version)"
fi

# 4. Chrome -----------------------------------------------------------------
step "Checking for Google Chrome..."
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  ok "Google Chrome installed"
else
  warn "Google Chrome is not installed."
  warn "The bridge needs Chrome to drive a browser."
  echo ""
  read -p "Install Chrome via Homebrew now? (y/n) " reply
  if [ "$reply" = "y" ] || [ "$reply" = "Y" ]; then
    brew install --cask google-chrome || warn "Chrome cask install failed — install manually from https://www.google.com/chrome/"
  else
    warn "Continuing without Chrome. The bridge will work once you install Chrome later."
  fi
fi

# 5. Locate or fetch the bridge ---------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_CANDIDATE="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd)"

if [ -n "$REPO_CANDIDATE" ] && [ -f "$REPO_CANDIDATE/package.json" ] && [ -d "$REPO_CANDIDATE/gateway" ]; then
  REPO_ROOT="$REPO_CANDIDATE"
  ok "Using bridge sources at $REPO_ROOT"
else
  step "No local bridge sources next to this script. Cloning from GitHub..."
  REPO_ROOT="$HOME/chrome-agent-bridge"
  if [ -d "$REPO_ROOT" ]; then
    step "Existing checkout at $REPO_ROOT — pulling latest"
    ( cd "$REPO_ROOT" && git pull --ff-only ) || { fail "git pull failed"; exit 1; }
  else
    if ! command -v git >/dev/null 2>&1; then
      warn "git not installed — installing via brew..."
      brew install git || { fail "brew install git failed"; exit 1; }
    fi
    git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git "$REPO_ROOT" \
      || { fail "git clone failed"; exit 1; }
  fi
  ok "Cloned to $REPO_ROOT"
fi

# 6. npm install ------------------------------------------------------------
step "Installing Node.js dependencies (this can take 1-2 minutes)..."
( cd "$REPO_ROOT" && npm install --silent --no-audit --no-fund ) \
  || { fail "npm install failed"; exit 1; }
ok "Dependencies installed"

# 7. Auto-start via launchd -------------------------------------------------
step "Setting up auto-start via launchd..."
AUTOSTART="$REPO_ROOT/scripts/install-autostart-macos.sh"
if [ ! -f "$AUTOSTART" ]; then
  fail "Auto-start script not found at $AUTOSTART"
  exit 1
fi
bash "$AUTOSTART" || { fail "Auto-start install reported errors. See output above."; exit 1; }

# 8. Verify -----------------------------------------------------------------
step "Waiting for the gateway to come up (up to 30 seconds)..."
ok_health=0
for i in $(seq 1 15); do
  sleep 2
  if curl -fsSL --max-time 3 http://127.0.0.1:3007/health >/dev/null 2>&1; then
    ok_health=1
    break
  fi
done

echo ""
if [ "$ok_health" -eq 1 ]; then
  printf "${C_GREEN}===================================================================${C_RESET}\n"
  printf "${C_GREEN} Bridge is up and running.${C_RESET}\n"
  printf "${C_GREEN}===================================================================${C_RESET}\n"
  echo ""
  echo "  Bridge location:  $REPO_ROOT"
  echo "  Health endpoint:  http://127.0.0.1:3007/health"
  echo "  Auto-start:       launchd agent com.michaelzelbel.chrome-agent-bridge"
  echo "  Logs:             ~/Library/Logs/chrome-agent-bridge/"
  echo ""
  echo "Next steps (one-time, on the Chrome window that just opened):"
  echo "  1. Log into the sites your agent should be able to use"
  echo "     (LinkedIn, Discord, GitHub, internal dashboards, ...)."
  echo "  2. These logins persist across reboots — they live in the bridge's"
  echo "     dedicated Chrome profile, separate from your everyday browser."
  echo ""
  printf "Your agent on the VPS can now reach the bridge via Tailscale at:\n"
  printf "  ${C_YELLOW}http://<this-Mac-tailnet-IP>:3007/health${C_RESET}\n"
  echo ""
else
  warn "Gateway didn't respond on http://127.0.0.1:3007/health within 30s."
  warn "The launchd agent is registered — try in 30s:"
  warn "  curl http://127.0.0.1:3007/health"
  warn ""
  warn "If still not responding:"
  warn "  launchctl print gui/\$(id -u)/com.michaelzelbel.chrome-agent-bridge | head -30"
  warn "  tail ~/Library/Logs/chrome-agent-bridge/chrome-agent-bridge.err.log"
fi
