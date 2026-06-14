# =============================================================================
# Chrome Agent Bridge -- Windows Easy Install
#
# One-shot installer for non-technical users. Handles every step end-to-end:
#   1. Verifies Windows 10/11
#   2. Installs Node.js via winget if missing (or points the user to nodejs.org
#      if winget isn't available on this Windows build)
#   3. Verifies Chrome is present (warns but continues if missing -- the user
#      can install it later)
#   4. Either uses the repo this script is part of (the normal case: user
#      extracted a release ZIP and double-clicked setup.bat), OR clones the
#      bridge from GitHub if run standalone
#   5. Runs `npm install`
#   6. Calls install-autostart-windows.ps1 to register the Task Scheduler entry
#   7. Verifies the gateway responds on http://127.0.0.1:3007/health
#
# Triggered either by double-clicking setup.bat OR by running directly:
#   powershell -ExecutionPolicy Bypass -File scripts\windows-easy-install.ps1
#
# Idempotent -- safe to re-run.
# =============================================================================

$ErrorActionPreference = 'Stop'

# Color helpers -----------------------------------------------------------------
function Write-Step    { param($msg) Write-Host "[install] $msg" -ForegroundColor Cyan }
function Write-Ok      { param($msg) Write-Host "[ ok    ] $msg" -ForegroundColor Green }
function Write-Warn    { param($msg) Write-Host "[ warn  ] $msg" -ForegroundColor Yellow }
function Write-Fail    { param($msg) Write-Host "[ fail  ] $msg" -ForegroundColor Red }

# Banner ------------------------------------------------------------------------
Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host " Chrome Agent Bridge -- Windows Easy Install" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Windows version -----------------------------------------------------------
Write-Step "Checking Windows version..."
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
if ($build -lt 10240) {
    Write-Fail "This installer requires Windows 10 (build 10240) or newer."
    Write-Fail "Detected: $($os.Caption), build $build"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "$($os.Caption), build $build"

# 2. Node.js -------------------------------------------------------------------
Write-Step "Checking Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVersion = (& node --version 2>$null) -replace '^v',''
    $major = [int]($nodeVersion -split '\.' | Select-Object -First 1)
    if ($major -ge 18) {
        Write-Ok "Node.js v$nodeVersion (>= 18 required)"
    } else {
        Write-Warn "Node.js v$nodeVersion is too old (need 18+). Attempting upgrade via winget..."
        $node = $null
    }
}

if (-not $node) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Fail "Node.js 18+ is required but not installed, and winget is unavailable on this Windows build."
        Write-Fail "Install Node.js LTS manually from https://nodejs.org/ then re-run this installer."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Step "Installing Node.js LTS via winget (this takes ~30 seconds)..."
    & winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "winget install failed (exit code $LASTEXITCODE)."
        Write-Fail "Install Node.js LTS manually from https://nodejs.org/ then re-run."
        Read-Host "Press Enter to exit"
        exit 1
    }
    # Refresh PATH so 'node' becomes findable without restarting the shell
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warn "Node.js was installed but isn't on this shell's PATH yet."
        Write-Warn "Close this window, open a NEW PowerShell window, and re-run setup.bat."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Ok "Node.js installed: $(& node --version)"
}

# 3. Chrome -------------------------------------------------------------------
Write-Step "Checking for Google Chrome..."
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeFound = $false
foreach ($p in $chromePaths) {
    if (Test-Path $p) { $chromeFound = $true; Write-Ok "Chrome found at $p"; break }
}
if (-not $chromeFound) {
    Write-Warn "Google Chrome is not installed."
    Write-Warn "The bridge needs Chrome to drive a browser."
    Write-Host ""
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        $reply = Read-Host "Install Google Chrome via winget now? (y/n)"
        if ($reply -eq 'y' -or $reply -eq 'Y') {
            Write-Step "Installing Google Chrome via winget (this takes ~30-60 seconds)..."
            & winget install --id Google.Chrome --silent --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "winget install failed (exit code $LASTEXITCODE)."
                Write-Warn "Install Chrome manually from https://www.google.com/chrome/ -- the bridge will work once it's present."
                $continue = Read-Host "Continue without Chrome? (y/n)"
                if ($continue -ne 'y' -and $continue -ne 'Y') { exit 0 }
            } else {
                foreach ($p in $chromePaths) {
                    if (Test-Path $p) { $chromeFound = $true; Write-Ok "Chrome installed at $p"; break }
                }
                if (-not $chromeFound) {
                    Write-Warn "winget reported success but chrome.exe wasn't found in standard locations yet. Continuing -- the bridge will pick it up once Chrome is on disk."
                }
            }
        } else {
            Write-Warn "Continuing without Chrome. Install it later from https://www.google.com/chrome/ -- the bridge will work once Chrome is present."
        }
    } else {
        Write-Warn "winget isn't available on this Windows build, so Chrome can't be auto-installed."
        Write-Warn "Install Chrome manually from https://www.google.com/chrome/ -- the bridge will work once it's present."
        $continue = Read-Host "Continue without Chrome? (y/n)"
        if ($continue -ne 'y' -and $continue -ne 'Y') { exit 0 }
    }
}

