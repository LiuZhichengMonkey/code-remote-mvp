@echo off
chcp 65001 >nul
title CodeRemote Launcher

echo.
echo ========================================
echo     CodeRemote Quick Start
echo ========================================
echo.

cd /d %~dp0

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found, please install Node.js first
    pause
    exit /b 1
)

:: Check dist folder
if not exist "%~dp0cli\dist\index.js" (
    echo [ERROR] cli\dist\index.js not found
    echo Please run: cd cli && npm run build
    pause
    exit /b 1
)

:: Kill existing processes on ports
echo [1/4] Cleaning up ports...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8085.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [2/4] Starting WebSocket server (port 8085)...
start "CodeRemote-WS" cmd /c "cd /d %~dp0cli && node dist/index.js start -p 8085 -t test123 --no-tunnel"

echo [3/4] Waiting 2 seconds...
ping 127.0.0.1 -n 3 >nul

echo [4/4] Starting HTTP server (port 3000)...
start "CodeRemote-HTTP" cmd /c "cd /d %~dp0chat-ui\dist && npx serve -p 3000"

echo.
echo ========================================
echo   Services started!
echo ========================================
echo.
echo   URL: http://localhost:3000
echo   Token: test123
echo.
echo   Press any key to open browser...
echo   (Closing this window will NOT stop services)
echo.
pause >nul

start http://localhost:3000
