@echo off
REM ================================================================
REM  🚀 DISTRIBUTED LOAD TEST BASLATICI (Grafik Monitor + Origin Bypass)
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

set "GH_USER=Forest123456789"
set "GH_REPO=loadtest"
set "GH_TOKEN=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"
set "WORKFLOW_ID=323847956"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   🎯 DISTRIBUTED LOAD TEST — HEDEF SEC              ║
echo ║   Hesap: %GH_USER%                          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM ---- HEDEF SITE MENUSU ----
echo   Kayitli hedefler:
echo.
echo     [1] https://hhh.frostai.com.tr
echo     [2] https://frostai.xyz
echo     [3] https://frostai.com.tr
echo     [4] Manuel URL gir (Cloudflare dahil normal)
echo     [5] 🎯 Origin IP saldirisi (Cloudflare BYPASS)
echo.
set /p SECIM="Hedef sec (1-5): "

set "HOST_HEADER="

if "%SECIM%"=="1" set "TARGET_URL=https://hhh.frostai.com.tr"
if "%SECIM%"=="2" set "TARGET_URL=https://frostai.xyz"
if "%SECIM%"=="3" set "TARGET_URL=https://frostai.com.tr"
if "%SECIM%"=="4" (
    set /p TARGET_URL="Hedef URL girin (https:// ile): "
)
if "%SECIM%"=="5" (
    echo.
    echo ╔══════════════════════════════════════════════════════╗
    echo ║   🎯 CLOUDFLARE BYPASS MODU                         ║
    echo ║   Origin IP'ye direkt saldiri + Host header spoof   ║
    echo ╚══════════════════════════════════════════════════════╝
    echo.
    echo   Uyari: SSL uyarisi ignore edilir ^(insecureSkipTLSVerify^)
    echo.
    set /p ORIGIN_IP="Origin IP (orn: 89.252.139.50): "
    set /p HOST_HEADER="Domain adi (Host header - orn: frostai.xyz): "
    if "!ORIGIN_IP!"=="" (
        echo Origin IP bos olamaz!
        pause
        exit /b 1
    )
    if "!HOST_HEADER!"=="" (
        echo Host header bos olamaz!
        pause
        exit /b 1
    )
    set "TARGET_URL=https://!ORIGIN_IP!"
    echo.
    echo   ✅ Target: !TARGET_URL!
    echo   ✅ Host header: !HOST_HEADER!
)

if "!TARGET_URL!"=="" (
    echo Gecersiz secim!
    pause
    exit /b 1
)

echo.
echo   ✅ Secilen hedef: !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   🎯 Cloudflare bypass MOD (Host: !HOST_HEADER!)
echo.

REM ---- YOGUNLUK MENUSU ----
echo   Test yogunlugu:
echo.
echo     [1] 🟢 Hafif   - 60s / 100 VU / 5 bot   (test amacli)
echo     [2] 🟡 Orta    - 120s / 300 VU / 20 bot (STANDART)
echo     [3] 🟠 Agresif - 5m / 500 VU / 20 bot   (guclu)
echo     [4] 🔴 Full    - 10m / 500 VU / 20 bot  (MAX YIKIM)
echo     [5] Manuel ayar
echo.
set /p YOGUNLUK="Yogunluk sec (1-5): "

if "%YOGUNLUK%"=="1" (
    set "DURATION=60s"
    set "VUS=100"
    set "JOBS=5"
    set "RPS=0"
) else if "%YOGUNLUK%"=="2" (
    set "DURATION=120s"
    set "VUS=300"
    set "JOBS=20"
    set "RPS=0"
) else if "%YOGUNLUK%"=="3" (
    set "DURATION=5m"
    set "VUS=500"
    set "JOBS=20"
    set "RPS=0"
) else if "%YOGUNLUK%"=="4" (
    set "DURATION=10m"
    set "VUS=500"
    set "JOBS=20"
    set "RPS=0"
) else if "%YOGUNLUK%"=="5" (
    set /p DURATION="Sure (60s, 3m, 10m): "
    set /p VUS="VU per bot: "
    set /p JOBS="Paralel bot (1-20): "
    set /p RPS="RPS limit (0=sinirsiz): "
) else (
    echo Gecersiz secim!
    pause
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   ONAY BEKLENIYOR                                    ║
echo ╚══════════════════════════════════════════════════════╝
echo   Hedef       : !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   Host        : !HOST_HEADER! (Cloudflare bypass)
echo   Sure        : !DURATION!
echo   VU per bot  : !VUS!
echo   Paralel bot : !JOBS!
echo   RPS limit   : !RPS!
echo ══════════════════════════════════════════════════════
echo.
echo   ⚠️  Bu URL/IP SIZE MI AIT? Baskasinin sistemi = SUC!
echo.
set /p ONAY="Onayliyor musunuz? (EVET yazin): "
if /i not "!ONAY!"=="EVET" (
    echo.
    echo   Iptal edildi.
    pause
    exit /b
)

echo.
echo   🚀 Trigger gonderiliyor...

set "PAYLOAD={\"ref\":\"main\",\"inputs\":{\"target_url\":\"!TARGET_URL!\",\"duration\":\"!DURATION!\",\"vus_per_runner\":\"!VUS!\",\"rps_per_runner\":\"!RPS!\",\"parallel_jobs\":\"!JOBS!\",\"host_header\":\"!HOST_HEADER!\"}}"

curl -sS -X POST ^
  -H "Authorization: token %GH_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/workflows/%WORKFLOW_ID%/dispatches" ^
  -d "!PAYLOAD!" -o nul -w "   HTTP: %%{http_code}\n"

echo.
echo   ✅ Trigger gonderildi. Workflow ~10 saniye icinde baslayacak.
echo.
echo   📊 Canli monitor aciliyor...
echo.
timeout /t 3 /nobreak >nul

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor.ps1"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   Monitor kapandi. Sonuclari GitHub'da inceleyin:    ║
echo ║   https://github.com/%GH_USER%/%GH_REPO%/actions   ║
echo ╚══════════════════════════════════════════════════════╝
pause