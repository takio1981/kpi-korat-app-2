@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo      KORAT KPI APP - BUILD ^& DEPLOY SCRIPT
echo ===================================================
echo.

REM --- Pre-flight: check .env ---
if not exist ".env" (
    echo [ERROR] .env file not found.
    echo         Copy from .env.example first.
    exit /b 1
)

REM --- Pre-flight: check Docker ---
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running.
    echo         Please start Docker Desktop and try again.
    exit /b 1
)

set FRONTEND_OK=0
set API_OK=0

REM =====================================================
echo [1/5] Cleaning old dist artifacts...
REM =====================================================
if exist "frontend\dist" rd /s /q "frontend\dist" >nul 2>&1
if exist "api\dist"      rd /s /q "api\dist"      >nul 2>&1
echo       Done.
echo.

REM =====================================================
echo [2/5] Building Frontend (Angular)...
REM =====================================================
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo [FAIL] Frontend build failed!
    cd ..
    goto :show_summary
)
set FRONTEND_OK=1
cd ..
echo       Frontend build OK.
echo.

REM =====================================================
echo [3/5] Building API (Node.js)...
REM =====================================================
cd api
call npm run build
if %errorlevel% neq 0 (
    echo [FAIL] API build failed!
    cd ..
    goto :show_summary
)
set API_OK=1
cd ..
echo       API build OK.
echo.

:show_summary
echo.
echo ===================================================
echo      BUILD STATUS SUMMARY
echo ===================================================
echo.
if %FRONTEND_OK%==1 (
    echo   [OK]   Frontend (Angular)
    if exist "frontend\dist\browser\index.html" (
        echo          Output : frontend\dist\browser\
    )
) else (
    echo   [FAIL] Frontend (Angular)
)
echo.
if %API_OK%==1 (
    echo   [OK]   API (Node.js)
    if exist "api\dist\server.js" echo          Output : api\dist\server.js
) else (
    echo   [FAIL] API (Node.js)
)
echo.
if exist ".env" (
    echo   [OK]   .env found
) else (
    echo   [!!]   .env NOT FOUND
)
echo.

if %FRONTEND_OK%==0 goto :build_failed
if %API_OK%==0      goto :build_failed

REM =====================================================
echo ===================================================
echo [4/5] Deploying to Docker...
echo ===================================================
echo.

REM Step A: Stop existing containers (graceful, keep volumes/networks)
echo   [A] Stopping containers...
docker compose stop
echo       Stopped.
echo.

REM Step B: Build Docker images (uses layer cache when code unchanged)
echo   [B] Building Docker images...
docker compose build --parallel
if %errorlevel% neq 0 (
    echo [FAIL] Docker image build failed!
    echo        Hint: run  docker compose build --no-cache
    goto :build_failed
)
echo       Images built.
echo.

REM Step C: Start with new images (--no-build = skip rebuild, already done above)
echo   [C] Starting containers...
docker compose up -d --force-recreate --no-build --remove-orphans
if %errorlevel% neq 0 (
    echo [FAIL] Containers failed to start!
    echo.
    echo --- api logs ---
    docker compose logs --tail=20 api
    goto :build_failed
)
echo       Containers started.
echo.

REM =====================================================
echo [5/5] Verifying containers...
REM =====================================================
timeout /t 5 /nobreak >nul
docker compose ps
echo.
echo ===================================================
echo   DEPLOY SUCCESSFUL!
echo.
echo   Frontend : http://localhost:8808/kpikorat/
echo   API      : http://localhost:8809/kpikorat/api/health
echo.
echo   Logs   : docker compose logs -f
echo   Status : docker compose ps
echo ===================================================
echo.
endlocal
goto :eof

:build_failed
echo.
echo ===================================================
echo   FAILED - Fix errors above before deploying.
echo ===================================================
echo.
endlocal
exit /b 1
