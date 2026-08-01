# Stop background watch:all
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PidFile = Join-Path $Root ".local\watch-all.pid"
$HealthPidFile = Join-Path $Root ".local\health-monitor.pid"
$DesiredFile = Join-Path $Root ".local\runtime-desired.json"

if (Test-Path $DesiredFile) {
    try {
        $desired = Get-Content -Raw -Encoding UTF8 $DesiredFile | ConvertFrom-Json
        $desired.running = $false
        $desired.changedAt = (Get-Date).ToUniversalTime().ToString("o")
        $desired.consecutiveMisses = 0
        $desired | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $DesiredFile
    } catch {
        # The monitor will treat an unreadable desired state as not expected to run.
    }
}

foreach ($pidPath in @($PidFile, $HealthPidFile)) {
    if (-not (Test-Path $pidPath)) {
        continue
    }

    $pidValue = [int](Get-Content -Path $pidPath -ErrorAction SilentlyContinue)
    if ($pidValue -le 0) {
        Remove-Item -Path $pidPath -Force -ErrorAction SilentlyContinue
        continue
    }

    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) {
        taskkill /PID $pidValue /T /F | Out-Null
        Write-Host "stopped pid=$pidValue"
    }
    Remove-Item -Path $pidPath -Force -ErrorAction SilentlyContinue
}
