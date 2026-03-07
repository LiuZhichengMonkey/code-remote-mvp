@echo off
chcp 65001 >nul
echo.
echo ========================================
echo     CodeRemote 一键启动
echo ========================================
echo.

cd /d %~dp0

echo [1/2] 启动 WebSocket 服务器 (端口 8085)...
start "CodeRemote-WS" cmd /c "cd /d %~dp0cli && node dist/index.js start -p 8085 -t test123 --no-tunnel"

timeout /t 2 >nul

echo [2/2] 启动 HTTP 服务器 (端口 3000)...
start "CodeRemote-HTTP" cmd /c "cd /d %~dp0web && npx serve -p 3000"

echo.
echo 服务启动完成！
echo.
echo 访问地址:
echo   http://localhost:3000/cr-debug.html
echo   http://192.168.5.23:3000/cr-debug.html
echo.
echo Token: test123
echo.
echo 按任意键打开浏览器...
pause >nul
start http://localhost:3000/cr-debug.html
