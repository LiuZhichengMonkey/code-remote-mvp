@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title CodeRemote Services

:: ========================================
:: Configuration
:: ========================================
set NGROK_PATH=C:\Users\TheCheng\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe
set BACKEND_PORT=8085
set FRONTEND_PORT=5173
set TOKEN=test123
set MAX_RETRIES=3
set BACKEND_LOG=%temp%\coderemote_backend.log
set FRONTEND_LOG=%temp%\coderemote_frontend.log
set BACKEND_RUNNER=%temp%\coderemote_backend_runner.cmd
set FRONTEND_RUNNER=%temp%\coderemote_frontend_runner.cmd
set NGROK_RUNNER=%temp%\coderemote_ngrok_runner.cmd
set WORKSPACE_ROOT=%~dp0

cd /d %~dp0

if "%WORKSPACE_ROOT:~-1%"=="\" set WORKSPACE_ROOT=%WORKSPACE_ROOT:~0,-1%

if exist "%BACKEND_LOG%" del /q "%BACKEND_LOG%" >nul 2>&1
if exist "%FRONTEND_LOG%" del /q "%FRONTEND_LOG%" >nul 2>&1
if exist "%BACKEND_RUNNER%" del /q "%BACKEND_RUNNER%" >nul 2>&1
if exist "%FRONTEND_RUNNER%" del /q "%FRONTEND_RUNNER%" >nul 2>&1
if exist "%NGROK_RUNNER%" del /q "%NGROK_RUNNER%" >nul 2>&1

echo.
echo ========================================
echo   CodeRemote Services Launcher
echo ========================================
echo.

:: ========================================
:: Step 1: Force Kill ALL Existing Processes
:: ========================================
echo [1/6] Force killing all existing processes...

:: Kill ALL node processes running our services (by command line pattern)
echo   Killing all CodeRemote backend processes...
for /f "tokens=2" %%a in ('wmic process where "commandline like '%%dist/index.js start%%'" get processid 2^>nul ^| findstr /r "[0-9]"') do (
    echo   - Killing node process %%a
    taskkill /PID %%a /F >nul 2>&1
)

:: Kill processes on specific ports (backup method)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT%.*LISTENING"') do (
    echo   - Killing process on port %BACKEND_PORT%: %%a
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%FRONTEND_PORT%.*LISTENING"') do (
    echo   - Killing process on port %FRONTEND_PORT%: %%a
    taskkill /PID %%a /F >nul 2>&1
)

:: Kill ngrok
echo   Killing ngrok processes...
taskkill /IM ngrok.exe /F >nul 2>&1

:: Wait for processes to fully terminate
echo   Waiting for processes to terminate...
timeout /t 3 /nobreak >nul

:: Verify ports are free
set PORTS_FREE=1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT%.*LISTENING"') do (
    echo   [WARN] Port %BACKEND_PORT% still in use by process %%a
    set PORTS_FREE=0
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%FRONTEND_PORT%.*LISTENING"') do (
    echo   [WARN] Port %FRONTEND_PORT% still in use by process %%a
    set PORTS_FREE=0
)

if "%PORTS_FREE%"=="0" (
    echo   [ERROR] Required ports are still occupied after cleanup
    echo   [ERROR] Please close the old launcher window or stop the conflicting process first
    goto :error_exit
)

echo   [OK] Cleanup complete

:: ========================================
:: Step 2: Build Backend
:: ========================================
echo.
echo [2/6] Building backend...

pushd %~dp0cli
call npm run build > %temp%\coderemote_cli_build.log 2>&1
if errorlevel 1 (
    echo   [ERROR] Backend build failed
    type %temp%\coderemote_cli_build.log
    popd
    goto :error_exit
)
popd
echo   [OK] Backend build complete

:: ========================================
:: Step 3: Start Backend Server
:: ========================================
echo.
echo [3/6] Starting backend server with token '%TOKEN%'...

set BACKEND_STARTED=0
set BACKEND_PID=

for /L %%i in (1,1,%MAX_RETRIES%) do (
    echo   Attempt %%i/%MAX_RETRIES%...

    if exist "%BACKEND_LOG%" del /q "%BACKEND_LOG%" >nul 2>&1
    call :write_backend_runner
    wmic process call create "\"%BACKEND_RUNNER%\"" >nul 2>&1

    call :wait_for_backend
    if "!BACKEND_STARTED!"=="1" goto :backend_verify

    echo   [WARN] Backend did not become healthy on attempt %%i
)

:backend_verify
if %BACKEND_STARTED%==0 (
    echo   [ERROR] Backend failed to start after %MAX_RETRIES% attempts
    if exist "%BACKEND_LOG%" (
        echo   [INFO] Backend log:
        type "%BACKEND_LOG%"
    )
    goto :error_exit
)

echo   [OK] Backend started and responding (PID: %BACKEND_PID%)

