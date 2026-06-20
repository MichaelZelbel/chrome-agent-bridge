<#
.SYNOPSIS
    Register an additional Chrome Agent Bridge agent on Windows.

.DESCRIPTION
    The default setup.bat install gives you one agent on profile
    %LOCALAPPDATA%\ChromeAgentProfile, CDP port 9222, gateway port 3007.
    Use this script to add a second / third / ... agent ALONGSIDE the
    default, each with its own Chrome profile (= its own cookie jar / set
    of logged-in sites), its own CDP port, and its own gateway port.

    What this script generates:
      - scripts\start-agent-<Letter>.bat  (a tiny wrapper that sets the
        CAB_* env vars and calls the canonical start-chrome-agent-bridge.bat)
      - Scheduled Task "ChromeAgentBridge<Letter>" (logon-triggered,
        restart-on-failure, hidden window) pointing at the wrapper
      - Chrome profile dir at %LOCALAPPDATA%\ChromeAgentProfile<Letter>
        (Chrome creates it on first launch)

    Idempotent: re-running with the same -Letter overwrites the wrapper
    and re-registers the task.

    To remove later:
      scripts\uninstall-multi-agent.ps1 -Letter <Letter> -GatewayPort <port>

.PARAMETER Letter
    Short suffix identifying this agent. Used in the profile dir name, task
    name, and wrapper filename. Letters / digits / underscore / hyphen,
    1-16 chars. Examples: B, C, work, personal, demo-2.

.PARAMETER CdpPort
    Chrome's --remote-debugging-port. MUST be free on this PC and different
    from any other agent's CDP port. Default 9223 (the default install owns
    9222).

.PARAMETER GatewayPort
    Port the gateway HTTP server listens on. MUST be free on this PC and
    different from any other agent's gateway port. Default 3008 (the default
    install owns 3007).

.EXAMPLE
    .\scripts\install-multi-agent.ps1 -Letter B
    # Adds Agent B on CDP 9223 / gateway 3008 using profile
    # %LOCALAPPDATA%\ChromeAgentProfileB.

.EXAMPLE
    .\scripts\install-multi-agent.ps1 -Letter C -CdpPort 9224 -GatewayPort 3009
    # Adds Agent C on different ports.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Letter,

    # Default 0 = "pick automatically based on Letter". For a single A-Z letter
    # we offset from the default-install ports (A=9222/3007, B=9223/3008,
    # C=9224/3009, ...) so the user only has to type one letter and gets
    # predictable, non-colliding ports. Non-letter names fall back to fixed
    # defaults; the user can always override explicitly.
    [int]$CdpPort = 0,
    [int]$GatewayPort = 0
)

$ErrorActionPreference = 'Stop'

if ($Letter -notmatch '^[A-Za-z0-9_-]{1,16}$') {
    Write-Error "Letter must be 1-16 characters of [A-Za-z0-9_-]. Got: '$Letter'"
    exit 1
}

if ($CdpPort -le 0) {
    if ($Letter -match '^[A-Za-z]$') {
        $offset = [int][char]([string]$Letter).ToUpper() - [int][char]'A'
        $CdpPort = 9222 + $offset
    } else {
        $CdpPort = 9223
    }
}
if ($GatewayPort -le 0) {
    if ($Letter -match '^[A-Za-z]$') {
        $offset = [int][char]([string]$Letter).ToUpper() - [int][char]'A'
        $GatewayPort = 3007 + $offset
    } else {
        $GatewayPort = 3008
    }
}

