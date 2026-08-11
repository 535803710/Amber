@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Amber 需要 Node.js 22 或更高版本。
  echo 请安装 Node.js 后重新双击 install.bat。
  echo.
  pause
  exit /b 1
)

node scripts\team-setup.mjs install
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo 安装检查未全部通过，请根据上面的 FAIL 提示处理。
pause
exit /b %RESULT%