:: ========================================
:: Step 4: Start Frontend Server
:: ========================================
echo.
echo [4/6] Starting frontend server...

set FRONTEND_STARTED=0

for /L %%i in (1,1,%MAX_RETRIES%) do (
    echo   Attempt %%i/%MAX_RETRIES%...

    if exist "%FRONTEND_LOG%" del /q "%FRONTEND_LOG%" >nul 2>&1
    call :write_frontend_runner
    wmic process call create "\"%FRONTEND_RUNNER%\"" >nul 2>&1

    call :wait_for_frontend
    if "!FRONTEND_STARTED!"=="1" goto :frontend_done

    echo   [WARN] Frontend did not become ready on attempt %%i
)

:frontend_done
if %FRONTEND_STARTED%==0 (
    echo   [ERROR] Frontend failed to start after %MAX_RETRIES% attempts
    if exist "%FRONTEND_LOG%" (
        echo   [INFO] Frontend log:
        type "%FRONTEND_LOG%"
    )
    goto :error_exit
)
echo   [OK] Frontend started on port %FRONTEND_PORT%

:: ========================================
:: Step 5: Start Ngrok Tunnel
:: ========================================
echo.
echo [5/6] Starting ngrok tunnel...

set NGROK_STARTED=0

for /L %%i in (1,1,%MAX_RETRIES%) do (
    echo   Attempt %%i/%MAX_RETRIES%...

    call :write_ngrok_runner
    wmic process call create "\"%NGROK_RUNNER%\"" >nul 2>&1

    :: Wait for ngrok to start
    timeout /t 5 /nobreak >nul

    curl -s http://127.0.0.1:4040/api/tunnels > %temp%\ngrok_check.json 2>nul
    findstr "public_url" %temp%\ngrok_check.json >nul 2>&1
    if !errorlevel!==0 (
        set NGROK_STARTED=1
        goto :ngrok_done
    )
)

