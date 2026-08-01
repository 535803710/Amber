# Install / uninstall Windows logon autostart
param(
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$TaskName = "amber-watch-all"
$LegacyTaskNames = @("mi-notic-watch-all")
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

    foreach ($legacyName in $LegacyTaskNames) {
        $legacyShortcutPath = Join-Path $StartupFolder "$legacyName.lnk"
        if (Test-Path $legacyShortcutPath) {
            Write-Host "Legacy startup shortcut detected: $legacyShortcutPath"
        }
    }
}

function Remove-LegacyAutostart {
    foreach ($legacyName in $LegacyTaskNames) {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        cmd /c "schtasks /Delete /TN `"$legacyName`" /F" 2>$null | Out-Null
        $ErrorActionPreference = $previousPreference

        $legacyShortcutPath = Join-Path $StartupFolder "$legacyName.lnk"
        if (Test-Path $legacyShortcutPath) {
            $legacyShortcut = Get-Item -LiteralPath $legacyShortcutPath -ErrorAction Stop
            $legacyShortcut.Attributes = [System.IO.FileAttributes]::Normal
            Remove-Item -LiteralPath $legacyShortcutPath -Force -ErrorAction Stop
            Write-Host "Removed legacy startup shortcut: $legacyName"
        }
    }
}

function Remove-StartupShortcut {
    if (Test-Path $ShortcutPath) {
        try {
            $shortcutItem = Get-Item -LiteralPath $ShortcutPath -ErrorAction Stop
            $shortcutItem.Attributes = [System.IO.FileAttributes]::Normal
            Remove-Item -LiteralPath $ShortcutPath -Force -ErrorAction Stop
            Write-Host "Removed startup shortcut"
        } catch {
            throw "Failed to remove startup shortcut: $ShortcutPath. $($_.Exception.Message)"
        }
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
    $shortcut.Description = "Amber watch:all background watcher"
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
    Remove-LegacyAutostart
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

Remove-LegacyAutostart

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
