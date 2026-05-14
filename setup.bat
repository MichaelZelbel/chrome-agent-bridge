@echo off
REM ============================================================================
REM Chrome Agent Bridge — Windows double-click installer
REM
REM Wraps scripts\windows-easy-install.ps1 so the user can just double-click
REM this file in Explorer instead of right-clicking the .ps1 and choosing
REM "Run with PowerShell" (which is a common stumbling block).
REM
REM Forwards exit code; keeps the window open at the end so the user sees
REM the result.
REM ============================================================================

setlocal

REM Switch to the directory this .bat lives in so PowerShell finds the script
REM regardless of where the user double-clicked from.
cd /d "%~dp0"

echo.
echo Launching Chrome Agent Bridge installer...
echo If Windows asks "Do you want to allow this app to make changes?" — click Yes.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-easy-install.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
    echo Installer exited with code %EXITCODE%.
    echo See messages above for details.
)

REM Keep window open if launched by double-click; harmless if run from a shell.
pause
exit /b %EXITCODE%
