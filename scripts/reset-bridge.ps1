# =============================================================================
# Chrome Agent Bridge -- Reset (Windows)
#
# Wipes the bridge install completely so the machine looks like a fresh
# system to the easy-installer. Designed to be invoked via:
#
#   irm https://raw.githubusercontent.com/MichaelZelbel/chrome-agent-bridge/main/scripts/reset-bridge.ps1 | iex
#
# What this undoes:
#   1. Stops + unregisters the Task Scheduler entry 'ChromeAgentBridge'
#   2. Kills anything listening on bridge ports 3007 + 3008 (covers
#      old + new + custom-port installs in one go)
#   3. Kills any orphan node.exe / chrome.exe processes referencing the
#      bridge gateway or the dedicated Chrome profile
#   4. Removes the default bridge folder at %USERPROFILE%\chrome-agent-bridge
#   5. Asks (with default = NO) whether to also wipe the dedicated Chrome
#      profile at %LOCALAPPDATA%\ChromeAgentProfile -- saying yes forgets
#      all logged-in sessions (LinkedIn, Discord, etc) which is what you
#      want for a true "fresh PC" simulation
#   6. Prints a verify block at the end
#
# Safe to run twice (idempotent).
# Does NOT need administrator rights.
# Does NOT touch Tailscale, Node.js, Chrome, or anything outside the bridge.
# =============================================================================

$ErrorActionPreference = 'Continue'

function W-Step { param($m) Write-Host "[reset] $m" -ForegroundColor Cyan }
function W-Ok   { param($m) Write-Host "[ ok  ] $m" -ForegroundColor Green }
function W-Warn { param($m) Write-Host "[warn ] $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host " Chrome Agent Bridge -- Reset" -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Task Scheduler entry --------------------------------------------------
W-Step "Removing Task Scheduler entry..."
$task = Get-ScheduledTask -TaskName 'ChromeAgentBridge' -ErrorAction SilentlyContinue
if ($task) {
    $task | Stop-ScheduledTask -ErrorAction SilentlyContinue
    $task | Unregister-ScheduledTask -Confirm:$false
    W-Ok "ChromeAgentBridge task unregistered"
} else {
    W-Ok "No task to remove"
}

# 2. Kill listeners on bridge ports ----------------------------------------
W-Step "Killing processes on bridge ports (3007, 3008)..."
$killed = 0
foreach ($port in 3007, 3008) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        try {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
            W-Ok "killed PID $($c.OwningProcess) on :$port"
            $killed++
        } catch {
            W-Warn "could not kill PID $($c.OwningProcess): $($_.Exception.Message)"
        }
    }
}
if ($killed -eq 0) { W-Ok "Nothing was listening on 3007/3008" }

# 3. Stop any orphan bridge processes by command-line match ----------------
# (Best-effort -- CommandLine is sometimes empty for processes owned by
# another user; the port-based kill above is the reliable path.)
W-Step "Sweeping for stray bridge processes..."
$swept = 0
$profilePath = Join-Path $env:LOCALAPPDATA 'ChromeAgentProfile'
try {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        if (-not $p.CommandLine) { continue }
        if ($p.CommandLine -match 'chrome-agent-bridge' -or
            $p.CommandLine -like "*$profilePath*") {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                W-Ok "killed $($p.Name) PID $($p.ProcessId)"
                $swept++
            } catch {
                # process already gone or protected
            }
        }
    }
} catch {
    W-Warn "process sweep skipped: $($_.Exception.Message)"
}
if ($swept -eq 0) { W-Ok "No stray bridge processes" }

# 4. Remove default bridge folder ------------------------------------------
W-Step "Removing default bridge folder..."
$defaultRoot = Join-Path $env:USERPROFILE 'chrome-agent-bridge'
if (Test-Path $defaultRoot) {
    try {
        Remove-Item $defaultRoot -Recurse -Force -ErrorAction Stop
        W-Ok "removed $defaultRoot"
    } catch {
        W-Warn "could not fully remove $defaultRoot -- some files may be in use."
        W-Warn "Try closing all related Explorer/Terminal windows and re-running."
    }
} else {
    W-Ok "no folder at $defaultRoot"
}

# 5. Optional: wipe Chrome profile -----------------------------------------
$profilePath = Join-Path $env:LOCALAPPDATA 'ChromeAgentProfile'
if (Test-Path $profilePath) {
    Write-Host ""
    Write-Host "  Dedicated Chrome profile found at:" -ForegroundColor Yellow
    Write-Host "    $profilePath" -ForegroundColor Yellow
    Write-Host "  Deleting it wipes ALL logged-in sessions in the bridge Chrome"
    Write-Host "  (LinkedIn, Discord, internal tools, banking -- everything)."
    Write-Host "  Choose YES only if you want a true 'fresh PC' simulation."
    $reply = Read-Host "  Delete the profile? (y/N)"
    if ($reply -eq 'y' -or $reply -eq 'Y') {
        try {
            Remove-Item $profilePath -Recurse -Force -ErrorAction Stop
            W-Ok "wiped Chrome profile at $profilePath"
        } catch {
            W-Warn "could not fully delete $profilePath -- close all Chrome windows and re-run."
        }
    } else {
        W-Ok "kept profile (your logins persist)"
    }
} else {
    W-Ok "no profile to consider"
}

# 6. Verify ----------------------------------------------------------------
Write-Host ""
Write-Host "--- Verify ---" -ForegroundColor Cyan
$verify_ok = $true

$task = Get-ScheduledTask -TaskName 'ChromeAgentBridge' -ErrorAction SilentlyContinue
if ($task) { Write-Host "  [FAIL] Task 'ChromeAgentBridge' still registered" -ForegroundColor Red; $verify_ok = $false }
else       { Write-Host "  [ ok ] Task removed" -ForegroundColor Green }

if (Test-Path $defaultRoot) { Write-Host "  [FAIL] Folder still exists: $defaultRoot" -ForegroundColor Red; $verify_ok = $false }
else                        { Write-Host "  [ ok ] Bridge folder gone" -ForegroundColor Green }

foreach ($port in 3007, 3008) {
    $still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($still) { Write-Host "  [FAIL] Port $port still listening" -ForegroundColor Red; $verify_ok = $false }
    else        { Write-Host "  [ ok ] Port $port free" -ForegroundColor Green }
}

Write-Host ""
if ($verify_ok) {
    Write-Host "Reset complete. Machine is ready for a fresh setup.bat install." -ForegroundColor Green
} else {
    Write-Host "Reset finished but some items remain -- see [FAIL] lines above." -ForegroundColor Yellow
}
Write-Host ""
