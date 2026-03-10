@echo off
echo Stopping CodeRemote services...

:: Kill server on port 8085
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8085.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1

:: Kill ngrok
taskkill /IM ngrok.exe /F >nul 2>&1

echo Services stopped.
