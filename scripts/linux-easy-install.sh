#!/usr/bin/env bash
# ============================================================================
# Chrome Agent Bridge — Linux Easy Install
#
# One-shot installer for non-technical users. Mirrors the macOS easy-install
# end-to-end:
#   1. Detects Linux distro / package manager (apt | dnf | pacman | zypper)
#   2. Installs Node.js 18+ via NodeSource LTS if missing (with consent;
#      apt/dnf only — other distros must install Node manually)
#   3. Installs Google Chrome from Google's official .deb / .rpm if missing
#      (with consent; apt/dnf + x86_64 only — Google does not ship Chrome
#      for ARM Linux or for pacman/zypper natively)
#   4. Uses the repo this script is part of (release tar.gz case) OR clones
#      the bridge from GitHub if run standalone
#   5. Runs `npm install`
#   6. Calls install-autostart-linux.sh to register the systemd user unit
#   7. Verifies the gateway responds on http://127.0.0.1:3007/health
#
# Double-click in your file manager (must be marked executable), OR run from
# a terminal:
#   bash scripts/linux-easy-install.sh
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
printf "${C_CYAN} Chrome Agent Bridge — Linux Easy Install${C_RESET}\n"
printf "${C_CYAN}===================================================================${C_RESET}\n"
echo ""

# Keep terminal open at end if double-clicked from a file manager
trap 'echo ""; read -p "Press Enter to close this window..." _' EXIT

# Privilege escalation. Several steps (Node via NodeSource, Chrome via
# apt/dnf, possibly installing git) need root. Detect once up front so we
# can either prefix commands with `sudo -E` or skip package installs with
# a clear warning when neither root nor sudo is available.
if [ "$(id -u)" -eq 0 ]; then
  AS_ROOT=""
  CAN_INSTALL=1
elif command -v sudo >/dev/null 2>&1; then
  AS_ROOT="sudo -E"
  CAN_INSTALL=1
else
  AS_ROOT=""
  CAN_INSTALL=0
fi

# 1. Distro detection -------------------------------------------------------
step "Detecting Linux distribution..."
if [ "$(uname -s)" != "Linux" ]; then
  fail "This installer is Linux-only. You're on: $(uname -s)"
  exit 1
fi

PKG=""
if   command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf     >/dev/null 2>&1; then PKG=dnf
elif command -v pacman  >/dev/null 2>&1; then PKG=pacman
elif command -v zypper  >/dev/null 2>&1; then PKG=zypper
fi

if [ -r /etc/os-release ]; then
  DISTRO_NAME="$( . /etc/os-release && echo "${PRETTY_NAME:-${NAME:-Linux}}" )"
else
  DISTRO_NAME="$(uname -sr)"
fi
ARCH="$(uname -m)"

case "$PKG" in
  apt|dnf)
    ok "$DISTRO_NAME ($ARCH, package manager: $PKG)"
    ;;
  pacman|zypper)
    warn "$DISTRO_NAME ($ARCH, package manager: $PKG)"
    warn "Auto-install of Node.js and Chrome is supported on apt and dnf only."
    warn "This installer will check what's already present and skip the rest."
    ;;
  "")
    warn "$DISTRO_NAME ($ARCH) -- no apt/dnf/pacman/zypper found."
    warn "Auto-install of Node.js and Chrome is not supported here."
    warn "Install Node 18+ and Google Chrome (or Chromium) manually, then re-run."
    ;;
esac

if [ "$CAN_INSTALL" -eq 0 ]; then
  warn "Neither root nor sudo is available. Package installs will be skipped."
fi

# 2. Node.js ----------------------------------------------------------------
step "Checking Node.js..."
need_node_install=0
if command -v node >/dev/null 2>&1; then
  node_version=$(node --version | sed 's/^v//')
  node_major=$(echo "$node_version" | cut -d. -f1)
  if [ "$node_major" -lt 18 ]; then
    warn "Node.js v$node_version is too old (need 18+)."
    need_node_install=1
  else
    ok "Node.js v$node_version (>= 18 required)"
  fi
else
  warn "Node.js is not installed."
  need_node_install=1
fi

