@echo off
REM ============================================================================
REM Chrome Agent Bridge -- add another agent (double-click this file)
REM
REM Adds a second / third / ... agent alongside your default install.
REM Each agent has its own Chrome profile (own cookies, own logins), its own
REM gateway port your AI can reach, and starts automatically at every Windows
REM logon.
REM
REM You only need to type one letter (B for your 2nd agent, C for your 3rd, ...).
REM That's it.
REM
REM To remove an agent again: double-click remove-agent.bat .
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo  Chrome Agent Bridge -- add another agent
echo ============================================================
echo.
echo Your default agent uses gateway port 3007. This adds a new
echo agent with its OWN empty Chrome profile and its OWN port.
echo.
echo Pick a letter -- it determines the port automatically:
echo   B   second agent,  gateway port 3008
echo   C   third agent,   gateway port 3009
echo   D   fourth agent,  gateway port 3010   (and so on)
echo.

if "%~1"=="" (
    set /p "AGENT_LETTER=Letter (just press Enter for B): "
) else (
    set "AGENT_LETTER=%~1"
)

if "%AGENT_LETTER%"=="" set "AGENT_LETTER=B"

echo.
echo Adding agent "%AGENT_LETTER%"...
echo If Windows asks "Do you want to allow this app to make changes?" -- click Yes.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-multi-agent.ps1" -Letter "%AGENT_LETTER%"
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
    echo ----------------------------------------
    echo Something went wrong -- see messages above.
    echo ----------------------------------------
) else (
    echo ============================================================
    echo  Done. Agent "%AGENT_LETTER%" is now running.
    echo ============================================================
    echo.
    echo A new Chrome window should have opened. It is EMPTY -- no
    echo cookies, no logins. Sign into the sites you want this agent
    echo to use; those logins persist across reboots.
    echo.
    echo Your AI agent reaches it at:
    echo   http://your-PC-tailnet-IP:^(see message above^)
    echo.
)

echo.
pause
exit /b %EXITCODE%
