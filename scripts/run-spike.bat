@echo off
REM ================================================================
REM SPIKE TEST — Ani 2000 VU patlamasi
REM Amac: Ani trafik artislarina dayaniklilik
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   SPIKE TEST baslatiliyor (Ani 2000 VU!)
echo   UYARI: 10 saniyede 2000 kullaniciya cikar!
echo =====================================================
echo.
timeout /t 5

k6 run scenarios/04-spike.js

echo.
echo Rapor: reports/ klasorunde
echo.
pause