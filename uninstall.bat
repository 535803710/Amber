@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "NODE_EXE="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\resolve-node.ps1" 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo 未找到 Node.js，无法安全移除 Cursor 和 Codex 中的 Amber 配置。
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" scripts\team-setup.mjs uninstall --target "%~dp0."
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