# Always operate against the STABLE install, not wherever this script happens
# to live (e.g. a Downloads extract). If a stable install exists and we're not
# already running from it, target its scripts dir so the generated wrapper and
# the scheduled task reference the stable home -- the added agent then survives
# the user deleting the folder they ran this from. Mirrors windows-easy-install.
$ScriptsDir = $PSScriptRoot
$StableScripts = Join-Path $env:LOCALAPPDATA 'Programs\ChromeAgentBridge\scripts'
if ((Test-Path (Join-Path $StableScripts 'start-chrome-agent-bridge.bat')) -and
    ($ScriptsDir.TrimEnd('\') -ine $StableScripts.TrimEnd('\'))) {
    Write-Host "[multi-agent] Using stable install at $(Split-Path $StableScripts -Parent)" -ForegroundColor Cyan
    $ScriptsDir = $StableScripts
}
$WrapperPath = Join-Path $ScriptsDir "start-agent-$Letter.bat"
$ProfileDir = Join-Path $env:LOCALAPPDATA "ChromeAgentProfile$Letter"
$TaskName = "ChromeAgentBridge$Letter"
$CanonicalLauncher = Join-Path $ScriptsDir 'start-chrome-agent-bridge.bat'
$InstallAutostart = Join-Path $ScriptsDir 'install-autostart-windows.ps1'

if (-not (Test-Path $CanonicalLauncher)) {
    Write-Error "Canonical launcher not found at $CanonicalLauncher. Run setup.bat first to install the default agent."
    exit 1
}
if (-not (Test-Path $InstallAutostart)) {
    Write-Error "install-autostart-windows.ps1 not found at $InstallAutostart"
    exit 1
}

# Warn loudly about port collisions BEFORE we register anything -- otherwise
# the task registration succeeds but the gateway fails to bind every time
# it starts, which is a confusing failure mode for end users.
$portInUse = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -in @($CdpPort, $GatewayPort)
if ($portInUse) {
    Write-Warning "One of the requested ports is already in use on this PC:"
    $portInUse | ForEach-Object { Write-Warning ("  port {0} owned by PID {1}" -f $_.LocalPort, $_.OwningProcess) }
    Write-Warning "Continuing anyway -- if this is the default agent on port 3007 / 9222,"
    Write-Warning "pick different ports (-CdpPort / -GatewayPort) for this agent."
}

Write-Host ""
Write-Host "[multi-agent] Registering agent '$Letter':" -ForegroundColor Cyan
Write-Host "[multi-agent]   Profile dir : $ProfileDir"
Write-Host "[multi-agent]   CDP port    : $CdpPort"
Write-Host "[multi-agent]   Gateway port: $GatewayPort"
Write-Host "[multi-agent]   Task name   : $TaskName"
Write-Host "[multi-agent]   Wrapper bat : $WrapperPath"
Write-Host ""

# Generate the wrapper .bat. Single quotes around the here-string so PS
# doesn't try to expand the %VAR% sequences -- cmd.exe will expand them
# at runtime.
$wrapper = @"
@echo off
REM Wrapper for Chrome Agent Bridge agent '$Letter'.
REM Generated by scripts\install-multi-agent.ps1 -- regenerate by re-running
REM that script with the same -Letter argument; don't edit by hand.
set "CAB_PROFILE_DIR=$ProfileDir"
set "CAB_CDP_PORT=$CdpPort"
set "CAB_GATEWAY_PORT=$GatewayPort"
call "%~dp0start-chrome-agent-bridge.bat"
"@

# Set-Content writes CRLF on Windows by default; ASCII encoding keeps the
# .bat plain so cmd.exe parses it the same way as the canonical launcher.
Set-Content -Path $WrapperPath -Value $wrapper -Encoding ASCII
Write-Host "[multi-agent] wrote wrapper: $WrapperPath"

# Hand off to the parameterized autostart installer.
& powershell -NoProfile -ExecutionPolicy Bypass -File $InstallAutostart -TaskName $TaskName -Launcher $WrapperPath
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to register scheduled task. See output above."
    exit 1
}

Write-Host ""
Write-Host "[multi-agent] Agent '$Letter' registered." -ForegroundColor Green
Write-Host ""
Write-Host "  Log into the per-agent sites in the Chrome window that just opened --"
Write-Host "  those logins persist in $ProfileDir."
Write-Host ""
Write-Host "  Point this agent at the bridge URL:" -ForegroundColor Yellow
Write-Host "    http://<this-PC-tailnet-IP>:$GatewayPort"
Write-Host ""
Write-Host "  Per-port log: $env:LOCALAPPDATA\ChromeAgentBridge\gateway-$GatewayPort.log"
Write-Host ""
Write-Host "  To remove this agent:"
Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\uninstall-multi-agent.ps1 -Letter $Letter -GatewayPort $GatewayPort"
