@echo off
setlocal enabledelayedexpansion
title Not-ify Dev Manager
cd /d "%~dp0"

if "%1"=="" goto menu
if /i "%1"=="start" goto start
if /i "%1"=="stop" goto stop
if /i "%1"=="restart" goto restart
if /i "%1"=="status" goto status
goto menu

:menu
cls
echo.
echo  ============================================
echo   Not-ify Dev Manager
echo  ============================================
echo.
echo   1. Start all services
echo   2. Stop all services
echo   3. Restart all services
echo   4. Status check
echo   5. Exit
echo.
set /p choice="  Select: "
if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto restart
if "%choice%"=="4" goto status
if "%choice%"=="5" exit /b 0
goto menu

:status
echo.
echo  --- Service Status ---
echo.

REM Check server
curl -s http://localhost:3000/api/health >nul 2>&1
if %errorlevel%==0 (
    for /f "delims=" %%v in ('curl -s http://localhost:3000/api/health 2^>nul ^| node -e "process.stdin.on(\"data\",d=>{try{console.log(JSON.parse(d).version)}catch{console.log(\"?\")}})"') do set ver=%%v
    echo   [32m■[0m  Server        :3000  v!ver!
) else (
    echo   [31m■[0m  Server        :3000  DOWN
)

REM Check client
curl -s http://localhost:5173 >nul 2>&1
if %errorlevel%==0 (
    echo   [32m■[0m  Client        :5173  OK
) else (
    echo   [31m■[0m  Client        :5173  DOWN
)

REM Check slskd
curl -s http://localhost:5030/api/v0/application -H "X-API-Key: %SLSKD_API_KEY%" >nul 2>&1
if %errorlevel%==0 (
    echo   [32m■[0m  slskd         :5030  OK
) else (
    docker ps --filter name=notify-slskd -q >nul 2>&1
    for /f %%c in ('docker ps --filter name=notify-slskd -q 2^>nul') do set slskd_running=%%c
    if defined slskd_running (
        echo   [33m■[0m  slskd         :5030  CONTAINER UP, API NOT READY
    ) else (
        echo   [31m■[0m  slskd         :5030  DOWN
    )
)

REM Check Ollama
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel%==0 (
    echo   [32m■[0m  Ollama        :11434 OK
) else (
    echo   [31m■[0m  Ollama        :11434 DOWN
)

echo.
if "%1"=="status" exit /b 0
pause
goto menu

:start
echo.
echo  --- Starting Services ---
echo.

REM Start slskd container
echo   Starting slskd...
docker start notify-slskd-1 >nul 2>&1
if %errorlevel%==0 (
    echo   [32m✓[0m  slskd container started
) else (
    echo   [33m![0m  slskd container not found or already running
)

REM Start Ollama container
echo   Starting Ollama...
docker start ollama >nul 2>&1
if %errorlevel%==0 (
    echo   [32m✓[0m  Ollama container started
) else (
    echo   [33m![0m  Ollama container not found or already running
)

REM Wait for Docker services
timeout /t 3 /nobreak >nul

REM Start server in background
echo   Starting server on :3000...
start "Not-ify Server" /min cmd /c "cd /d %~dp0 && npm run dev:server"
echo   [32m✓[0m  Server starting...

REM Wait for server to be ready
echo   Waiting for server...
for /l %%i in (1,1,15) do (
    curl -s http://localhost:3000/api/health >nul 2>&1
    if !errorlevel!==0 (
        echo   [32m✓[0m  Server ready
        goto server_ready
    )
    timeout /t 2 /nobreak >nul
)
echo   [33m![0m  Server slow to start, continuing...
:server_ready

REM Start client in background
echo   Starting client on :5173...
start "Not-ify Client" /min cmd /c "cd /d %~dp0 && npm run dev:client"
echo   [32m✓[0m  Client starting...

timeout /t 3 /nobreak >nul

echo.
echo  --- All services started ---
echo.
echo   Server:  http://localhost:3000
echo   Client:  http://localhost:5173
echo   slskd:   http://localhost:5030
echo.

if "%1"=="start" exit /b 0
pause
goto menu

:stop
echo.
echo  --- Stopping Services ---
echo.

REM Kill Node processes on ports
echo   Stopping server...
npx kill-port 3000 >nul 2>&1
echo   [32m✓[0m  Server stopped

echo   Stopping client...
npx kill-port 5173 >nul 2>&1
echo   [32m✓[0m  Client stopped

REM Stop Docker containers
echo   Stopping slskd...
docker stop notify-slskd-1 >nul 2>&1
echo   [32m✓[0m  slskd stopped

echo   Stopping Ollama...
docker stop ollama >nul 2>&1
echo   [32m✓[0m  Ollama stopped

REM Kill any lingering minimized cmd windows
taskkill /fi "WINDOWTITLE eq Not-ify Server" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Not-ify Client" /f >nul 2>&1

echo.
echo  --- All services stopped ---
echo.
if "%1"=="stop" exit /b 0
pause
goto menu

:restart
call :stop
timeout /t 2 /nobreak >nul
call :start
goto :eof
