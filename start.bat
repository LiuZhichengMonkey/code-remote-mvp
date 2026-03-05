@echo off
chcp 65001 >nul
title CodeRemote 启动器

echo ========================================
echo    CodeRemote 一键启动
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

echo [1/5] 检查依赖...
cd /d "%~dp0cli"

:: 安装 CLI 依赖
if not exist "node_modules" (
    echo     安装 CLI 依赖中...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] CLI 依赖安装失败
        pause
        exit /b 1
    )
)

:: 构建 CLI
echo     构建 CLI 中...
call npm run build >nul 2>nul

:: 检查 ngrok
echo [2/5] 检查 ngrok...
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo     安装 ngrok 中...
    winget install --id Ngrok.Ngrok --source winget -h >nul 2>nul
    if %errorlevel% neq 0 (
        echo [警告] ngrok 安装失败，请手动安装
    )
)

:: 检查并配置 ngrok authtoken
echo [3/5] 配置 ngrok...
set NGROK_CONFIG=%USERPROFILE%\AppData\Local\ngrok\ngrok.yml
if not exist "%NGROK_CONFIG%" (
    echo.
    echo ========================================
    echo   首次使用需要配置 ngrok
    echo   请访问 https://dashboard.ngrok.com/signup 注册免费账户
    echo   获取 authtoken 后在此输入
    echo ========================================
    set /p NGROK_TOKEN=请输入 ngrok authtoken:
    if defined NGROK_TOKEN (
        ngrok config add-authtoken %NGROK_TOKEN%
        echo     ngrok 配置完成
    )
)

:: 启动 HTTP 服务器 (端口 8084)
echo [4/5] 启动 HTTP 服务器 (端口 8084)...
start "CodeRemote HTTP" cmd /k "cd /d "%~dp0web" && npx http-server -p 8084 -c-1"

:: 等待 HTTP 服务器启动
timeout /t 2 /nobreak >nul

:: 启动 CLI 服务器 (端口 8085)
echo [5/5] 启动 WebSocket 服务器 (端口 8085)...
start "CodeRemote CLI" cmd /k "cd /d "%~dp0cli" && npx code-remote start --port 8085"

:: 等待 CLI 服务器启动
timeout /t 3 /nobreak >nul

:: 启动 ngrok 隧道
echo.
echo 启动 ngrok 隧道...
start "CodeRemote Tunnel" cmd /k "ngrok http 8085"

:: 等待 ngrok 启动
timeout /t 5 /nobreak >nul

:: 获取 ngrok URL
echo.
echo ========================================
echo    启动完成！
echo ========================================
echo.
echo 访问以下地址测试：
echo   本地: http://localhost:8084/cr-debug.html
echo.
echo 等待 ngrok 隧道启动...
timeout /t 3 /nobreak >nul

:: 显示 ngrok URL
for /f "delims=" %%i in ('curl -s http://127.0.0.1:4040/api/tunnels ^| findstr "public_url"') do set TUNNEL_URL=%%i
if defined TUNNEL_URL (
    echo.
    echo 外网地址:
    echo %TUNNEL_URL:~17,-1%
    echo.
    echo 外网 WebSocket:
    echo wss:%TUNNEL_URL:~26,-1%
)

echo.
echo Token: 启动 CLI 后显示
echo.
echo 按任意键打开浏览器测试...
pause >nul

:: 打开浏览器
start http://localhost:8084/cr-debug.html

echo.
echo 服务已在后台运行
echo 关闭所有窗口即可停止服务
echo.
pause
