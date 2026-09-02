@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

set "NODE_EXE="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\resolve-node.ps1" 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo Amber 需要 Node.js 22 或更高版本。
  echo 已检查 PATH、标准安装目录和 Codex Runtime。
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" scripts\team-setup.mjs install
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo 安装检查未全部通过，请根据上面的 FAIL 提示处理。
pause
exit /b %RESULT%
