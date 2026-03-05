# CodeRemote 一键启动脚本 (PowerShell)
# 需要以管理员权限运行

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CodeRemote 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
try {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[错误] 未找到 Node.js，请先安装 Node.js 18+" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

# 安装 CLI 依赖
Write-Host "[1/5] 安装 CLI 依赖..." -ForegroundColor Yellow
Set-Location "$projectRoot\cli"
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] CLI 依赖安装失败" -ForegroundColor Red
        exit 1
    }
}

# 构建 CLI
Write-Host "[2/5] 构建 CLI..." -ForegroundColor Yellow
npm run build | Out-Null

# 检查 ngrok
Write-Host "[3/5] 检查 ngrok..." -ForegroundColor Yellow
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
    Write-Host "     安装 ngrok 中..." -ForegroundColor Yellow
    winget install --id Ngrok.Ngrok --source winget -h --accept-package-agreements --accept-source-agreements | Out-Null

    # 刷新环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    $ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
    if (-not $ngrokPath) {
        Write-Host "[警告] ngrok 安装失败，请手动安装" -ForegroundColor Red
    }
}

# 检查 ngrok authtoken
$ngrokConfig = "$env:USERPROFILE\AppData\Local\ngrok\ngrok.yml"
if (-not (Test-Path $ngrokConfig)) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  首次使用需要配置 ngrok" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "1. 访问 https://dashboard.ngrok.com/signup 注册免费账户" -ForegroundColor White
    Write-Host "2. 获取 authtoken" -ForegroundColor White
    Write-Host ""
    $token = Read-Host "请输入 ngrok authtoken (如果没有可跳过)"
    if ($token) {
        ngrok config add-authtoken $token

        # 更新 ngrok
        Write-Host "     更新 ngrok 中..." -ForegroundColor Yellow
        ngrok update 2>$null
        Write-Host "     ngrok 配置完成" -ForegroundColor Green
    }
}

# 启动 HTTP 服务器
Write-Host "[4/5] 启动 HTTP 服务器 (端口 8084)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot\web'; npx http-server -p 8084 -c-1" -WindowStyle Normal

# 等待 HTTP 服务器
Start-Sleep -Seconds 2

# 启动 CLI 服务器
Write-Host "[5/5] 启动 WebSocket 服务器 (端口 8085)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot\cli'; npx code-remote start --port 8085" -WindowStyle Normal

# 等待 CLI 服务器
Start-Sleep -Seconds 3

# 启动 ngrok 隧道
Write-Host ""
Write-Host "启动 ngrok 隧道..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "ngrok http 8085" -WindowStyle Normal

# 等待 ngrok 启动
Start-Sleep -Seconds 8

# 获取 ngrok URL
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   启动完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "本地测试: http://localhost:8084/cr-debug.html" -ForegroundColor White
Write-Host ""

try {
    $tunnels = Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -ErrorAction Stop
    $url = $tunnels.tunnels[0].public_url

    Write-Host "外网地址: $url" -ForegroundColor Green
    Write-Host "WebSocket: $($url -replace '^https://', 'wss://')" -ForegroundColor Green
    Write-Host ""
    Write-Host "Token: 启动 CLI 后显示" -ForegroundColor White
} catch {
    Write-Host "ngrok 隧道可能还在启动中..." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "按回车打开浏览器测试"
Start-Process "http://localhost:8084/cr-debug.html"

Write-Host ""
Write-Host "服务已在后台运行" -ForegroundColor Cyan
Write-Host "关闭所有 PowerShell 窗口即可停止服务" -ForegroundColor Cyan
