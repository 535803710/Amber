# Start Amber watch stack in background; logs to .local/watch-all.log and .local/health-monitor.log
param(
    [ValidateSet("core", "full")]
    [string]$Profile = "core"
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root ".local"
$LogFile = Join-Path $LogDir "watch-all.log"
$ErrorLogFile = Join-Path $LogDir "watch-all-error.log"
$HealthLogFile = Join-Path $LogDir "health-monitor.log"
$HealthErrorLogFile = Join-Path $LogDir "health-monitor-error.log"
$LauncherLogFile = Join-Path $LogDir "start-watch.log"
$PidFile = Join-Path $LogDir "watch-all.pid"
$HealthPidFile = Join-Path $LogDir "health-monitor.pid"
$DesiredFile = Join-Path $LogDir "runtime-desired.json"
$WatchScript = Join-Path $Root "scripts\watch-all.mjs"
$HealthScript = Join-Path $Root "scripts\health-monitor-worker.mjs"
$NodeResolver = Join-Path $Root "scripts\resolve-node.ps1"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $LauncherLogFile -Value $line -Encoding UTF8
}

function Write-RuntimeDesired {
    $json = [ordered]@{
        running = $true
        profile = $Profile
        changedAt = (Get-Date).ToUniversalTime().ToString("o")
        consecutiveMisses = 0
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText($DesiredFile, "$json`n", $Utf8NoBom)
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
$currentProfile = $null
if (Test-Path $DesiredFile) {
    try {
        $currentProfile = (Get-Content -Raw -Encoding UTF8 $DesiredFile | ConvertFrom-Json).profile
    } catch {
        $currentProfile = $null
    }
}
if ($watchRunning -and -not $currentProfile) {
    $currentProfile = "full"
}
if ($watchRunning -and $currentProfile -and $currentProfile -ne $Profile) {
    $existingPid = [int](Get-Content -Path $PidFile -ErrorAction SilentlyContinue)
    taskkill /PID $existingPid /T /F | Out-Null
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    $watchRunning = $false
    Write-Log "switching runtime profile from $currentProfile to $Profile"
}
if ($watchRunning -and $healthRunning) {
    Write-Log "already running watch and health monitor profile=$Profile"
    exit 0
}

$node = (& $NodeResolver | Select-Object -First 1).Trim()

if (-not $watchRunning) {
    Write-Log "starting watch:all root=$Root"
    $watchProcess = Start-Process `
        -FilePath $node `
        -ArgumentList @("`"$WatchScript`"", "--profile", $Profile) `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError $ErrorLogFile `
        -PassThru
    [System.IO.File]::WriteAllText($PidFile, "$($watchProcess.Id)`n", $Utf8NoBom)
    Write-Log "started watch:all pid=$($watchProcess.Id)"
}

Write-RuntimeDesired

if (-not $healthRunning) {
    $healthProcess = Start-Process `
        -FilePath $node `
        -ArgumentList @("`"$HealthScript`"") `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $HealthLogFile `
        -RedirectStandardError $HealthErrorLogFile `
        -PassThru
    [System.IO.File]::WriteAllText($HealthPidFile, "$($healthProcess.Id)`n", $Utf8NoBom)
    Write-Log "started health monitor pid=$($healthProcess.Id)"
}

Write-Host "Amber $Profile runtime started"
