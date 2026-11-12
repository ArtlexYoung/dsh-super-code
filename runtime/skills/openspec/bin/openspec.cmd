@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
set "OPENSPEC_TELEMETRY=0"
"%SUPER_CODE_OPENSPEC_NODE%" "%SUPER_CODE_OPENSPEC_CLI%" %*
exit /b %errorlevel%
