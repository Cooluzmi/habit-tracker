@echo off
REM ================================================================
REM  🎯 CANLI SALDIRI MONITORU (attack.bat'siz calisir)
REM  Aktif veya son workflow'u canli takip eder
REM ================================================================
chcp 65001 >nul
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor.ps1"
pause