@echo off
REM ================================================================
REM SMOKE TEST — 1 VU, 30 saniye
REM Amac: Site ayakta mi? k6 dogru calisiyor mu?
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   SMOKE TEST baslatiliyor...
echo =====================================================
echo.

k6 run scenarios/01-smoke.js

echo.
echo Rapor: reports/ klasorunde HTML dosyasini acin
echo.
pause