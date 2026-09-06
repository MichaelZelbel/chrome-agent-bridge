@echo off
rem Runner for Windows: headless Claude Code, once, for one Planino job.
rem Same contract as claude.sh; needs Git Bash (ships with Git for Windows).
setlocal
set "HERE=%~dp0"
if exist "%ProgramFiles%\Git\bin\bash.exe" (
  "%ProgramFiles%\Git\bin\bash.exe" "%HERE%claude.sh" %*
) else (
  bash "%HERE%claude.sh" %*
)
endlocal
