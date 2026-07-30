@echo off
REM ================================================================
REM TUM TESTLERI SIRAYLA CALISTIR
REM Sira: smoke -^> load -^> stress -^> spike -^> breakpoint
REM Toplam sure: ~40 dakika
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   TUM TESTLER SIRAYLA CALISACAK
echo   Toplam sure: yaklasik 40 dakika
echo =====================================================
echo.
echo   1) Smoke Test    (30 sn)
echo   2) Load Test     (5 dk)
echo   3) Stress Test   (15 dk)
echo   4) Spike Test    (5 dk)
echo   5) Breakpoint    (13 dk)
echo.
set /p onay="Tum testleri calistirmak istiyor musunuz? (E/H): "
if /i not "%onay%"=="E" (
    echo Iptal edildi.
    pause
    exit /b
)

echo.
echo [1/5] SMOKE TEST baslatiliyor...
k6 run scenarios/01-smoke.js
if errorlevel 1 (
    echo SMOKE TEST BASARISIZ! Devam edilmeyecek.
    pause
    exit /b 1
)

echo.
echo [2/5] LOAD TEST baslatiliyor...
timeout /t 10
k6 run scenarios/02-load.js

echo.
echo [3/5] STRESS TEST baslatiliyor...
timeout /t 15
k6 run scenarios/03-stress.js

echo.
echo [4/5] SPIKE TEST baslatiliyor...
timeout /t 15
k6 run scenarios/04-spike.js

echo.
echo [5/5] BREAKPOINT TEST baslatiliyor...
timeout /t 15
k6 run scenarios/05-breakpoint.js

echo.
echo =====================================================
echo   TUM TESTLER TAMAMLANDI
echo   Raporlar: reports/ klasorunde
echo =====================================================
pause