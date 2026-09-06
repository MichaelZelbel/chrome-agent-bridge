# Install the Planino waker as a Task Scheduler entry that runs at logon (Windows).
# Run once from this folder after writing poster.env:
#   powershell -ExecutionPolicy Bypass -File install-waker-windows.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'node not found on PATH'; exit 1 }
if (-not (Test-Path (Join-Path $here 'poster.env'))) { Write-Error "write $here\poster.env first (see poster.env.example)"; exit 1 }

$taskName = 'PlaninoWaker'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $here 'wake.js') + '"') -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -Hidden
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Planino waker: starts your AI when a browser post is due' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "[install] task $taskName registered and started. It runs at every logon and restarts on failure."
