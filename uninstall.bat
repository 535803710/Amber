@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，无法安全移除 Cursor 和 Codex 中的 Amber 配置。
  echo.
  pause
  exit /b 1
)

node scripts\team-setup.mjs uninstall --target "%~dp0."
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
