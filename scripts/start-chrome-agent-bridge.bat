@echo off
REM ===========================================================
REM  Chrome Agent Bridge - Windows launcher
REM
REM  Starts Chrome with remote debugging bound to 127.0.0.1
REM  using a dedicated user-data-dir, then starts the gateway.
REM
REM  Chrome remote debugging is NEVER exposed to the network.
REM  Only the gateway (default port 3007) is reachable from
REM  your private network (e.g. Tailscale).
REM ===========================================================

setlocal

REM --- Locate Chrome --------------------------------------------------------
set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_EXE (
    echo [ERROR] Could not find chrome.exe in Program Files.
    echo Install Google Chrome or edit this script with your Chrome path.
    pause
    exit /b 1
)

REM --- Configuration --------------------------------------------------------
REM Dedicated profile, kept separate from your daily browsing profile.
set "USER_DATA_DIR=%LOCALAPPDATA%\ChromeAgentProfile"

REM CDP must stay bound to 127.0.0.1 — never expose this to the network.
set "CDP_PORT=9222"
set "CDP_ADDRESS=127.0.0.1"

REM --- Start Chrome ---------------------------------------------------------
echo Starting Chrome with remote debugging on %CDP_ADDRESS%:%CDP_PORT%
echo Profile: %USER_DATA_DIR%
start "" "%CHROME_EXE%" ^
    --remote-debugging-port=%CDP_PORT% ^
    --remote-debugging-address=%CDP_ADDRESS% ^
    --user-data-dir="%USER_DATA_DIR%"

REM Give Chrome a moment to initialize the debugging endpoint.
timeout /t 5 /nobreak >nul

REM --- Start the gateway ----------------------------------------------------
REM Gateway stdout/stderr goes to a log file. Under Task Scheduler with the
REM hidden-window setup, an un-redirected node process discards all output,
REM which makes diagnosing intermittent timeouts impossible -- you can see the
REM gateway is "up" but have no record of what requests it received or why
REM Playwright failed. The log lives at %LOCALAPPDATA%\ChromeAgentBridge\
REM gateway.log; tail it when an agent reports the bridge as unreliable.
set "LOG_DIR=%LOCALAPPDATA%\ChromeAgentBridge"
set "LOG_FILE=%LOG_DIR%\gateway.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo ==== gateway start %DATE% %TIME% ==== >> "%LOG_FILE%"

echo Starting Chrome Agent Bridge gateway...
cd /d "%~dp0..\gateway"
node index.js >> "%LOG_FILE%" 2>&1

endlocal
