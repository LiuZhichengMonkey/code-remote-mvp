@echo off
chcp 65001 >nul
title CodeRemote Ngrok Launcher

cd /d %~dp0

:: Run the automated script
node start-ngrok.js

pause
