param(
    [switch]$Autostart,
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\modules\Common.ps1"

function Format-CodeRemoteCmdArgument {
    param([string]$Value)

    if ($null -eq $Value) {
        return '""'
    }

    return '"' + $Value.Replace('"', '""') + '"'
}

$repoRoot = Get-CodeRemoteRepoRoot -ScriptPath $PSCommandPath
$paths = Get-CodeRemotePaths -RepoRoot $repoRoot
$config = Read-CodeRemoteConfig -ConfigFile $paths.ConfigFile

$serverPort = [int]$config.server.port
$serverToken = [string]$config.server.token
$workspaceRoot = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.server.workspaceRoot)
$logsDir = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.paths.logsDir)
$uploadsDir = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.paths.uploadsDir)
$serverOutLog = Join-Path $logsDir "server.out.log"
$serverErrLog = Join-Path $logsDir "server.err.log"
$launcherScript = Join-Path $paths.RuntimeTempDir "start-server.cmd"
$openBrowser = if ($Autostart) { [bool]$config.autostart.openBrowserOnLogin } else { [bool]$config.ui.openBrowserOnStart }

Write-CodeRemoteSection "CodeRemote Start"

if ([string]::IsNullOrWhiteSpace($serverToken)) {
    throw "config.server.token must not be empty."
}

if ([string]::IsNullOrWhiteSpace($workspaceRoot)) {
    throw "config.server.workspaceRoot must not be empty."
}

Assert-CodeRemoteFile -FilePath $paths.ServerEntry -Message "Missing server build output. Run .\scripts\windows\setup.ps1 first."
Assert-CodeRemoteFile -FilePath $paths.WebIndex -Message "Missing web build output. Run .\scripts\windows\setup.ps1 first."
Assert-CodeRemoteCommandOrPath -Value "node" -Label "Node.js" -InstallHint "Install Node.js 18+."

$claudeCommand = Get-CodeRemoteProviderCommand -ProviderConfig $config.providers.claude -Fallback "claude"
$codexCommand = Get-CodeRemoteProviderCommand -ProviderConfig $config.providers.codex -Fallback "codex"

if ($config.providers.claude.enabled) {
    Assert-CodeRemoteCommandOrPath -Value $claudeCommand -Label "Claude CLI" -InstallHint "Install Claude Code CLI or update providers.claude.cliCommand."
}

if ($config.providers.codex.enabled) {
    Assert-CodeRemoteCommandOrPath -Value $codexCommand -Label "Codex CLI" -InstallHint "Install Codex CLI or update providers.codex.cliCommand."
}

Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeTempDir
Ensure-CodeRemoteDirectory -PathValue $logsDir
Ensure-CodeRemoteDirectory -PathValue $uploadsDir

$tunnelMode = Get-CodeRemoteTunnelMode -Config $config
if ($tunnelMode -eq "ngrok") {
    $ngrokCommand = if ([string]::IsNullOrWhiteSpace([string]$config.tunnel.ngrokPath)) { "ngrok" } else { [string]$config.tunnel.ngrokPath }
    Assert-CodeRemoteCommandOrPath -Value $ngrokCommand -Label "ngrok" -InstallHint "Install ngrok or set tunnel.ngrokPath."
    Add-CodeRemoteCommandDirectoryToPath -Value $ngrokCommand
}

Write-Host "[1/3] Clearing port $serverPort..." -ForegroundColor Yellow
Stop-CodeRemoteProcessesOnPort -Port $serverPort

$env:CLAUDE_CLI_COMMAND = $claudeCommand
$env:CODEX_CLI_COMMAND = $codexCommand
$env:CODEREMOTE_DEFAULT_WORKSPACE = $workspaceRoot
$env:CODEREMOTE_MCP_CONFIG = $paths.McpConfigFile

$staticPath = Split-Path -Parent $paths.WebIndex
$serverArgs = @(
    $paths.ServerEntry,
    "start",
    "--config-file", $paths.ConfigFile,
    "--port", "$serverPort",
    "--token", $serverToken,
    "--workspace", $workspaceRoot,
    "--static-path", $staticPath,
    "--uploads-dir", $uploadsDir
)

