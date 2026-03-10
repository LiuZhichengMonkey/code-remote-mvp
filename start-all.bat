@echo off
chcp 65001 >nul
title CodeRemote Quick Start

cd /d %~dp0

echo ========================================
echo   CodeRemote Quick Start
echo ========================================
echo.

:: Clean up port 8085 only
echo [1/2] Cleaning port 8085...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8085.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
ping -n 2 127.0.0.1 >nul

:: Start unified server
echo [2/2] Starting CodeRemote server (WebSocket + HTTP)...
start "CodeRemote-Server" /min cmd /c "cd /d %~dp0cli && node dist/index.js start -p 8085 -t test123"
ping -n 5 127.0.0.1 >nul

:: Get ngrok URL
echo.
echo ========================================
echo   Getting tunnel URL...
echo ========================================

for /f "delims=" %%i in ('curl -s http://127.0.0.1:4040/api/tunnels 2^>nul ^| findstr "public_url"') do (
    echo %%i
)

echo.
echo ========================================
echo   Services Started!
echo ========================================
echo.
echo   Local WebSocket: ws://localhost:8085
echo   Local HTTP:      http://localhost:8085
echo   Token:           test123
echo.
echo   Open the tunnel URL above on your phone!
echo ========================================
echo.
echo Press any key to exit (services will keep running)...
pause >nul
