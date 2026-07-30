@echo off
REM ================================================================
REM STRESS TEST — 100 -> 500 -> 1000 VU / ~15 dakika
REM Amac: Yuksek yuk altinda kirilma sinirlarini gozlemek
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   STRESS TEST baslatiliyor (100 -^> 1000 VU / 15 dk)
echo   UYARI: Yuksek yuk! Sunucuyu monitor edin.
echo =====================================================
echo.
timeout /t 5

k6 run scenarios/03-stress.js

echo.
echo Rapor: reports/ klasorunde
echo.
pause