# Start watch:all in background; logs to .local/watch-all.log
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root ".local"
$LogFile = Join-Path $LogDir "watch-all.log"
$PidFile = Join-Path $LogDir "watch-all.pid"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

if (Test-Path $PidFile) {
    $existingPid = [int](Get-Content -Path $PidFile -ErrorAction SilentlyContinue)
    if ($existingPid -gt 0) {
        $process = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($process -and $process.Path -like "*node*") {
            Write-Log "already running pid=$existingPid"
            exit 0
        }
    }
}

$node = (Get-Command node -ErrorAction Stop).Source
$watchScript = Join-Path $Root "scripts\watch-all.mjs"

Write-Log "starting watch:all root=$Root"

$process = Start-Process `
    -FilePath $node `
    -ArgumentList @($watchScript) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $PidFile -Value $process.Id -Encoding ASCII
Write-Log "started pid=$($process.Id) log=$LogFile"
Write-Host "watch:all started (pid=$($process.Id))"
