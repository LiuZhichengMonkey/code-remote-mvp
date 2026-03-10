@echo off
chcp 65001 >nul
title CodeRemote Services (Background)

cd /d %~dp0

:: Kill existing processes on ports
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8085.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 2 /nobreak >nul

:: Kill existing ngrok
taskkill /IM ngrok.exe /F >nul 2>&1

:: Start server in background (hidden)
start /b "" cmd /c "cd /d %~dp0cli && node dist/index.js start --port 8085 --token test123 >nul 2>&1"

:: Wait for server
timeout /t 5 /nobreak >nul

:: Start ngrok tunnel in background (hidden)
start /b "" cmd /c "ngrok http 8085 >nul 2>&1"

:: Wait for ngrok
timeout /t 8 /nobreak >nul

:: Get tunnel URL and save to file
curl -s http://127.0.0.1:4040/api/tunnels > %temp%\ngrok.json 2>nul
for /f "tokens=2 delims=:" %%a in ('type %temp%\ngrok.json ^| findstr "public_url"') do (
    set URL=%%a
    set URL=!URL:"=!
    set URL=!URL:,=!
    set URL=!URL: =!
    echo https:!URL! > "%~dp0tunnel-url.txt"
)

:: Done - don't wait, just exit
