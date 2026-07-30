@echo off
REM ================================================================
REM  🛑 CALISAN LOAD TEST'LERI ACIL DURDUR
REM ================================================================
setlocal enabledelayedexpansion

set "GH_USER=Forest123456789"
set "GH_REPO=loadtest"
set "GH_TOKEN=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"

echo.
echo =====================================================
echo   CALISAN TESTLERI DURDURUCU
echo =====================================================
echo.

REM Calisan run'lari bul
echo Calisan workflow'lar araniyor...
echo.

for /f "tokens=*" %%R in ('curl -sS -H "Authorization: token %GH_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/runs?status=in_progress&per_page=10" ^| findstr /R "\"id\": [0-9]*,$"') do (
    set "LINE=%%R"
    for /f "tokens=2 delims=:," %%I in ("!LINE!") do (
        set "RUN_ID=%%I"
        set "RUN_ID=!RUN_ID: =!"
        echo Durduruluyor: run !RUN_ID!
        curl -sS -X POST -H "Authorization: token %GH_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/runs/!RUN_ID!/cancel" -o nul
        echo   -^> gonderildi
    )
)

REM Kuyrukta olan run'lari bul
for /f "tokens=*" %%R in ('curl -sS -H "Authorization: token %GH_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/runs?status=queued&per_page=10" ^| findstr /R "\"id\": [0-9]*,$"') do (
    set "LINE=%%R"
    for /f "tokens=2 delims=:," %%I in ("!LINE!") do (
        set "RUN_ID=%%I"
        set "RUN_ID=!RUN_ID: =!"
        echo Durduruluyor kuyruk: run !RUN_ID!
        curl -sS -X POST -H "Authorization: token %GH_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/runs/!RUN_ID!/cancel" -o nul
    )
)

echo.
echo =====================================================
echo   ISLEM TAMAM. Actions sekmesinden dogrulayin:
echo   https://github.com/%GH_USER%/%GH_REPO%/actions
echo =====================================================
pause