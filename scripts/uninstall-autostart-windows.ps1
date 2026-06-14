# =============================================================================
# Chrome Agent Bridge — Windows auto-start uninstall
#
# Removes the scheduled task and stops any running gateway / Chrome processes
# launched for it. Mirror of install-autostart-windows.ps1; the same -TaskName
# you used to install is the one to pass here.
#
# For a multi-agent uninstall, prefer the higher-level wrapper:
#
#   scripts\uninstall-multi-agent.ps1 -Letter B
# =============================================================================

[CmdletBinding()]
param(
    [string]$TaskName = 'ChromeAgentBridge',

    # Chrome user-data-dir to clean Chrome processes for. Defaults to the
    # default install's profile. Multi-agent uninstall passes the
    # ChromeAgentProfile<Letter> path so we only stop THAT agent's Chrome.
    [string]$ProfileDir = '',

    # Gateway port. Used to identify the right node process to stop in a
    # multi-agent setup where several `node gateway/index.js` processes run
    # at once. Defaults to the default install's 3007.
    [int]$GatewayPort = 3007
)

$ErrorActionPreference = 'Continue'

if (-not $ProfileDir) {
    $ProfileDir = Join-Path $env:LOCALAPPDATA 'ChromeAgentProfile'
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[uninstall] removed scheduled task '$TaskName'"
} else {
    Write-Host "[uninstall] task '$TaskName' was not registered — nothing to remove"
}

# Stop the gateway node process bound to this task's port (most reliable
# way to identify the right one when several gateways run at once).
$listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object LocalPort -eq $GatewayPort |
    Select-Object -First 1
if ($listener) {
    $gwPid = $listener.OwningProcess
    try {
        $proc = Get-Process -Id $gwPid -ErrorAction Stop
        if ($proc.ProcessName -eq 'node') {
            Stop-Process -Id $gwPid -Force -ErrorAction SilentlyContinue
            Write-Host "[uninstall] stopped gateway node on port $GatewayPort (PID $gwPid)"
        }
    } catch {}
}

# Stop Chrome instances using THIS task's profile dir (best-effort -- the
# user-data-dir flag is on the parent chrome.exe command line, which CIM
# exposes consistently).
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$ProfileDir*" } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[uninstall] stopped Chrome process for profile (PID $($_.ProcessId))"
    }

Write-Host "[uninstall] done. Profile data preserved at: $ProfileDir"
Write-Host "            (delete it manually if you want to forget cookies/logins)"
