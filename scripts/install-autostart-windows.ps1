# =============================================================================
# Chrome Agent Bridge — Windows auto-start install (Task Scheduler)
#
# Sets up the bridge to auto-start when the user logs in, and to auto-restart
# if it fails. Run once on the laptop in PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1
#
# Supports Windows 10 and 11.
# =============================================================================

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path "$PSScriptRoot\..").Path
$Launcher   = Join-Path $RepoRoot 'scripts\start-chrome-agent-bridge.bat'
$TaskName   = 'ChromeAgentBridge'
$TaskAuthor = 'chrome-agent-bridge'

if (-not (Test-Path $Launcher)) {
    Write-Error "Launcher not found at $Launcher"
    exit 1
}

# Detect supported Windows version (10+)
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
if ($build -lt 10240) {
    Write-Error "This installer requires Windows 10 (build 10240) or newer. Detected build: $build"
    exit 1
}

Write-Host "[install] Windows $($os.Caption), build $build"
Write-Host "[install] Launcher: $Launcher"

# Remove existing task if present (idempotent)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "[install] removing existing task '$TaskName' so we can re-register cleanly"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Build the action: run the launcher
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Launcher`""

# Trigger: at user logon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Settings: restart on failure, allow run on battery, hidden window
$settings = New-ScheduledTaskSettingsSet `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 3 `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden

# Run as the current interactive user
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Chrome Agent Bridge — gateway + Chrome with remote debugging. Auto-starts on user logon.'

Write-Host "[install] registered scheduled task '$TaskName'"

# Start it immediately so the customer can verify the install worked
try {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[install] task started — give Chrome ~10 seconds to come up, then check:"
    Write-Host "            curl http://127.0.0.1:3007/health"
} catch {
    Write-Warning "[install] couldn't start task immediately: $_"
    Write-Host "          It will run on next logon regardless."
}

@"

Installed. Auto-start active:
  Task name: $TaskName
  Launcher:  $Launcher
  Trigger:   At user logon
  Restart:   3 attempts, 1 minute apart, on failure

To inspect:  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
To start:    Start-ScheduledTask -TaskName $TaskName
To stop:     Stop-ScheduledTask  -TaskName $TaskName
To uninstall: powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart-windows.ps1

"@ | Write-Host
