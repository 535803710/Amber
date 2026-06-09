# Install / uninstall Windows logon autostart
param(
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$TaskName = "mi-notic-watch-all"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$StartScript = Join-Path $PSScriptRoot "start-watch-background.ps1"
$StopScript = Join-Path $PSScriptRoot "stop-watch-background.ps1"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "$TaskName.lnk"
$MarkerPath = Join-Path $Root ".local\autostart-method.txt"

function Show-Status {
    $schtasksOk = $false
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    cmd /c "schtasks /Query /TN `"$TaskName`" /FO LIST" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $schtasksOk = $true
        Write-Host "Method: Task Scheduler"
        cmd /c "schtasks /Query /TN `"$TaskName`" /FO LIST /V"
    }
    $ErrorActionPreference = $previousPreference

    if (Test-Path $ShortcutPath) {
        Write-Host "Method: Startup folder shortcut"
        Write-Host "Shortcut: $ShortcutPath"
    }

    if (-not $schtasksOk -and -not (Test-Path $ShortcutPath)) {
        Write-Host "Autostart not installed: $TaskName"
    }
}

function Remove-StartupShortcut {
    if (Test-Path $ShortcutPath) {
        Remove-Item -Path $ShortcutPath -Force
        Write-Host "Removed startup shortcut"
    }
}

function Remove-ScheduledTask {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    cmd /c "schtasks /Delete /TN `"$TaskName`" /F" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removed scheduled task"
    }
    $ErrorActionPreference = $previousPreference
}

function Install-StartupShortcut {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.WindowStyle = 7
    $shortcut.Description = "mi-notic watch:all background watcher"
    $shortcut.Save()

    Set-Content -Path $MarkerPath -Value "startup-folder" -Encoding ASCII
}

function Install-ScheduledTask {
    $taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    cmd /c "schtasks /Create /TN `"$TaskName`" /TR `"$taskCommand`" /SC ONLOGON /DELAY 0000:30 /RL LIMITED /F" 2>$null | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $previousPreference
    return $ok
}

if ($Status) {
    Show-Status
    exit 0
}

if ($Uninstall) {
    Remove-ScheduledTask
    Remove-StartupShortcut
    if (Test-Path $MarkerPath) {
        Remove-Item -Path $MarkerPath -Force -ErrorAction SilentlyContinue
    }
    & $StopScript
    Write-Host "Autostart uninstalled"
    exit 0
}

if (-not (Test-Path $StartScript)) {
    throw "Missing script: $StartScript"
}

$installed = $false
if (Install-ScheduledTask) {
    Write-Host "Installed via Task Scheduler: $TaskName"
    Set-Content -Path $MarkerPath -Value "schtasks" -Encoding ASCII
    $installed = $true
} else {
    Write-Host "Task Scheduler unavailable, using Startup folder instead..."
    Install-StartupShortcut
    Write-Host "Installed via Startup folder: $ShortcutPath"
    $installed = $true
}

if (-not $installed) {
    throw "Failed to install autostart"
}

Write-Host "  Root: $Root"
Write-Host "  Log:  $(Join-Path $Root '.local\watch-all.log')"
Write-Host ""
Write-Host "Commands:"
Write-Host "  npm run autostart:status"
Write-Host "  npm run autostart:stop"
Write-Host "  npm run autostart:uninstall"

if ($StartNow) {
    Write-Host ""
    Write-Host "Starting background watcher now..."
    & $StartScript
}
