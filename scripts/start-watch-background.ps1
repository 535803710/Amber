# Start Amber watch stack in background; logs to .local/watch-all.log and .local/health-monitor.log
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root ".local"
$LogFile = Join-Path $LogDir "watch-all.log"
$PidFile = Join-Path $LogDir "watch-all.pid"
$HealthPidFile = Join-Path $LogDir "health-monitor.pid"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Test-LiveNodePid([string]$PidPath) {
    if (-not (Test-Path $PidPath)) { return $false }
    $existingPid = [int](Get-Content -Path $PidPath -ErrorAction SilentlyContinue)
    if ($existingPid -le 0) { return $false }
    $process = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    return [bool]($process -and $process.Path -like "*node*")
}

$watchRunning = Test-LiveNodePid $PidFile
$healthRunning = Test-LiveNodePid $HealthPidFile
if ($watchRunning -and $healthRunning) {
    Write-Log "already running watch and health monitor"
    exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$watchScript = Join-Path $Root "scripts\start-watch-stack.mjs"

Write-Log "starting watch:all root=$Root"

$process = Start-Process `
    -FilePath $node `
    -ArgumentList @($watchScript, "--background") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru

Write-Log "started stack launcher pid=$($process.Id) log=$LogFile"
Write-Host "Amber watch stack started (launcher pid=$($process.Id))"
