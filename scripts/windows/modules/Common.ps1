Set-StrictMode -Version Latest

function Write-CodeRemoteSection {
    param([string]$Text)

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ("  {0}" -f $Text) -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Get-CodeRemoteRepoRoot {
    param([string]$ScriptPath)

    $scriptDir = Split-Path -Parent $ScriptPath
    return [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
}

function Get-CodeRemotePaths {
    param([string]$RepoRoot)

    $serverDir = Join-Path $RepoRoot "apps\server"
    $webDir = Join-Path $RepoRoot "apps\web"
    $runtimeDir = Join-Path $RepoRoot "runtime"

    [pscustomobject]@{
        RepoRoot = $RepoRoot
        ServerDir = $serverDir
        WebDir = $webDir
        MobileDir = Join-Path $RepoRoot "apps\mobile"
        ConfigDir = Join-Path $RepoRoot "config"
        ConfigFile = Join-Path $RepoRoot "config\coderemote.local.json"
        ExampleConfigFile = Join-Path $RepoRoot "config\coderemote.example.json"
        RuntimeDir = $runtimeDir
        RuntimeLogsDir = Join-Path $runtimeDir "logs"
        RuntimeUploadsDir = Join-Path $runtimeDir "uploads"
        RuntimeReportsDir = Join-Path $runtimeDir "reports"
        RuntimeDiscussionsDir = Join-Path $runtimeDir "discussions"
        RuntimeDiscussionSessionsDir = Join-Path $runtimeDir "discussions\sessions"
        RuntimeTempDir = Join-Path $runtimeDir "temp"
        ServerEntry = Join-Path $serverDir "dist\index.js"
        WebIndex = Join-Path $webDir "dist\index.html"
        McpConfigFile = Join-Path $serverDir "mcp-config.json"
        StartScript = Join-Path $RepoRoot "scripts\windows\start.ps1"
    }
}

function Read-CodeRemoteConfig {
    param([string]$ConfigFile)

    if (-not (Test-Path $ConfigFile)) {
        throw "Missing config file: $ConfigFile`nCopy config\coderemote.example.json to config\coderemote.local.json first."
    }

    return Get-Content $ConfigFile -Raw | ConvertFrom-Json
}

function Resolve-CodeRemotePath {
    param(
        [string]$RepoRoot,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Value))
}

function Ensure-CodeRemoteDirectory {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return
    }

    if (-not (Test-Path $PathValue)) {
        New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
    }
}

function Test-CodeRemoteCommand {
    param([string]$CommandName)

    return $null -ne (Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Test-CodeRemoteCommandOrPath {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    if ([System.IO.Path]::IsPathRooted($Value) -or $Value.Contains('\') -or $Value.Contains('/')) {
        return Test-Path $Value
    }

    return $null -ne (Get-Command $Value -ErrorAction SilentlyContinue)
}

function Assert-CodeRemoteCommandOrPath {
    param(
        [string]$Value,
        [string]$Label,
        [string]$InstallHint
    )

    if (-not (Test-CodeRemoteCommandOrPath $Value)) {
        throw "$Label not found. $InstallHint"
    }
}

function Add-CodeRemoteCommandDirectoryToPath {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return
    }

    if (-not ([System.IO.Path]::IsPathRooted($Value) -or $Value.Contains('\') -or $Value.Contains('/'))) {
        return
    }

    if (-not (Test-Path $Value)) {
        return
    }

    $directory = Split-Path -Parent $Value
    if ([string]::IsNullOrWhiteSpace($directory)) {
        return
    }

    $pathEntries = $env:PATH -split ';'
    if ($pathEntries -notcontains $directory) {
        $env:PATH = "$directory;$env:PATH"
    }
}

function Stop-CodeRemoteProcessesOnPort {
    param([int]$Port)

    $processIds = @()

    try {
        $processIds = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        $processIds = netstat -ano |
            Select-String ":$Port\s+.*LISTENING" |
            ForEach-Object {
                $parts = ($_ -split "\s+") | Where-Object { $_ }
                if ($parts.Length -ge 5) {
                    [int]$parts[-1]
                }
            } |
            Select-Object -Unique
    }

    foreach ($processId in $processIds) {
        if ($processId -le 0) {
            continue
        }

        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Write-Host ("[OK] Stopped PID {0} on port {1}" -f $processId, $Port) -ForegroundColor Green
        } catch {
            Write-Host ("[WARN] Failed to stop PID {0} on port {1}: {2}" -f $processId, $Port, $_.Exception.Message) -ForegroundColor Yellow
        }
    }
}

function Wait-CodeRemoteHttpHealthy {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
        }

        Start-Sleep -Seconds 1
    }

    return $false
}

function Get-CodeRemoteTunnelMode {
    param($Config)

    $mode = [string]$Config.tunnel.mode
    if ([string]::IsNullOrWhiteSpace($mode)) {
        return "disabled"
    }

    return $mode.Trim().ToLowerInvariant()
}

function Get-CodeRemoteCustomTunnelHost {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $trimmed = $Value.Trim()
    if ($trimmed -match '^[a-z]+://') {
        try {
            return ([Uri]$trimmed).Host
        } catch {
            return $trimmed
        }
    }

    return $trimmed -replace '^wss?://', '' -replace '^https?://', ''
}

function Get-CodeRemoteProviderCommand {
    param($ProviderConfig, [string]$Fallback)

    if ($null -eq $ProviderConfig) {
        return $Fallback
    }

    $value = [string]$ProviderConfig.cliCommand
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Fallback
    }

    return $value.Trim()
}

function Assert-CodeRemoteFile {
    param(
        [string]$FilePath,
        [string]$Message
    )

    if (-not (Test-Path $FilePath)) {
        throw $Message
    }
}
