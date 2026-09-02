[CmdletBinding()]
param(
    [int]$MinimumMajor = 22
)

$ErrorActionPreference = "Stop"

$candidates = New-Object System.Collections.Generic.List[string]
$pathNode = Get-Command node -ErrorAction SilentlyContinue
if ($pathNode -and $pathNode.Source) {
    $candidates.Add($pathNode.Source)
}

foreach ($candidate in @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe" }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe" }),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" })
)) {
    if ($candidate) {
        $candidates.Add($candidate)
    }
}

$seen = @{}
foreach ($candidate in $candidates) {
    $fullPath = [System.IO.Path]::GetFullPath($candidate)
    Write-Verbose "Checking Node candidate: $fullPath"
    if ($seen.ContainsKey($fullPath) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        continue
    }
    $seen[$fullPath] = $true

    try {
        $version = (& $fullPath -p "process.versions.node" 2>$null | Select-Object -First 1).Trim()
        $major = [int]($version.Split('.')[0])
        Write-Verbose "Candidate version: $version"
        if ($major -ge $MinimumMajor) {
            Write-Output $fullPath
            return
        }
    } catch {
        Write-Verbose "Candidate failed: $($_.Exception.Message)"
        continue
    }
}

throw "Amber requires Node.js $MinimumMajor or later. No supported runtime was found in PATH, standard install locations, or Codex Runtime."