# 4. Locate or fetch the bridge ------------------------------------------------
# If this script lives inside a bridge checkout (scripts/ next to package.json),
# use that. Otherwise clone the public repo into %USERPROFILE%\chrome-agent-bridge.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoCandidate = (Resolve-Path "$ScriptDir\.." -ErrorAction SilentlyContinue).Path
if ($RepoCandidate -and (Test-Path "$RepoCandidate\package.json") -and (Test-Path "$RepoCandidate\gateway")) {
    $RepoRoot = $RepoCandidate
    Write-Ok "Using bridge sources at $RepoRoot"
} else {
    Write-Step "No local bridge sources next to this script. Cloning from GitHub..."
    $RepoRoot = Join-Path $env:USERPROFILE 'chrome-agent-bridge'
    if (Test-Path $RepoRoot) {
        Write-Step "Existing checkout at $RepoRoot -- pulling latest"
        Push-Location $RepoRoot
        try {
            & git pull --ff-only
            if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
        } finally { Pop-Location }
    } else {
        $git = Get-Command git -ErrorAction SilentlyContinue
        if (-not $git) {
            $winget = Get-Command winget -ErrorAction SilentlyContinue
            if ($winget) {
                Write-Step "git not found -- installing via winget..."
                & winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements | Out-Null
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            } else {
                Write-Fail "git is required to clone the bridge. Install from https://git-scm.com/ and re-run."
                Read-Host "Press Enter to exit"
                exit 1
            }
        }
        & git clone https://github.com/MichaelZelbel/chrome-agent-bridge.git $RepoRoot
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "git clone failed."
            Read-Host "Press Enter to exit"
            exit 1
        }
    }
    Write-Ok "Cloned to $RepoRoot"
}

# 5. npm install ---------------------------------------------------------------
# Invoking npm via `& npm install ...` on Windows PowerShell 5.1 against
# the npm.cmd shim has a known argument-passing wart on some Win11 + npm 11
# setups -- npm sees a mangled first arg (e.g. "pm" instead of "install").
# `cmd /c` delegates parsing to cmd.exe which handles .cmd shims natively,
# avoiding PowerShell's external-command quoting quirks.
Write-Step "Installing Node.js dependencies (this can take 1-2 minutes)..."
Push-Location $RepoRoot
try {
    & cmd.exe /c "npm install --silent --no-audit --no-fund"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "npm install failed (exit code $LASTEXITCODE)."
        Read-Host "Press Enter to exit"
        exit 1
    }
} finally { Pop-Location }
Write-Ok "Dependencies installed"

# 6. Auto-start via Task Scheduler ---------------------------------------------
Write-Step "Setting up auto-start via Task Scheduler..."
$autostartScript = Join-Path $RepoRoot 'scripts\install-autostart-windows.ps1'
if (-not (Test-Path $autostartScript)) {
    Write-Fail "Auto-start script not found at $autostartScript"
    Read-Host "Press Enter to exit"
    exit 1
}
& powershell -ExecutionPolicy Bypass -File $autostartScript
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Auto-start install reported errors. Check the output above."
    Read-Host "Press Enter to exit"
    exit 1
}

# 7. Verify --------------------------------------------------------------------
Write-Step "Waiting for the gateway to come up (up to 30 seconds)..."
$ok = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 2
    try {
        $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3007/health' -TimeoutSec 3 -ErrorAction Stop
        if ($resp.status -eq 'ok') { $ok = $true; break }
    } catch {
        # not ready yet -- keep polling
    }
}

Write-Host ""
if ($ok) {
    Write-Host "===================================================================" -ForegroundColor Green
    Write-Host " Bridge is up and running." -ForegroundColor Green
    Write-Host "===================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Bridge location:  $RepoRoot"
    Write-Host "  Health endpoint:  http://127.0.0.1:3007/health"
    Write-Host "  Auto-start:       Task Scheduler entry 'ChromeAgentBridge'"
    Write-Host ""
    Write-Host "Next steps (one-time, on the Chrome window that just opened):"
    Write-Host "  1. Log into the sites your agent should be able to use"
    Write-Host "     (LinkedIn, Discord, GitHub, internal dashboards, ...)."
    Write-Host "  2. These logins persist across reboots -- they live in the bridge's"
    Write-Host "     dedicated Chrome profile, separate from your everyday browser."
    Write-Host ""
    Write-Host "Your agent on the VPS can now reach the bridge via Tailscale at:"
    Write-Host "  http://<this-PC-tailnet-IP>:3007/health" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Warn "Gateway didn't respond on http://127.0.0.1:3007/health within 30s."
    Write-Warn "The Task Scheduler entry is registered -- try opening a NEW PowerShell"
    Write-Warn "window in ~30 seconds and running:"
    Write-Warn "  Invoke-RestMethod http://127.0.0.1:3007/health"
    Write-Warn ""
    Write-Warn "If still not responding, check the Task Scheduler GUI for task"
    Write-Warn "'ChromeAgentBridge' and its last run result."
}

Write-Host ""
Read-Host "Press Enter to close this window"
