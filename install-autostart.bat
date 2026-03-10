@echo off
setlocal enabledelayedexpansion

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ========================================
echo   Install CodeRemote Auto-Start
echo ========================================
echo.

cd /d %~dp0

:: Create scheduled task
schtasks /create /tn "CodeRemote-AutoStart" /tr "\"%~dp0start-services.bat\"" /sc onlogon /rl highest /f

if %errorlevel%==0 (
    echo.
    echo [SUCCESS] Auto-start task installed!
    echo.
    echo CodeRemote will start automatically on next login.
    echo.
    echo Run uninstall-autostart.bat to remove.
) else (
    echo.
    echo [FAILED] Installation failed.
)

echo.
pause
