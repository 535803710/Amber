# Codex/Cursor UI Automation probe (read-only)

param(
    [string[]]$Apps = @("Codex", "Cursor"),
    [string[]]$Keywords = @(
        "confirm", "approve", "allow", "run command", "permission",
        "ask", "question", "answer", "input needed", "no answer provided"
    )
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Write-JsonResult {
    param([hashtable]$Data)
    $json = $Data | ConvertTo-Json -Depth 8 -Compress
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $stdout = [Console]::OpenStandardOutput()
    $bytes = $utf8.GetBytes($json + [Environment]::NewLine)
    $stdout.Write($bytes, 0, $bytes.Length)
}

function Test-KeywordMatch {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $false
    }

    $lower = $Text.ToLowerInvariant()
    foreach ($keyword in $Keywords) {
        if ([string]::IsNullOrWhiteSpace($keyword)) {
            continue
        }

        if ($lower.Contains($keyword.ToLowerInvariant())) {
            return $true
        }
    }

    return $false
}

function Get-ProcessPatterns {
    param([string[]]$AppNames)

    $patterns = @()
    foreach ($name in $AppNames) {
        if ($name -eq "*") {
            return @("*")
        }
        $patterns += $name
    }
    return $patterns
}

function Test-ProcessNameMatch {
    param(
        [string]$ProcessName,
        [string[]]$Patterns
    )

    if ($Patterns -contains "*") {
        return $true
    }

    foreach ($pattern in $Patterns) {
        if ($ProcessName -like "*$pattern*") {
            return $true
        }
    }

    return $false
}

function Get-TargetProcessIds {
    param([string[]]$Patterns)

    $ids = New-Object System.Collections.Generic.HashSet[int]
    foreach ($process in Get-Process) {
        $processName = [string]$process.ProcessName
        if (-not (Test-ProcessNameMatch -ProcessName $processName -Patterns $Patterns)) {
            continue
        }
        [void]$ids.Add($process.Id)
    }
    return $ids
}

function Get-ElementTextLines {
    param([System.Windows.Automation.AutomationElement]$Element)

    $lines = New-Object System.Collections.Generic.List[string]

    try {
        $name = [string]$Element.Current.Name
        if ($name) { $lines.Add($name) | Out-Null }
    }
    catch {}

    try {
        $help = [string]$Element.Current.HelpText
        if ($help) { $lines.Add($help) | Out-Null }
    }
    catch {}

    try {
        $valuePattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) {
            $value = [string]$valuePattern.Current.Value
            if ($value) { $lines.Add($value) | Out-Null }
        }
    }
    catch {}

    return ,@($lines.ToArray() | Where-Object { $_ } | Select-Object -Unique)
}

function Test-QuestionHeuristic {
    param(
        [System.Windows.Automation.AutomationElement]$Window,
        [string]$Haystack
    )

    if (Test-KeywordMatch -Text $Haystack) {
        return $true
    }

    if ($Haystack -match "\?") {
        try {
            $radioCondition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::RadioButton
            )
            $radios = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $radioCondition)
            if ($radios.Count -ge 2) {
                return $true
            }
        }
        catch {}
    }

    if ($Haystack -match "no answer provided") {
        return $true
    }

    return $false
}

function Get-ChoiceOptionTexts {
    param([System.Windows.Automation.AutomationElement]$Window)

    $options = New-Object System.Collections.Generic.List[string]

    try {
        $radioCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::RadioButton
        )
        $radios = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $radioCondition)
        $limit = [Math]::Min($radios.Count, 3)
        for ($i = 0; $i -lt $limit; $i++) {
            foreach ($line in (Get-ElementTextLines -Element $radios[$i])) {
                if ($options -notcontains $line) {
                    $options.Add($line) | Out-Null
                }
            }
        }
    }
    catch {}

    return ,@($options.ToArray())
}

function Get-WindowSummary {
    param([System.Windows.Automation.AutomationElement]$Window)

    $title = ""
    try {
        $title = [string]$Window.Current.Name
    }
    catch {
        $title = ""
    }

    $texts = New-Object System.Collections.Generic.List[string]
    if ($title) {
        $texts.Add($title) | Out-Null
    }

    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::IsControlElementProperty,
        $true
    )

    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $limit = [Math]::Min($elements.Count, 120)

    for ($i = 0; $i -lt $limit; $i++) {
        foreach ($line in (Get-ElementTextLines -Element $elements[$i])) {
            if ($texts -notcontains $line) {
                $texts.Add($line) | Out-Null
            }
            if ($texts.Count -ge 12) {
                break
            }
        }
        if ($texts.Count -ge 12) {
            break
        }
    }

    $options = Get-ChoiceOptionTexts -Window $Window
    foreach ($option in $options) {
        if ($texts -notcontains $option) {
            $texts.Add($option) | Out-Null
        }
        if ($texts.Count -ge 14) {
            break
        }
    }

    $separator = "; "
    $summary = ($texts -join $separator).Trim()
    if ($summary.Length -gt 240) {
        $summary = $summary.Substring(0, 240).TrimEnd() + "..."
    }

    return @{
        title = $title
        summary = $summary
    }
}

function Get-TopLevelWindowsForProcessIds {
    param([System.Collections.Generic.HashSet[int]]$ProcessIds)

    $windows = New-Object System.Collections.Generic.List[System.Windows.Automation.AutomationElement]
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
    )

    $allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
    foreach ($window in $allWindows) {
        try {
            $processId = $window.Current.ProcessId
            if ($ProcessIds.Contains($processId)) {
                $windows.Add($window) | Out-Null
            }
        }
        catch {}
    }

    return $windows
}

function Get-PromptMatches {
    $patterns = Get-ProcessPatterns -AppNames $Apps
    $processIds = Get-TargetProcessIds -Patterns $patterns
    $matches = @()
    $seen = @{}

    if ($processIds.Count -eq 0) {
        return $matches
    }

    $windows = Get-TopLevelWindowsForProcessIds -ProcessIds $processIds

    foreach ($window in $windows) {
        try {
            $processId = $window.Current.ProcessId
            $processName = ""
            try {
                $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
            }
            catch {
                $processName = "unknown"
            }

            $info = Get-WindowSummary -Window $window
            $haystack = "$($info.title) $($info.summary)"
            if (-not (Test-QuestionHeuristic -Window $window -Haystack $haystack)) {
                continue
            }

            $fingerprint = "{0}:{1}" -f $processId, ($haystack.ToLowerInvariant())
            if ($seen.ContainsKey($fingerprint)) {
                continue
            }
            $seen[$fingerprint] = $true

            $matches += @{
                processId = [string]$processId
                processName = [string]$processName
                windowTitle = $info.title
                summary = $info.summary
                fingerprint = $fingerprint
            }
        }
        catch {
            continue
        }
    }

    return $matches
}

try {
    $prompts = @(Get-PromptMatches)
    Write-JsonResult @{
        prompts = $prompts
        scannedAt = (Get-Date).ToString("o")
    }
    exit 0
}
catch {
    Write-JsonResult @{
        prompts = @()
        error = $_.Exception.Message
        scannedAt = (Get-Date).ToString("o")
    }
    exit 1
}
