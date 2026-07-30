@echo off
REM ================================================================
REM  Anlik durum raporu - cift tikla, hedef site + bot durumu gelir
REM ================================================================
chcp 65001 >nul 2>&1
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0durum.ps1"
echo.
echo Cikmak icin bir tusa basin veya tekrar calistirmak icin yeniden cift tikla.
pause >nul