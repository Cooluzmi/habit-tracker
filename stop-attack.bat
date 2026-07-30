@echo off
REM ================================================================
REM  🛑 MULTI-ACCOUNT ATTACK STOPPER
REM  Her iki hesabin (Forest + Stranic000) calisan/kuyruk run'larini iptal eder
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

if exist "config\secrets.bat" (
    call config\secrets.bat
) else if exist "config\secrets.env" (
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

echo.
echo =====================================================
echo   MULTI-ACCOUNT TESTLERI DURDURUCU
echo =====================================================
echo.

REM ---- HESAP 1 ----
echo [Hesap 1] %GH1_USER%/%GH1_REPO% run'lari araniyor...
call :cancel_runs "%GH1_USER%" "%GH1_REPO%" "%GH1_TOKEN%"

REM ---- HESAP 2 (varsa) ----
if not "%GH2_WORKFLOW_ID%"=="" (
    echo.
    echo [Hesap 2] %GH2_USER%/%GH2_REPO% run'lari araniyor...
    call :cancel_runs "%GH2_USER%" "%GH2_REPO%" "%GH2_TOKEN%"
) else (
    echo.
    echo [Hesap 2] Setup edilmemis, atlaniyor.
)

echo.
echo =====================================================
echo   ISLEM TAMAM. Actions sekmesinden dogrulayin:
echo     https://github.com/%GH1_USER%/%GH1_REPO%/actions
if not "%GH2_WORKFLOW_ID%"=="" (
    echo     https://github.com/%GH2_USER%/%GH2_REPO%/actions
)
echo =====================================================
pause
exit /b 0

REM ================================================================
REM  SUBROUTINE: cancel_runs USER REPO TOKEN
REM ================================================================
:cancel_runs
set "USR=%~1"
set "REPO=%~2"
set "TOK=%~3"

REM Calisan run'lar
for /f "tokens=*" %%R in ('curl -sS -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=in_progress&per_page=20" ^| findstr /R "\"id\": [0-9]*,$"') do (
    set "LINE=%%R"
    for /f "tokens=2 delims=:," %%I in ("!LINE!") do (
        set "RUN_ID=%%I"
        set "RUN_ID=!RUN_ID: =!"
        echo   Durduruluyor (in_progress): !RUN_ID!
        curl -sS -X POST -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs/!RUN_ID!/cancel" -o nul
    )
)

REM Kuyruktakiler
for /f "tokens=*" %%R in ('curl -sS -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=queued&per_page=20" ^| findstr /R "\"id\": [0-9]*,$"') do (
    set "LINE=%%R"
    for /f "tokens=2 delims=:," %%I in ("!LINE!") do (
        set "RUN_ID=%%I"
        set "RUN_ID=!RUN_ID: =!"
        echo   Durduruluyor (queued): !RUN_ID!
        curl -sS -X POST -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs/!RUN_ID!/cancel" -o nul
    )
)

REM Bekleyen (waiting) run'lar
for /f "tokens=*" %%R in ('curl -sS -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=waiting&per_page=20" ^| findstr /R "\"id\": [0-9]*,$"') do (
    set "LINE=%%R"
    for /f "tokens=2 delims=:," %%I in ("!LINE!") do (
        set "RUN_ID=%%I"
        set "RUN_ID=!RUN_ID: =!"
        echo   Durduruluyor (waiting): !RUN_ID!
        curl -sS -X POST -H "Authorization: token %TOK%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%USR%/%REPO%/actions/runs/!RUN_ID!/cancel" -o nul
    )
)

exit /b 0