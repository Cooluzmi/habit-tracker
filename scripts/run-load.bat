@echo off
REM ================================================================
REM LOAD TEST — 100 VU, 5 dakika
REM Amac: Normal beklenen yuk altinda performans
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   LOAD TEST baslatiliyor (100 VU / 5 dakika)
echo =====================================================
echo.

k6 run scenarios/02-load.js

echo.
echo Rapor: reports/ klasorunde
echo.
pause