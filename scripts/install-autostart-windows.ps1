# =============================================================================
# Chrome Agent Bridge — Windows auto-start install (Task Scheduler)
#
# Sets up the bridge to auto-start when the user logs in, and to auto-restart
# if it fails. Run once on the laptop in PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1
#
# For a second / third / ... agent, prefer the higher-level wrapper:
#
#   scripts\install-multi-agent.ps1 -Letter B
#
# which generates the agent's wrapper .bat and calls this script with the
# right -TaskName / -Launcher arguments. The bare params here exist so the
# wrapper can compose them, and so power users can register custom tasks
# without going through the multi-agent helper.
#
# Supports Windows 10 and 11.
# =============================================================================

[CmdletBinding()]
param(
    # Scheduled Task name. Must be unique on this PC. Keep the "ChromeAgentBridge"
    # prefix so the uninstall scripts and Task Scheduler view group cleanly.
    [string]$TaskName = 'ChromeAgentBridge',

    # Absolute path to the launcher .bat to register. Defaults to the canonical
    # start-chrome-agent-bridge.bat next to this script. install-multi-agent.ps1
    # points this at a per-agent wrapper that sets CAB_* env vars and calls
    # the canonical launcher.
    [string]$Launcher = ''
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path

if (-not $Launcher) {
    $Launcher = Join-Path $RepoRoot 'scripts\start-chrome-agent-bridge.bat'
}

if (-not (Test-Path $Launcher)) {
    Write-Error "Launcher not found at $Launcher"
    exit 1
}

# Resolve to absolute path so Task Scheduler stores something portable.
$Launcher = (Resolve-Path $Launcher).Path

$TaskAuthor = 'chrome-agent-bridge'

# Detect supported Windows version (10+)
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
if ($build -lt 10240) {
    Write-Error "This installer requires Windows 10 (build 10240) or newer. Detected build: $build"
    exit 1
}

Write-Host "[install] Windows $($os.Caption), build $build"
Write-Host "[install] Task name: $TaskName"
Write-Host "[install] Launcher:  $Launcher"

# Remove existing task with this name if present (idempotent)
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
    -Description "Chrome Agent Bridge — gateway + Chrome with remote debugging. Auto-starts on user logon. Launcher: $Launcher"

Write-Host "[install] registered scheduled task '$TaskName'"

# Start it immediately so the customer can verify the install worked
try {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[install] task started — give Chrome ~10 seconds to come up, then check the gateway port."
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
To uninstall: powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart-windows.ps1 -TaskName $TaskName

"@ | Write-Host
