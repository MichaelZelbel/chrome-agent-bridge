# =============================================================================
# Chrome Agent Bridge — Windows auto-start uninstall
#
# Removes the scheduled task and stops any running gateway/Chrome processes
# launched via the bridge.
# =============================================================================

$ErrorActionPreference = 'Continue'

$TaskName = 'ChromeAgentBridge'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[uninstall] removed scheduled task '$TaskName'"
} else {
    Write-Host "[uninstall] task '$TaskName' was not registered — nothing to remove"
}

# Stop any running gateway processes (best-effort)
Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and ($_.CommandLine -like '*gateway/index.js*' -or $_.CommandLine -like '*gateway\index.js*')
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[uninstall] stopped gateway process (PID $($_.Id))"
}

# Stop Chrome instances using the dedicated profile
$profilePath = Join-Path $env:LOCALAPPDATA 'ChromeAgentProfile'
Get-Process -Name 'chrome' -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*$profilePath*"
} | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[uninstall] stopped Chrome process (PID $($_.Id))"
}

Write-Host "[uninstall] done. Profile data preserved at: $profilePath"
Write-Host "            (delete it manually if you want to forget cookies/logins)"
