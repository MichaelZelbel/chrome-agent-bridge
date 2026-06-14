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
REM
REM  Multi-agent: override these env vars before calling this
REM  script (or set them in a small wrapper .bat -- see
REM  scripts\install-multi-agent.ps1):
REM    CAB_PROFILE_DIR    Chrome user-data-dir   (default: %LOCALAPPDATA%\ChromeAgentProfile)
REM    CAB_CDP_PORT       Chrome CDP port        (default: 9222)
REM    CAB_CDP_ADDRESS    Chrome CDP bind addr   (default: 127.0.0.1)
REM    CAB_GATEWAY_PORT   Gateway listen port    (default: 3007)
REM    CAB_GATEWAY_HOST   Gateway bind addr      (default: 0.0.0.0)
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

REM --- Configuration (env-var overrides + defaults) -------------------------
if not defined CAB_PROFILE_DIR  set "CAB_PROFILE_DIR=%LOCALAPPDATA%\ChromeAgentProfile"
if not defined CAB_CDP_PORT     set "CAB_CDP_PORT=9222"
if not defined CAB_CDP_ADDRESS  set "CAB_CDP_ADDRESS=127.0.0.1"
if not defined CAB_GATEWAY_PORT set "CAB_GATEWAY_PORT=3007"
if not defined CAB_GATEWAY_HOST set "CAB_GATEWAY_HOST=0.0.0.0"

REM Translate CAB_* knobs into the env-var contract that gateway/index.js
REM reads directly (HOST / PORT / CDP_URL). Doing the translation here keeps
REM the gateway code provider-agnostic and means the launcher is the single
REM place that knows the launcher-side knobs.
set "HOST=%CAB_GATEWAY_HOST%"
set "PORT=%CAB_GATEWAY_PORT%"
set "CDP_URL=http://%CAB_CDP_ADDRESS%:%CAB_CDP_PORT%"

REM --- Start Chrome ---------------------------------------------------------
echo Starting Chrome with remote debugging on %CAB_CDP_ADDRESS%:%CAB_CDP_PORT%
echo Profile: %CAB_PROFILE_DIR%
start "" "%CHROME_EXE%" ^
    --remote-debugging-port=%CAB_CDP_PORT% ^
    --remote-debugging-address=%CAB_CDP_ADDRESS% ^
    --user-data-dir="%CAB_PROFILE_DIR%"

REM Give Chrome a moment to initialize the debugging endpoint.
timeout /t 5 /nobreak >nul

REM --- Start the gateway ----------------------------------------------------
REM Gateway stdout/stderr goes to a per-port log file. Under Task Scheduler
REM with the hidden-window setup, an un-redirected node process discards all
REM output, which makes diagnosing intermittent timeouts impossible. The
REM port suffix keeps multi-agent logs from interleaving. Tail it when an
REM agent reports the bridge as unreliable:
REM   Get-Content -Tail 20 -Wait %LOCALAPPDATA%\ChromeAgentBridge\gateway-<port>.log
set "LOG_DIR=%LOCALAPPDATA%\ChromeAgentBridge"
set "LOG_FILE=%LOG_DIR%\gateway-%PORT%.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
echo ==== gateway start %DATE% %TIME% (port %PORT%) ==== >> "%LOG_FILE%"

echo Starting Chrome Agent Bridge gateway on %HOST%:%PORT% (CDP %CDP_URL%)...
cd /d "%~dp0..\gateway"
node index.js >> "%LOG_FILE%" 2>&1

endlocal