if [ "$need_node_install" -eq 1 ]; then
  if [ "$CAN_INSTALL" -eq 0 ]; then
    fail "Cannot install Node.js without root/sudo. Install Node 18+ manually and re-run."
    exit 1
  fi
  case "$PKG" in
    apt|dnf)
      echo ""
      warn "About to install Node.js LTS via NodeSource (adds the official"
      warn "Node.js apt/yum repository, then installs the 'nodejs' package)."
      if [ "$PKG" = "apt" ]; then
        warn "Will run: curl -fsSL https://deb.nodesource.com/setup_lts.x | $AS_ROOT bash"
      else
        warn "Will run: curl -fsSL https://rpm.nodesource.com/setup_lts.x | $AS_ROOT bash"
      fi
      read -p "Continue? (y/n) " reply
      if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
        fail "Cannot continue without Node 18+. Install manually and re-run."
        exit 1
      fi
      # Download the NodeSource setup script to a temp file rather than
      # piping straight to bash -- lets us reuse a single $AS_ROOT path for
      # both root and sudo callers, and makes the failure mode clearer.
      step "Downloading NodeSource setup script..."
      NODE_SETUP="$(mktemp)"
      if [ "$PKG" = "apt" ]; then
        curl -fsSL -o "$NODE_SETUP" https://deb.nodesource.com/setup_lts.x \
          || { fail "NodeSource setup download failed"; rm -f "$NODE_SETUP"; exit 1; }
      else
        curl -fsSL -o "$NODE_SETUP" https://rpm.nodesource.com/setup_lts.x \
          || { fail "NodeSource setup download failed"; rm -f "$NODE_SETUP"; exit 1; }
      fi
      step "Running NodeSource setup as root..."
      $AS_ROOT bash "$NODE_SETUP" || { fail "NodeSource setup failed"; rm -f "$NODE_SETUP"; exit 1; }
      rm -f "$NODE_SETUP"
      step "Installing nodejs package..."
      if [ "$PKG" = "apt" ]; then
        $AS_ROOT apt-get install -y nodejs || { fail "apt-get install nodejs failed"; exit 1; }
      else
        $AS_ROOT dnf install -y nodejs || { fail "dnf install nodejs failed"; exit 1; }
      fi
      ok "Node.js installed: $(node --version)"
      ;;
    *)
      fail "Auto-install of Node.js on '$PKG' is not supported by this script."
      fail "Install Node 18+ via your distro (or nvm / asdf) and re-run."
      exit 1
      ;;
  esac
fi

# 3. Chrome -----------------------------------------------------------------
step "Checking for Google Chrome / Chromium..."
chrome_found=0
for c in google-chrome-stable google-chrome chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then
    ok "Found: $(command -v "$c")"
    chrome_found=1
    break
  fi
done
if [ "$chrome_found" -eq 0 ]; then
  for p in /snap/bin/chromium /snap/bin/google-chrome /opt/google/chrome/google-chrome; do
    if [ -x "$p" ]; then ok "Found: $p"; chrome_found=1; break; fi
  done
fi

