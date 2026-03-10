@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CodeRemote Services

:: ngrok full path (for scheduled task compatibility)
set NGROK_PATH=C:\Users\TheCheng\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe

:: Wait for network to be ready (max 60 seconds, check every 2 seconds)
echo Checking network connectivity...
set NETWORK_READY=0
set WAIT_COUNT=0
set MAX_WAIT=30

:check_network
ping -n 1 -w 1000 8.8.8.8 >nul 2>&1
if %errorlevel%==0 (
    set NETWORK_READY=1
    echo Network is ready!
    goto :network_done
)
set /a WAIT_COUNT+=1
if %WAIT_COUNT% geq %MAX_WAIT% (
    echo Warning: Network check timeout after 60 seconds, continuing anyway...
    goto :network_done
)
echo Waiting for network... (%WAIT_COUNT%/%MAX_WAIT%)
timeout /t 2 /nobreak >nul
goto :check_network

:network_done

echo.
echo ========================================
echo   Starting CodeRemote Services (Background)
echo ========================================
echo.

cd /d %~dp0

:: Kill existing processes on ports
echo [1/4] Cleaning up ports...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8085.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 2 /nobreak >nul

:: Kill existing ngrok
taskkill /IM ngrok.exe /F >nul 2>&1

:: Start unified server (WebSocket + HTTP static files) in background
echo [2/4] Starting CodeRemote server...
start "CodeRemote-Server" /min cmd /c "cd /d %~dp0cli && node dist/index.js start --port 8085 --token test123"

:: Wait for server
timeout /t 5 /nobreak >nul

:: Start ngrok tunnel in background
echo [3/4] Starting ngrok tunnel...
start "CodeRemote-Ngrok" /min cmd /c ""%NGROK_PATH%" http 8085"

:: Wait for ngrok
timeout /t 8 /nobreak >nul

:: Get tunnel URL
echo.
echo ========================================
echo   Getting tunnel URL...
echo ========================================
echo.

curl -s http://127.0.0.1:4040/api/tunnels > %temp%\ngrok.json 2>nul
for /f "tokens=2 delims=:" %%a in ('type %temp%\ngrok.json ^| findstr "public_url"') do (
    set URL=%%a
    set URL=!URL:"=!
    set URL=!URL:,=!
    set URL=!URL: =!
    echo Tunnel URL: https:!URL!
    echo.
)

echo ========================================
echo   Services Started!
echo ========================================
echo.
echo   Local:    ws://localhost:8085
echo   HTTP:     http://localhost:8085
echo   Token:    test123
echo.
echo   Tunnel URL shown above
echo.
echo   Press Ctrl+C to stop all services...
echo ========================================
echo.

:: Keep running until user presses Ctrl+C
:: The processes will be killed when this window closes
pause >nul
