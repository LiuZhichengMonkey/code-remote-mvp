# CodeRemote 一键启动脚本 (PowerShell)

$ErrorActionPreference = "Continue"
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
npm run build 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] CLI 构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "     构建完成" -ForegroundColor Green

# 检查 ngrok
Write-Host "[3/5] 检查 ngrok..." -ForegroundColor Yellow

# 尝试多种方式找 ngrok
$ngrokPath = $null
$ngrokPaths = @(
    "ngrok",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
    "$env:ProgramFiles\ngrok\ngrok.exe",
    "$env:ProgramFiles(x86)\ngrok\ngrok.exe"
)

foreach ($path in $ngrokPaths) {
    if ($path -match "ngrok\.exe$") {
        if (Test-Path $path) {
            $ngrokPath = $path
            break
        }
    } else {
        $result = Get-Command $path -ErrorAction SilentlyContinue
        if ($result) {
            $ngrokPath = $result.Source
            break
        }
    }
}

if (-not $ngrokPath) {
    Write-Host "     ngrok 未安装，将跳过隧道功能" -ForegroundColor Yellow
    Write-Host "     如需外网访问，请手动安装 ngrok" -ForegroundColor Yellow
} else {
    Write-Host "     ngrok 已找到: $ngrokPath" -ForegroundColor Green

    # 检查 ngrok authtoken
    $ngrokConfig = "$env:USERPROFILE\AppData\Local\ngrok\ngrok.yml"
    if (-not (Test-Path $ngrokConfig)) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  首次使用需要配置 ngrok" -ForegroundColor Yellow
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "1. 访问 https://dashboard.ngrok.com/signup 注册" -ForegroundColor White
        Write-Host "2. 获取 authtoken" -ForegroundColor White
        Write-Host ""
        $token = Read-Host "请输入 ngrok authtoken (直接回车跳过)"
        if ($token) {
            & $ngrokPath config add-authtoken $token
            Write-Host "     ngrok 配置完成" -ForegroundColor Green
        }
    }
}

# 启动 HTTP 服务器
Write-Host "[4/5] 启动 HTTP 服务器 (端口 8084)..." -ForegroundColor Yellow
$httpJob = Start-Job -ScriptBlock {
    Set-Location $using:projectRoot\web
    npx http-server -p 8084 -c-1
} -Name "HTTP Server"

# 等待 HTTP 服务器
Start-Sleep -Seconds 3

# 启动 CLI 服务器
Write-Host "[5/5] 启动 WebSocket 服务器 (端口 8085)..." -ForegroundColor Yellow
$cliJob = Start-Job -ScriptBlock {
    Set-Location $using:projectRoot\cli
    npx code-remote start --port 8085
} -Name "CLI Server"

# 等待 CLI 服务器
Start-Sleep -Seconds 4

# 启动 ngrok 隧道 (如果可用)
if ($ngrokPath) {
    Write-Host ""
    Write-Host "启动 ngrok 隧道..." -ForegroundColor Yellow
    $tunnelJob = Start-Job -ScriptBlock {
        & $using:ngrokPath http 8085
    } -Name "ngrok Tunnel"

    # 等待 ngrok 启动
    Start-Sleep -Seconds 8
}

# 获取 ngrok URL
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   启动完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "本地测试: http://localhost:8084/cr-debug.html" -ForegroundColor White
Write-Host ""

if ($ngrokPath) {
    try {
        $tunnels = Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -ErrorAction Stop
        $url = $tunnels.tunnels[0].public_url

        Write-Host "外网地址: $url" -ForegroundColor Green
        $wsUrl = $url -replace '^https://', 'wss://'
        Write-Host "WebSocket: $wsUrl" -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host "ngrok 隧道启动中，请稍候..." -ForegroundColor Yellow
    }
}

Write-Host "Token: 请查看 CLI 服务器输出" -ForegroundColor White
Write-Host ""
Write-Host "服务已在后台运行" -ForegroundColor Cyan
Write-Host "运行 Stop-Job 可停止服务" -ForegroundColor Cyan
Write-Host ""

# 打开浏览器
Start-Sleep -Seconds 2
Start-Process "http://localhost:8084/cr-debug.html"

# 保持脚本运行
Write-Host "按 Ctrl+C 退出或关闭此窗口" -ForegroundColor Yellow
while ($true) {
    Start-Sleep -Seconds 10
}
