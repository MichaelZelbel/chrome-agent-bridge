<#
.SYNOPSIS
    Remove an additional Chrome Agent Bridge agent registered by
    install-multi-agent.ps1.

.DESCRIPTION
    Reverses install-multi-agent.ps1 for a given -Letter:
      - Stops + unregisters Scheduled Task "ChromeAgentBridge<Letter>"
      - Stops the gateway node process bound to -GatewayPort (best-effort)
      - Stops any Chrome process attached to %LOCALAPPDATA%\ChromeAgentProfile<Letter>
      - Deletes scripts\start-agent-<Letter>.bat

    The Chrome profile data is PRESERVED on disk (the logged-in sessions
    aren't lost by mistake). Delete it manually if you want to:
      Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ChromeAgentProfile<Letter>"

.PARAMETER Letter
    The same -Letter you passed to install-multi-agent.ps1.

.PARAMETER GatewayPort
    The same -GatewayPort you passed (so we can stop the right node process).
    Defaults to 3008 to match install-multi-agent.ps1's default.

.EXAMPLE
    .\scripts\uninstall-multi-agent.ps1 -Letter B
    # Removes Agent B (gateway 3008).

.EXAMPLE
    .\scripts\uninstall-multi-agent.ps1 -Letter C -GatewayPort 3009
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$Letter,

    [int]$GatewayPort = 3008
)

$ErrorActionPreference = 'Continue'

$ScriptsDir = $PSScriptRoot
$WrapperPath = Join-Path $ScriptsDir "start-agent-$Letter.bat"
$ProfileDir = Join-Path $env:LOCALAPPDATA "ChromeAgentProfile$Letter"
$TaskName = "ChromeAgentBridge$Letter"
$UninstallAutostart = Join-Path $ScriptsDir 'uninstall-autostart-windows.ps1'

Write-Host ""
Write-Host "[multi-agent] Removing agent '$Letter':" -ForegroundColor Cyan
Write-Host "[multi-agent]   Task name   : $TaskName"
Write-Host "[multi-agent]   Gateway port: $GatewayPort"
Write-Host "[multi-agent]   Profile dir : $ProfileDir (will be PRESERVED)"
Write-Host "[multi-agent]   Wrapper bat : $WrapperPath"
Write-Host ""

if (Test-Path $UninstallAutostart) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $UninstallAutostart `
        -TaskName $TaskName -ProfileDir $ProfileDir -GatewayPort $GatewayPort
} else {
    Write-Warning "$UninstallAutostart not found -- skipping task removal. Remove the task manually with: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
}

if (Test-Path $WrapperPath) {
    Remove-Item $WrapperPath -Force
    Write-Host "[multi-agent] removed wrapper: $WrapperPath"
} else {
    Write-Host "[multi-agent] wrapper $WrapperPath not present -- nothing to remove"
}

Write-Host ""
Write-Host "[multi-agent] Agent '$Letter' removed. Profile data preserved at:"
Write-Host "  $ProfileDir"
Write-Host ""
