@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo      KORAT KPI APP - BUILD ^& DEPLOY SCRIPT
echo ===================================================
echo.

echo [1/5] Force cleaning up old distribution artifacts...
echo      -^> Targeting 'frontend\dist'...
del /f /q frontend\dist 2>nul
rd /s /q frontend\dist 2>nul
echo      -^> Targeting 'api\dist'...
del /f /q api\dist 2>nul
rd /s /q api\dist 2>nul
echo      -^> Cleanup complete.
echo.

set FRONTEND_OK=0
set API_OK=0

echo [2/5] Building Frontend Application ^(Angular^)...
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo !-- FRONTEND BUILD FAILED --!
    cd ..
    goto :summary
)
set FRONTEND_OK=1
cd ..
echo      -^> Frontend build successful.
echo.

echo [3/5] Building API Application ^(Node.js^)...
cd api
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo !-- API BUILD FAILED --!
    cd ..
    goto :summary
)
set API_OK=1
cd ..
echo      -^> API build successful.
echo.

:summary
echo.
echo ===================================================
echo      BUILD STATUS SUMMARY
echo ===================================================
echo.

REM --- Frontend Status ---
if %FRONTEND_OK%==1 (
    echo   [OK] Frontend ^(Angular^)
    if exist "frontend\dist\browser\index.html" (
        echo        -^> Output : frontend\dist\browser\
        for /f %%A in ('dir /s /b "frontend\dist\browser" 2^>nul ^| find /c /v ""') do echo        -^> Files  : %%A files
    ) else (
        echo        -^> Output : frontend\dist\
    )
) else (
    echo   [FAIL] Frontend ^(Angular^) - Build failed!
)
echo.

REM --- API Status ---
if %API_OK%==1 (
    echo   [OK] API ^(Node.js^)
    if exist "api\dist\server.js" (
        echo        -^> Output : api\dist\server.js
    ) else (
        echo        -^> Output : api\dist\
    )
) else (
    echo   [FAIL] API ^(Node.js^) - Build failed!
)
echo.

REM --- Config Status ---
echo   --- Configuration ---
if exist ".env" (
    echo   [OK] .env file found
) else (
    echo   [!!] .env file NOT FOUND - copy from .env.example
)
echo.

REM --- If build failed, stop here ---
if %FRONTEND_OK%==0 goto :buildfailed
if %API_OK%==0 goto :buildfailed

REM --- [4/5] Deploy to Docker ---
echo ===================================================
echo [4/5] Deploying to Docker ^(background mode^)...
echo ===================================================
echo.

docker compose up -d --build
if %errorlevel% neq 0 (
    echo.
    echo   [FAIL] Docker deploy failed!
    goto :buildfailed
)
echo.

REM --- [5/5] Final Status ---
echo ===================================================
echo [5/5] Verifying containers...
echo ===================================================
echo.
docker compose ps
echo.
echo ===================================================
echo   [DONE] Deploy successful!
echo   Frontend : http://localhost:8808
echo   API      : http://localhost:8809
echo ===================================================
echo.

endlocal
goto :eof

:buildfailed
echo ===================================================
echo   [NOT READY] Fix the errors above before deploying.
echo ===================================================
echo.
endlocal
exit /b 1
