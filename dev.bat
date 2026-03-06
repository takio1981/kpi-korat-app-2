@echo off
setlocal

echo ===================================================
echo   KORAT KPI APP - DEVELOPMENT MODE
echo ===================================================
echo.

REM --- Kill existing dev processes first ---
echo [0/2] Closing previous dev servers...

REM Kill process on port 3000 (API nodemon)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo      -^> Stopping API on port 3000 ^(PID: %%a^)
    taskkill /F /PID %%a >nul 2>&1
)

REM Kill process on port 4200 (Frontend ng serve)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4200 " ^| findstr "LISTENING"') do (
    echo      -^> Stopping Frontend on port 4200 ^(PID: %%a^)
    taskkill /F /PID %%a >nul 2>&1
)

REM Close old dev terminal windows by title
taskkill /FI "WINDOWTITLE eq KORAT-KPI-API [DEV :3000]*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq KORAT-KPI-FRONTEND [DEV :4200]*" /F >nul 2>&1

echo      -^> Cleanup complete.
echo.

REM --- Start API with nodemon on port 3000 (new window) ---
echo [1/2] Starting API with nodemon on port 3000...
start "KORAT-KPI-API [DEV :3000]" cmd /k "cd /d %~dp0api && npm run dev"

REM --- Start Frontend with ng serve using local config (new window) ---
echo [2/2] Starting Frontend with ng serve on port 4200...
start "KORAT-KPI-FRONTEND [DEV :4200]" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ===================================================
echo   Frontend : http://localhost:4200/kpikorat/  ^(ng serve^)
echo   API      : http://localhost:3000             ^(nodemon^)
echo   Docker   : http://localhost:8808/kpikorat/   ^(unchanged^)
echo.
echo   Press Ctrl+C in each window to stop.
echo ===================================================
echo.

endlocal
