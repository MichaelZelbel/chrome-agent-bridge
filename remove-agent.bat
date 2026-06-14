@echo off
REM ============================================================================
REM Chrome Agent Bridge -- remove an agent (double-click this file)
REM
REM Removes an extra agent you added with add-agent.bat .
REM Type the letter (B, C, D, ...) of the agent you want to remove.
REM
REM Your default agent (the one you set up with setup.bat, gateway port 3007)
REM is NEVER touched by this script. To uninstall the default agent, use
REM scripts\uninstall-autostart-windows.ps1 .
REM
REM The Chrome profile (with its saved logins) is KEPT on disk -- if you
REM change your mind later and re-add the same letter, your logins are
REM still there. To really delete the logins, remove the profile folder
REM by hand (it's at %LOCALAPPDATA%\ChromeAgentProfile<Letter>).
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo  Chrome Agent Bridge -- remove an agent
echo ============================================================
echo.

if "%~1"=="" (
    set /p "AGENT_LETTER=Letter of the agent to remove (e.g. B): "
) else (
    set "AGENT_LETTER=%~1"
)

if "%AGENT_LETTER%"=="" (
    echo No letter given -- nothing to do.
    echo.
    pause
    exit /b 0
)

echo.
echo Removing agent "%AGENT_LETTER%"...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall-multi-agent.ps1" -Letter "%AGENT_LETTER%"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
    echo ----------------------------------------
    echo Something went wrong -- see messages above.
    echo ----------------------------------------
) else (
    echo ============================================================
    echo  Done. Agent "%AGENT_LETTER%" is removed.
    echo ============================================================
)

echo.
pause
exit /b %EXITCODE%
