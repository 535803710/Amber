@echo off
setlocal EnableExtensions

chcp 65001 >nul 2>nul

set "ROOT=%~dp0"
set "PORT=%AMBER_DASHBOARD_PORT%"
if "%PORT%"=="" set "PORT=3847"
set "URL=http://127.0.0.1:%PORT%"
set "NODE_EXE="

pushd "%ROOT%" >nul 2>nul
if errorlevel 1 (
  echo Failed to enter project directory: %ROOT%
  exit /b 1
)

call :find_node
if errorlevel 1 goto end

if "%~1"=="" goto menu
set "CLI_MODE=1"
goto dispatch

:menu
cls
echo.
echo  Amber control
echo  ----------------------------------------
echo  [1] Open browser dashboard
echo  [2] Start background watch:all
echo  [3] Stop background watch:all
echo  [4] Send test notification
echo  [5] Edit .env.local
echo  [6] Show status
echo  [0] Exit
echo.
choice /c 1234560 /n /m "Select> "
if errorlevel 7 goto end
if errorlevel 6 goto action_status
if errorlevel 5 goto action_edit_config
if errorlevel 4 goto action_test
if errorlevel 3 goto action_stop
if errorlevel 2 goto action_start
if errorlevel 1 goto action_open
goto menu

:dispatch
set "ACTION=%~1"
if /i "%ACTION%"=="open" goto action_open
if /i "%ACTION%"=="dashboard" goto action_open
if /i "%ACTION%"=="config" goto action_open
if /i "%ACTION%"=="start" goto action_start
if /i "%ACTION%"=="stop" goto action_stop
if /i "%ACTION%"=="test" goto action_test
if /i "%ACTION%"=="edit" goto action_edit_config
if /i "%ACTION%"=="status" goto action_status
if /i "%ACTION%"=="doctor" goto action_doctor
if /i "%ACTION%"=="help" goto help
if /i "%ACTION%"=="--help" goto help
if /i "%ACTION%"=="-h" goto help
echo Unknown command: %ACTION%
echo.
goto help

:action_open
call :ensure_dashboard
if errorlevel 1 goto after_action
echo Opening %URL%
start "" "%URL%"
goto after_action

:action_start
set "RUNTIME_PROFILE=core"
if /i "%~2"=="--full" set "RUNTIME_PROFILE=full"
echo Starting Amber %RUNTIME_PROFILE% runtime in background...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-watch-background.ps1" -Profile "%RUNTIME_PROFILE%"
goto after_action

:action_stop
echo Stopping watch:all...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-watch-background.ps1"
goto after_action

:action_test
echo Sending test notification...
"%NODE_EXE%" "scripts\status.mjs" test "BAT test notification" --force
goto after_action

:action_edit_config
if not exist ".env.local" type nul > ".env.local"
echo Opening .env.local
start "" notepad ".env.local"
goto after_action

:action_status
echo Dashboard:
call :dashboard_ready
if errorlevel 1 (
  echo   stopped
) else (
  echo   running - %URL%
)
echo.
echo Background watcher:
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.local\watch-all.pid'; if (Test-Path $p) { $id=[int](Get-Content $p -ErrorAction SilentlyContinue); $proc=Get-Process -Id $id -ErrorAction SilentlyContinue; if ($proc) { Write-Host ('  watch:all running - pid=' + $id) } else { Write-Host ('  watch:all stale pid - ' + $id) } } else { Write-Host '  watch:all stopped' }"
echo.
echo Last task status:
"%NODE_EXE%" "scripts\check-status.mjs"
goto after_action

:action_doctor
"%NODE_EXE%" "scripts\team-setup.mjs" doctor --target "%ROOT%." %2 %3 %4 %5 %6 %7 %8 %9
goto after_action

:help
echo Usage:
echo   amber.bat
echo   amber.bat open       Open dashboard and browser config
echo   amber.bat start      Start core collection in background
echo   amber.bat start --full  Include Windows toast and UI prompt listeners
echo   amber.bat stop       Stop watch:all
echo   amber.bat test       Send a test notification
echo   amber.bat edit       Edit .env.local
echo   amber.bat status     Print dashboard, watcher and last status
echo   amber.bat doctor     Check team integrations and Feishu access
echo   amber.bat doctor --json  Print a redacted diagnostic report
echo.
echo Env:
echo   AMBER_DASHBOARD_PORT Override dashboard port, default 3847
goto after_action

:after_action
set "ACTION_CODE=%ERRORLEVEL%"
if defined CLI_MODE exit /b %ACTION_CODE%
echo.
pause
goto menu

:find_node
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\resolve-node.ps1" 2^>nul`) do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE (
  echo Node.js 22 or later was not found in PATH, standard install locations, or Codex Runtime.
  exit /b 1
)
exit /b 0

:ensure_dashboard
call :dashboard_ready
if not errorlevel 1 exit /b 0
echo Starting dashboard service on %URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%NODE_EXE%' -ArgumentList @('scripts/dashboard-server.mjs','--port','%PORT%') -WorkingDirectory '%CD%' -WindowStyle Hidden"
call :wait_dashboard
exit /b %ERRORLEVEL%

:dashboard_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%URL%/api/state' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; exit 1" >nul 2>nul
exit /b %ERRORLEVEL%

:wait_dashboard
for /l %%I in (1,1,20) do (
  call :dashboard_ready
  if not errorlevel 1 exit /b 0
  powershell -NoProfile -Command "Start-Sleep -Milliseconds 500" >nul 2>nul
)
echo Dashboard service did not respond: %URL%
exit /b 1

:end
popd >nul 2>nul
endlocal
exit /b 0