switch ($tunnelMode) {
    "disabled" {
        $serverArgs += "--no-tunnel"
    }
    "ngrok" {
        $serverArgs += "--tunnel"
        $serverArgs += "ngrok"
    }
    "cloudflare" {
        $serverArgs += "--tunnel"
        $serverArgs += "cloudflare"
    }
    "custom" {
        $customHost = Get-CodeRemoteCustomTunnelHost -Value ([string]$config.tunnel.customPublicWsUrl)
        if ([string]::IsNullOrWhiteSpace($customHost)) {
            throw "tunnel.customPublicWsUrl must be set when tunnel.mode is custom."
        }
        $serverArgs += "--tunnel"
        $serverArgs += "custom"
        $serverArgs += "--host"
        $serverArgs += $customHost
    }
    default {
        throw "Unsupported tunnel.mode: $tunnelMode"
    }
}

$nodeCommand = (Get-Command node -ErrorAction Stop).Source

if ($Foreground) {
    Write-Host "[2/3] Starting CodeRemote server in foreground..." -ForegroundColor Yellow
    Write-Host "[3/3] Streaming live logs. Press Ctrl+C to stop." -ForegroundColor Yellow
    Write-Host ""
    & $nodeCommand $serverArgs
    exit $LASTEXITCODE
}

Write-Host "[2/3] Starting CodeRemote server..." -ForegroundColor Yellow
if (Test-Path $serverOutLog) { Remove-Item $serverOutLog -Force }
if (Test-Path $serverErrLog) { Remove-Item $serverErrLog -Force }
if (Test-Path $launcherScript) { Remove-Item $launcherScript -Force }

$quotedArgs = $serverArgs | ForEach-Object { Format-CodeRemoteCmdArgument -Value ([string]$_) }
$launcherLines = @(
    '@echo off',
    'setlocal',
    ('cd /d {0}' -f (Format-CodeRemoteCmdArgument -Value $paths.ServerDir)),
    ('set "CLAUDE_CLI_COMMAND={0}"' -f $claudeCommand),
    ('set "CODEX_CLI_COMMAND={0}"' -f $codexCommand),
    ('set "CODEREMOTE_DEFAULT_WORKSPACE={0}"' -f $workspaceRoot),
    ('set "CODEREMOTE_MCP_CONFIG={0}"' -f $paths.McpConfigFile),
    ('{0} {1} 1>> {2} 2>> {3}' -f (Format-CodeRemoteCmdArgument -Value $nodeCommand), ($quotedArgs -join ' '), (Format-CodeRemoteCmdArgument -Value $serverOutLog), (Format-CodeRemoteCmdArgument -Value $serverErrLog))
)
$launcherContent = ($launcherLines -join "`r`n") + "`r`n"
[System.IO.File]::WriteAllText($launcherScript, $launcherContent, [System.Text.Encoding]::ASCII)

$process = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', (Format-CodeRemoteCmdArgument -Value $launcherScript) `
    -PassThru `
    -WindowStyle Minimized

Write-Host ("[OK] Started launcher PID {0}" -f $process.Id) -ForegroundColor Green

Write-Host "[3/3] Waiting for health check..." -ForegroundColor Yellow
$healthUrl = "http://localhost:$serverPort/health"
if (-not (Wait-CodeRemoteHttpHealthy -Url $healthUrl -TimeoutSeconds 30)) {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "[ERROR] CodeRemote failed to become healthy." -ForegroundColor Red
    if (Test-Path $serverErrLog) {
        Write-Host ""
        Write-Host "stderr:" -ForegroundColor Yellow
        Get-Content $serverErrLog
    }
    throw "Startup failed. See logs in $logsDir"
}

Write-CodeRemoteSection "CodeRemote Running"
Write-Host ("Local UI:        http://localhost:{0}" -f $serverPort) -ForegroundColor White
Write-Host ("Local WebSocket: ws://localhost:{0}" -f $serverPort) -ForegroundColor White
Write-Host ("Token:           {0}" -f $serverToken) -ForegroundColor White
Write-Host ("Workspace:       {0}" -f $workspaceRoot) -ForegroundColor White
Write-Host ("stdout log:      {0}" -f $serverOutLog) -ForegroundColor White
Write-Host ("stderr log:      {0}" -f $serverErrLog) -ForegroundColor White

if ($tunnelMode -eq "custom" -and -not [string]::IsNullOrWhiteSpace([string]$config.tunnel.customPublicWsUrl)) {
    Write-Host ("Custom Remote:   {0}" -f [string]$config.tunnel.customPublicWsUrl) -ForegroundColor Green
}

if ($openBrowser) {
    try {
        Start-Process "http://localhost:$serverPort" | Out-Null
    } catch {
        Write-Host ("[WARN] Failed to open browser automatically: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}