if [ "$chrome_found" -eq 0 ]; then
  warn "Google Chrome / Chromium is not installed."
  warn "The bridge needs Chrome (or Chromium) to drive a browser."

  if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
    warn "Detected architecture: $ARCH. Google does not ship Chrome for Linux on"
    warn "anything other than x86_64. Install Chromium via your distro's package"
    warn "manager, or set CHROME_BIN_OVERRIDE to point at any Chrome/Chromium binary."
  elif [ "$CAN_INSTALL" -eq 0 ]; then
    warn "Need root or sudo to install Chrome. Install manually from"
    warn "https://www.google.com/chrome/ -- the bridge will work once it's present."
  else
    case "$PKG" in
      apt)
        echo ""
        read -p "Install Google Chrome from the official .deb now? (y/n) " reply
        if [ "$reply" = "y" ] || [ "$reply" = "Y" ]; then
          step "Downloading google-chrome-stable_current_amd64.deb..."
          TMPDEB="$(mktemp --suffix=.deb)"
          if curl -fsSL -o "$TMPDEB" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; then
            step "Installing Chrome via apt-get..."
            if $AS_ROOT apt-get install -y "$TMPDEB"; then
              ok "Google Chrome installed"
            else
              warn "apt-get install failed. Install manually from https://www.google.com/chrome/"
            fi
          else
            warn "Chrome .deb download failed. Install manually from https://www.google.com/chrome/"
          fi
          rm -f "$TMPDEB"
        else
          warn "Continuing without Chrome. Install it later from https://www.google.com/chrome/"
        fi
        ;;
      dnf)
        echo ""
        read -p "Install Google Chrome from the official .rpm now? (y/n) " reply
        if [ "$reply" = "y" ] || [ "$reply" = "Y" ]; then
          step "Downloading google-chrome-stable_current_x86_64.rpm..."
          TMPRPM="$(mktemp --suffix=.rpm)"
          if curl -fsSL -o "$TMPRPM" https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm; then
            step "Installing Chrome via dnf..."
            if $AS_ROOT dnf install -y "$TMPRPM"; then
              ok "Google Chrome installed"
            else
              warn "dnf install failed. Install manually from https://www.google.com/chrome/"
            fi
          else
            warn "Chrome .rpm download failed. Install manually from https://www.google.com/chrome/"
          fi
          rm -f "$TMPRPM"
        else
          warn "Continuing without Chrome. Install it later from https://www.google.com/chrome/"
        fi
        ;;
      pacman)
        warn "Arch users: install google-chrome from the AUR (e.g. 'yay -S google-chrome')"
        warn "or 'sudo pacman -S chromium' for the upstream open-source build."
        warn "The bridge works with either as long as the binary is on PATH."
        ;;
      zypper)
        warn "openSUSE users: 'sudo zypper install chromium', or download the Google .rpm"
        warn "from https://www.google.com/chrome/ and 'sudo zypper install ./<file>.rpm'."
        ;;
      *)
        warn "Install Chrome (or Chromium) via your distro's package manager."
        ;;
    esac
  fi
fi

# 4. Locate or fetch the bridge ---------------------------------------------
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
      if [ "$CAN_INSTALL" -eq 1 ]; then
        case "$PKG" in
          apt) step "Installing git..."; $AS_ROOT apt-get install -y git || { fail "git install failed"; exit 1; } ;;
          dnf) step "Installing git..."; $AS_ROOT dnf install -y git || { fail "git install failed"; exit 1; } ;;
          *)   fail "git is required. Install it via your package manager and re-run."; exit 1 ;;
        esac
      else
        fail "git is required and cannot be auto-installed without root/sudo. Install it and re-run."
        exit 1
      fi
    fi
    git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git "$REPO_ROOT" \
      || { fail "git clone failed"; exit 1; }
  fi
  ok "Cloned to $REPO_ROOT"
fi

# 5. npm install ------------------------------------------------------------
step "Installing Node.js dependencies (this can take 1-2 minutes)..."
( cd "$REPO_ROOT" && npm install --silent --no-audit --no-fund ) \
  || { fail "npm install failed"; exit 1; }
ok "Dependencies installed"

# 6. Auto-start via systemd -------------------------------------------------
step "Setting up auto-start via systemd user unit..."
AUTOSTART="$REPO_ROOT/scripts/install-autostart-linux.sh"
if [ ! -f "$AUTOSTART" ]; then
  fail "Auto-start script not found at $AUTOSTART"
  exit 1
fi
bash "$AUTOSTART" || { fail "Auto-start install reported errors. See output above."; exit 1; }

# 7. Verify -----------------------------------------------------------------
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
  echo "  Auto-start:       systemd user unit chrome-agent-bridge.service"
  echo "  Logs:             journalctl --user -u chrome-agent-bridge"
  echo ""
  echo "Next steps (one-time, on the Chrome window that just opened):"
  echo "  1. Log into the sites your agent should be able to use"
  echo "     (LinkedIn, Discord, GitHub, internal dashboards, ...)."
  echo "  2. These logins persist across reboots — they live in the bridge's"
  echo "     dedicated Chrome profile, separate from your everyday browser."
  echo ""
  printf "Your agent on the VPS can now reach the bridge via Tailscale at:\n"
  printf "  ${C_YELLOW}http://<this-Linux-tailnet-IP>:3007/health${C_RESET}\n"
  echo ""
else
  warn "Gateway didn't respond on http://127.0.0.1:3007/health within 30s."
  warn "The systemd unit is registered — try in 30s:"
  warn "  curl http://127.0.0.1:3007/health"
  warn ""
  warn "If still not responding:"
  warn "  systemctl --user status chrome-agent-bridge"
  warn "  journalctl --user -u chrome-agent-bridge -n 50 --no-pager"
fi
