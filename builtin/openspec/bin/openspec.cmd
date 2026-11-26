@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
set "OPENSPEC_TELEMETRY=0"
set "OPENSPEC_NODE_FLAGS="
if "%SUPER_CODE_OPENSPEC_PRESERVE_LINKS%"=="1" set "OPENSPEC_NODE_FLAGS=--preserve-symlinks --preserve-symlinks-main"
"%SUPER_CODE_OPENSPEC_NODE%" %OPENSPEC_NODE_FLAGS% "%SUPER_CODE_OPENSPEC_CLI%" %*
exit /b %errorlevel%
