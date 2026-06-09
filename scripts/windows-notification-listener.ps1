# Windows 系统通知读取脚本（UserNotificationListener）
# 输出 JSON 到 stdout，供 watch-notifications.mjs 调用

param(
    [ValidateSet("check-access", "list")]
    [string]$Action = "list",

    [switch]$RequestAccess
)

$ErrorActionPreference = "Stop"

# NotificationKinds.Toast = 1
$ToastNotificationKind = 1

function Write-JsonResult {
    param([hashtable]$Data)
    $json = $Data | ConvertTo-Json -Depth 6 -Compress
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $stdout = [Console]::OpenStandardOutput()
    $bytes = $utf8.GetBytes($json + [Environment]::NewLine)
    $stdout.Write($bytes, 0, $bytes.Length)
}

function Initialize-WinRtTypes {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

    $null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime]
}

function Wait-WinRtTask {
    param(
        [object]$AsyncOperation,
        [Type]$ResultType = $null
    )

    # WinRT IAsyncOperation 在 PowerShell 中通常可直接 GetAwaiter
    try {
        return $AsyncOperation.GetAwaiter().GetResult()
    }
    catch {
        $asTaskMethods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq "AsTask" -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
        }

        if (-not $asTaskMethods -or -not $ResultType) {
            throw "无法等待 WinRT 异步操作: $($_.Exception.Message)"
        }

        $asTask = $asTaskMethods[0].MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($AsyncOperation))
        $netTask.Wait() | Out-Null
        return $netTask.Result
    }
}

function Get-AccessStatusName {
    param([object]$Status)
    return [string]$Status
}

function Request-NotificationAccess {
    param([object]$Listener)

    $accessEnumType = [Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]
    if ($null -eq $accessEnumType) {
        throw "无法加载 UserNotificationListenerAccessStatus 类型"
    }

    return Wait-WinRtTask -AsyncOperation $Listener.RequestAccessAsync() -ResultType $accessEnumType
}

function Get-NotificationItems {
    $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
    $accessStatus = $listener.GetAccessStatus()

    if ($RequestAccess -and $accessStatus.ToString() -ne "Allowed") {
        $accessStatus = Request-NotificationAccess -Listener $listener
    }

    $accessName = Get-AccessStatusName -Status $accessStatus
    if ($accessName -ne "Allowed") {
        return @{
            accessStatus = $accessName
            notifications = @()
        }
    }

    $readOnlyListType = [System.Collections.Generic.IReadOnlyList`1].MakeGenericType([Windows.UI.Notifications.UserNotification])
    $notifications = Wait-WinRtTask -AsyncOperation $listener.GetNotificationsAsync($ToastNotificationKind) -ResultType $readOnlyListType

    $items = @()
    foreach ($notif in $notifications) {
        $title = ""
        $body = ""

        try {
            $binding = $notif.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
            if ($null -ne $binding) {
                $textElements = $binding.GetTextElements()
                if ($textElements.Count -gt 0) {
                    $title = [string]$textElements[0].Text
                }
                if ($textElements.Count -gt 1) {
                    $bodyParts = @()
                    for ($i = 1; $i -lt $textElements.Count; $i++) {
                        $text = [string]$textElements[$i].Text
                        if ($text) {
                            $bodyParts += $text
                        }
                    }
                    $body = ($bodyParts -join " ").Trim()
                }
            }
        }
        catch {
            # 部分通知可能没有标准 toast 绑定
        }

        $appName = ""
        try {
            $appName = [string]$notif.AppInfo.DisplayInfo.DisplayName
        }
        catch {
            $appName = ""
        }

        $items += @{
            id = [string]$notif.Id
            appName = $appName
            title = $title
            body = $body
        }
    }

    return @{
        accessStatus = $accessName
        notifications = $items
    }
}

try {
    Initialize-WinRtTypes

    if ($Action -eq "check-access") {
        $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
        $accessStatus = $listener.GetAccessStatus()

        if ($RequestAccess -and $accessStatus.ToString() -ne "Allowed") {
            $accessStatus = Request-NotificationAccess -Listener $listener
        }

        Write-JsonResult @{
            accessStatus = (Get-AccessStatusName -Status $accessStatus)
        }
        exit 0
    }

    $result = Get-NotificationItems
    Write-JsonResult $result
    exit 0
}
catch {
    Write-JsonResult @{
        accessStatus = "Error"
        error = $_.Exception.Message
        notifications = @()
    }
    exit 1
}
