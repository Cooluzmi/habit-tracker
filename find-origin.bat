@echo off
REM ================================================================
REM  Origin IP Finder — Kendi domain'in icin
REM ================================================================
chcp 65001 >nul
echo.
echo =====================================================
echo   ORIGIN IP FINDER
echo =====================================================
echo.

REM Python var mi kontrol
python --version >nul 2>&1
if errorlevel 1 (
    echo HATA: Python kurulu degil!
    echo Indirin: https://python.org/downloads/
    pause
    exit /b 1
)

set /p DOMAIN="Domain (ornek: senin-site.com): "
if "%DOMAIN%"=="" (
    echo Domain bos olamaz!
    pause
    exit /b
)

set /p VERIFY="Bulunan IP'leri dogrula? (E/H): "
set VERIFY_FLAG=
if /i "%VERIFY%"=="E" set VERIFY_FLAG=--verify

echo.
python "%~dp0origin-finder.py" --domain %DOMAIN% %VERIFY_FLAG%

echo.
pause