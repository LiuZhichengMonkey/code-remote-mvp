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
echo   Uninstall CodeRemote Auto-Start
echo ========================================
echo.

schtasks /delete /tn "CodeRemote-AutoStart" /f 2>nul

if %errorlevel%==0 (
    echo [SUCCESS] Auto-start task removed!
) else (
    echo [INFO] Task not found or already removed.
)

echo.
pause
