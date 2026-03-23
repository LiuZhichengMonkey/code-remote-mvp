# CodeRemote quick start (PowerShell)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$cliDir = Join-Path $projectRoot "cli"
$chatUiDistDir = Join-Path $projectRoot "chat-ui\\dist"
$serverPort = 8085
$serverToken = "test123"
$localHttpUrl = "http://localhost:$serverPort"
$localWsUrl = "ws://localhost:$serverPort"
$defaultRemoteWsUrl = "wss://acropetal-nonfalteringly-ruben.ngrok-free.dev"
$tunnelApiUrl = "http://127.0.0.1:4040/api/tunnels"

function Write-Section {
    param([string]$Text)

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ("  {0}" -f $Text) -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Stop-ProcessesOnPort {
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

function Get-TunnelPublicUrl {
    try {
        $response = Invoke-RestMethod -Uri $tunnelApiUrl -TimeoutSec 2
        $firstTunnel = @($response.tunnels | Where-Object { $_.public_url }) | Select-Object -First 1
        if ($firstTunnel) {
            return [string]$firstTunnel.public_url
        }
    } catch {
        return $null
    }

    return $null
}

Write-Section "CodeRemote Quick Start"

try {
    $nodeVersion = (& node --version).Trim()
    Write-Host ("[OK] Node.js: {0}" -f $nodeVersion) -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js was not found. Install Node.js 18+ first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $cliDir "dist\\index.js"))) {
    Write-Host "[ERROR] Missing cli\\dist\\index.js" -ForegroundColor Red
    Write-Host "Run: cd cli && npm run build" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path (Join-Path $chatUiDistDir "index.html"))) {
    Write-Host "[ERROR] Missing chat-ui\\dist\\index.html" -ForegroundColor Red
    Write-Host "Run: cd chat-ui && npm run build" -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/3] Cleaning up port 8085..." -ForegroundColor Yellow
Stop-ProcessesOnPort -Port $serverPort

Write-Host "[2/3] Starting CodeRemote server (HTTP + WebSocket on port 8085)..." -ForegroundColor Yellow
$serverCommand = "cd /d `"$cliDir`" && node dist/index.js start -p $serverPort -t $serverToken"
$serverProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $serverCommand -WindowStyle Minimized -PassThru
Write-Host ("[OK] Started CodeRemote server launcher (PID {0})" -f $serverProcess.Id) -ForegroundColor Green

Start-Sleep -Seconds 4

Write-Host "[3/3] Reading tunnel metadata..." -ForegroundColor Yellow
$publicHttpUrl = Get-TunnelPublicUrl
$publicWsUrl = $null
if ($publicHttpUrl) {
    $publicWsUrl = $publicHttpUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
}

Write-Section "Services Started"
Write-Host ("Local UI:         {0}" -f $localHttpUrl) -ForegroundColor White
Write-Host ("Local WebSocket:  {0}" -f $localWsUrl) -ForegroundColor White
Write-Host ("Token:            {0}" -f $serverToken) -ForegroundColor White
Write-Host ("Default Remote WS:{0}{1}" -f ($(if ($defaultRemoteWsUrl.Length -lt 24) { " " } else { "" })), $defaultRemoteWsUrl) -ForegroundColor White

if ($publicHttpUrl -and $publicWsUrl) {
    Write-Host ("Tunnel HTTP:      {0}" -f $publicHttpUrl) -ForegroundColor Green
    Write-Host ("Tunnel WebSocket: {0}" -f $publicWsUrl) -ForegroundColor Green
} else {
    Write-Host "[WARN] Tunnel metadata not available at http://127.0.0.1:4040." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "The server keeps running in a separate window." -ForegroundColor Cyan
Write-Host "Open the local UI in your browser to start testing." -ForegroundColor Cyan

try {
    Start-Process $localHttpUrl | Out-Null
} catch {
    Write-Host ("[WARN] Failed to open browser automatically: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}
