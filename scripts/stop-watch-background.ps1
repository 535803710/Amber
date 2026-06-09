# Stop background watch:all
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PidFile = Join-Path $Root ".local\watch-all.pid"

if (-not (Test-Path $PidFile)) {
    Write-Host "watch:all not running (no pid file)"
    exit 0
}

$pidValue = [int](Get-Content -Path $PidFile -ErrorAction SilentlyContinue)
if ($pidValue -le 0) {
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "invalid pid file, cleaned up"
    exit 0
}

$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "process not found (pid=$pidValue), cleaned up"
    exit 0
}

taskkill /PID $pidValue /T /F | Out-Null
Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "watch:all stopped (pid=$pidValue)"
