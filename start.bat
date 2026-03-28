@echo off
title Notify - Music Server
echo Starting Notify...
echo.

:: Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker Desktop is not running. Starting it...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo Waiting for Docker to be ready...
    :wait
    docker info >nul 2>&1
    if errorlevel 1 (
        timeout /t 2 /nobreak >nul
        goto wait
    )
    echo Docker is ready.
    echo.
)

cd /d "%~dp0"
docker compose up --build -d
if errorlevel 1 (
    echo.
    echo Build failed! Check the output above.
    pause
    exit /b 1
)

echo.
echo ==============================
echo   Notify is running!
echo   http://localhost:3000
echo ==============================
echo.
echo Press any key to open in browser...
pause >nul
start http://localhost:3000
