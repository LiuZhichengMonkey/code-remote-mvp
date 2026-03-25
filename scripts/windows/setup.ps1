$ErrorActionPreference = "Stop"
. "$PSScriptRoot\modules\Common.ps1"

$repoRoot = Get-CodeRemoteRepoRoot -ScriptPath $PSCommandPath
$paths = Get-CodeRemotePaths -RepoRoot $repoRoot
$config = Read-CodeRemoteConfig -ConfigFile $paths.ConfigFile

$serverPort = [int]$config.server.port
$serverToken = [string]$config.server.token
$workspaceRoot = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.server.workspaceRoot)
$logsDir = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.paths.logsDir)
$uploadsDir = Resolve-CodeRemotePath -RepoRoot $repoRoot -Value ([string]$config.paths.uploadsDir)
$ngrokDomain = [string]$config.tunnel.ngrokDomain

Write-CodeRemoteSection "CodeRemote Setup"

if ([string]::IsNullOrWhiteSpace($serverToken)) {
    throw "config.server.token must not be empty."
}

if ([string]::IsNullOrWhiteSpace($workspaceRoot)) {
    throw "config.server.workspaceRoot must not be empty."
}

if (-not (Test-Path $workspaceRoot)) {
    throw "Workspace root does not exist: $workspaceRoot"
}

Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow
Assert-CodeRemoteCommandOrPath -Value "node" -Label "Node.js" -InstallHint "Install Node.js 18+."
Assert-CodeRemoteCommandOrPath -Value "npm" -Label "npm" -InstallHint "Install npm together with Node.js."

$claudeCommand = Get-CodeRemoteProviderCommand -ProviderConfig $config.providers.claude -Fallback "claude"
$codexCommand = Get-CodeRemoteProviderCommand -ProviderConfig $config.providers.codex -Fallback "codex"

if ($config.providers.claude.enabled) {
    Assert-CodeRemoteCommandOrPath -Value $claudeCommand -Label "Claude CLI" -InstallHint "Install Claude Code CLI or update providers.claude.cliCommand."
}

if ($config.providers.codex.enabled) {
    Assert-CodeRemoteCommandOrPath -Value $codexCommand -Label "Codex CLI" -InstallHint "Install Codex CLI or update providers.codex.cliCommand."
}

$tunnelMode = Get-CodeRemoteTunnelMode -Config $config
if ($tunnelMode -eq "ngrok") {
    $ngrokCommand = if ([string]::IsNullOrWhiteSpace([string]$config.tunnel.ngrokPath)) { "ngrok" } else { [string]$config.tunnel.ngrokPath }
    Assert-CodeRemoteCommandOrPath -Value $ngrokCommand -Label "ngrok" -InstallHint "Install ngrok or set tunnel.ngrokPath."
    Add-CodeRemoteCommandDirectoryToPath -Value $ngrokCommand
}

Write-Host "[2/6] Preparing runtime directories..." -ForegroundColor Yellow
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeLogsDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeUploadsDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeReportsDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeDiscussionsDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeDiscussionSessionsDir
Ensure-CodeRemoteDirectory -PathValue $paths.RuntimeTempDir
Ensure-CodeRemoteDirectory -PathValue $logsDir
Ensure-CodeRemoteDirectory -PathValue $uploadsDir

Write-Host "[3/6] Installing server dependencies..." -ForegroundColor Yellow
Push-Location $paths.ServerDir
npm install
Pop-Location

Write-Host "[4/6] Installing web dependencies..." -ForegroundColor Yellow
Push-Location $paths.WebDir
npm install
Pop-Location

Write-Host "[5/6] Building server and web..." -ForegroundColor Yellow
Push-Location $paths.ServerDir
npm run build
Pop-Location

Push-Location $paths.WebDir
npm run build
Pop-Location

Assert-CodeRemoteFile -FilePath $paths.ServerEntry -Message "Missing server build output: $($paths.ServerEntry)"
Assert-CodeRemoteFile -FilePath $paths.WebIndex -Message "Missing web build output: $($paths.WebIndex)"

Write-Host "[6/6] Applying provider bootstrap config..." -ForegroundColor Yellow
$env:CLAUDE_CLI_COMMAND = $claudeCommand
$env:CODEX_CLI_COMMAND = $codexCommand
$env:CODEREMOTE_DEFAULT_WORKSPACE = $workspaceRoot
$env:CODEREMOTE_MCP_CONFIG = $paths.McpConfigFile

Push-Location $paths.ServerDir
node $paths.ServerEntry bootstrap-config --config-file $paths.ConfigFile
Pop-Location

Write-CodeRemoteSection "Setup Complete"
Write-Host ("Local UI:        http://localhost:{0}" -f $serverPort) -ForegroundColor White
Write-Host ("Local WebSocket: ws://localhost:{0}" -f $serverPort) -ForegroundColor White
Write-Host ("Token:           {0}" -f $serverToken) -ForegroundColor White
Write-Host ("Workspace:       {0}" -f $workspaceRoot) -ForegroundColor White
Write-Host ("Logs:            {0}" -f $logsDir) -ForegroundColor White
Write-Host ("Uploads:         {0}" -f $uploadsDir) -ForegroundColor White

if ($tunnelMode -eq "ngrok" -and -not [string]::IsNullOrWhiteSpace($ngrokDomain)) {
    $ngrokRemoteHost = Get-CodeRemoteCustomTunnelHost -Value $ngrokDomain
    $ngrokRemoteHttpUrl = Get-CodeRemoteCustomTunnelHttpUrl -Value $ngrokDomain
    Write-Host ("Ngrok Remote WS:{0}{1}" -f (' ' * 4), "wss://$ngrokRemoteHost") -ForegroundColor Green
    if (-not [string]::IsNullOrWhiteSpace($ngrokRemoteHttpUrl)) {
        Write-Host ("Ngrok Remote UI:{0}{1}" -f (' ' * 4), $ngrokRemoteHttpUrl) -ForegroundColor White
    }
}

if ($tunnelMode -eq "custom" -and -not [string]::IsNullOrWhiteSpace([string]$config.tunnel.customPublicWsUrl)) {
    $customRemoteWsUrl = [string]$config.tunnel.customPublicWsUrl
    $customRemoteHttpUrl = Get-CodeRemoteCustomTunnelHttpUrl -Value $customRemoteWsUrl
    Write-Host ("Custom Remote WS:{0}{1}" -f (' ' * 3), $customRemoteWsUrl) -ForegroundColor Green
    if (-not [string]::IsNullOrWhiteSpace($customRemoteHttpUrl)) {
        Write-Host ("Custom Remote UI:{0}{1}" -f (' ' * 3), $customRemoteHttpUrl) -ForegroundColor White
    }
    Write-Host "[WARN] tunnel.mode=custom only records the public address. It does not create or manage the tunnel for you." -ForegroundColor Yellow
    if ($customRemoteWsUrl -match 'ngrok-free\.dev') {
        Write-Host "[WARN] If you expect the one-click script to start ngrok automatically, switch tunnel.mode to ngrok." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Next step:" -ForegroundColor Cyan
Write-Host ".\scripts\windows\start.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "Optional auto-start:" -ForegroundColor Cyan
Write-Host ".\scripts\windows\install-autostart.ps1" -ForegroundColor Cyan