:ngrok_done
if %NGROK_STARTED%==0 (
    echo   [WARN] Ngrok failed to start - tunnel URL will not be available
    set TUNNEL_URL=Not available
    set TUNNEL_WSS=Not available
) else (
    echo   [OK] Ngrok tunnel started

    :: Get tunnel URL
    curl -s http://127.0.0.1:4040/api/tunnels > %temp%\ngrok.json 2>nul
    set TUNNEL_URL=
    for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "$t=((Get-Content '%temp%\ngrok.json' -Raw | ConvertFrom-Json).tunnels | Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1 -ExpandProperty public_url); if ($t) { $t }"`) do (
        set TUNNEL_URL=%%a
    )
    if defined TUNNEL_URL (
        set TUNNEL_WSS=!TUNNEL_URL:https://=wss://!
    ) else (
        set TUNNEL_URL=Not available
        set TUNNEL_WSS=Not available
    )
)

:: ========================================
:: Step 6: Verify WebSocket Connection
:: ========================================
echo.
echo [6/6] Verifying services...

:: Test WebSocket authentication via ngrok tunnel
if %NGROK_STARTED%==1 (
    echo   Testing WebSocket connection through tunnel...

    :: Create a simple test script
    echo const WebSocket = require('ws'); > %temp%\ws_test.js
    echo const ws = new WebSocket('%TUNNEL_WSS%'); >> %temp%\ws_test.js
    echo ws.on('open', () =^> { >> %temp%\ws_test.js
    echo   ws.send(JSON.stringify({type: 'auth', token: '%TOKEN%'})); >> %temp%\ws_test.js
    echo }); >> %temp%\ws_test.js
    echo ws.on('message', (data) =^> { >> %temp%\ws_test.js
    echo   const msg = JSON.parse(data.toString()); >> %temp%\ws_test.js
    echo   if (msg.type === 'auth_success') { >> %temp%\ws_test.js
    echo     console.log('AUTH_SUCCESS'); >> %temp%\ws_test.js
    echo     process.exit(0); >> %temp%\ws_test.js
    echo   } else if (msg.type === 'auth_failed') { >> %temp%\ws_test.js
    echo     console.log('AUTH_FAILED'); >> %temp%\ws_test.js
    echo     process.exit(1); >> %temp%\ws_test.js
    echo   } >> %temp%\ws_test.js
    echo }); >> %temp%\ws_test.js
    echo ws.on('error', (err) =^> { >> %temp%\ws_test.js
    echo   console.log('ERROR:', err.message); >> %temp%\ws_test.js
    echo   process.exit(1); >> %temp%\ws_test.js
    echo }); >> %temp%\ws_test.js
    echo setTimeout(() =^> { console.log('TIMEOUT'); process.exit(1); }, 5000); >> %temp%\ws_test.js

    :: Run the test
    cd /d %~dp0cli
    node %temp%\ws_test.js > %temp%\ws_result.txt 2>&1
    set /p WS_RESULT=<%temp%\ws_result.txt

    if "!WS_RESULT!"=="AUTH_SUCCESS" (
        echo   [OK] WebSocket authentication successful
    ) else (
        echo   [WARN] WebSocket test result: !WS_RESULT!
        echo   [WARN] Token may not match - check server logs
    )

    :: Cleanup
    del %temp%\ws_test.js >nul 2>&1
    del %temp%\ws_result.txt >nul 2>&1
)

:: ========================================
:: Summary
:: ========================================
echo.
echo ========================================
echo   Services Started Successfully!
echo ========================================
echo.
echo   Backend:   ws://localhost:%BACKEND_PORT%
echo   Frontend:  http://localhost:%FRONTEND_PORT%
echo   Token:     %TOKEN%
echo.
if %NGROK_STARTED%==1 (
    echo   Tunnel:    %TUNNEL_URL%
    echo   WSS:       %TUNNEL_WSS%
    echo.
    echo   Connect from phone:
    echo     URL: %TUNNEL_WSS%
    echo     Token: %TOKEN%
) else (
    echo   Tunnel:    Not available
    echo.
    echo   Use local connection:
    echo     URL: ws://localhost:%BACKEND_PORT%
    echo     Token: %TOKEN%
)
echo.
echo ========================================
echo   Press any key to stop all services...
echo ========================================
pause >nul

:: ========================================
:: Cleanup on exit
:: ========================================
echo.
echo Stopping services...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT%.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%FRONTEND_PORT%.*LISTENING"') do taskkill /PID %%a /F >nul 2>&1
taskkill /IM ngrok.exe /F >nul 2>&1
if exist "%BACKEND_RUNNER%" del /q "%BACKEND_RUNNER%" >nul 2>&1
if exist "%FRONTEND_RUNNER%" del /q "%FRONTEND_RUNNER%" >nul 2>&1
if exist "%NGROK_RUNNER%" del /q "%NGROK_RUNNER%" >nul 2>&1
echo Done.
exit /b 0

:: ========================================
:: Runner Helpers
:: ========================================
:write_backend_runner
(
    echo @echo off
    echo cd /d "%~dp0cli"
    echo node dist/index.js start --port %BACKEND_PORT% --token %TOKEN% --workspace "%WORKSPACE_ROOT%" --no-tunnel ^> "%BACKEND_LOG%" 2^>^&1
) > "%BACKEND_RUNNER%"
goto :eof

:write_frontend_runner
(
    echo @echo off
    echo cd /d "%~dp0chat-ui"
    echo call "%~dp0chat-ui\node_modules\.bin\vite.cmd" --port %FRONTEND_PORT% --host 0.0.0.0 ^> "%FRONTEND_LOG%" 2^>^&1
) > "%FRONTEND_RUNNER%"
goto :eof

:write_ngrok_runner
(
    echo @echo off
    echo "%NGROK_PATH%" http %BACKEND_PORT%
) > "%NGROK_RUNNER%"
goto :eof

:: ========================================
:: Wait Helpers
:: ========================================
:wait_for_backend
set BACKEND_STARTED=0
set BACKEND_PID=
for /L %%j in (1,1,12) do (
    timeout /t 1 /nobreak >nul
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT%.*LISTENING"') do (
        set BACKEND_PID=%%a
    )
    if exist "%temp%\backend_health.txt" del /q "%temp%\backend_health.txt" >nul 2>&1
    curl -s -o nul -w "%%{http_code}" http://localhost:%BACKEND_PORT%/health > %temp%\backend_health.txt 2>nul
    set HEALTH_CODE=
    if exist "%temp%\backend_health.txt" set /p HEALTH_CODE=<%temp%\backend_health.txt
    if "!HEALTH_CODE!"=="200" (
        set BACKEND_STARTED=1
        goto :eof
    )
)
goto :eof

:wait_for_frontend
set FRONTEND_STARTED=0
for /L %%j in (1,1,12) do (
    timeout /t 1 /nobreak >nul
    if exist "%temp%\frontend_health.txt" del /q "%temp%\frontend_health.txt" >nul 2>&1
    curl -s -o nul -w "%%{http_code}" http://localhost:%FRONTEND_PORT%/ > %temp%\frontend_health.txt 2>nul
    set FRONTEND_CODE=
    if exist "%temp%\frontend_health.txt" set /p FRONTEND_CODE=<%temp%\frontend_health.txt
    if "!FRONTEND_CODE!"=="200" (
        set FRONTEND_STARTED=1
        goto :eof
    )
)
goto :eof

:: ========================================
:: Error Exit
:: ========================================
:error_exit
echo.
echo ========================================
echo   [ERROR] Failed to start services
echo ========================================
echo.
echo   Please check:
echo   1. Port %BACKEND_PORT% and %FRONTEND_PORT% are not in use
echo   2. Node.js is installed
echo   3. npm install has been run in cli and chat-ui directories
echo.
pause
exit /b 1
