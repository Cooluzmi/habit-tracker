@echo off
REM ================================================================
REM  🔧 STRANIC000 HESABI KURULUM SCRIPT'I
REM
REM  Ne yapar:
REM   1. Stranic000 hesabında 'loadtest' repo'sunun var olup olmadığını kontrol eder
REM   2. Yoksa oluşturur (private)
REM   3. Yerel kodu ikinci hesaba push eder (loadtest-secondary branch/remote)
REM   4. Workflow ID'yi API'den çeker ve config\secrets.env'e yazar
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ---- Secrets yükle ----
set "SECRETS_FILE="
if exist "config\secrets.bat" (
    set "SECRETS_FILE=config\secrets.bat"
    call config\secrets.bat
) else if exist "config\secrets.env" (
    set "SECRETS_FILE=config\secrets.env"
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   🔧 STRANIC000 HESABI KURULUM                       ║
echo ╚══════════════════════════════════════════════════════╝
echo.
echo   Hedef hesap : %GH2_USER%
echo   Repo adı    : %GH2_REPO%
echo   Token       : %GH2_TOKEN:~0,10%...
echo.

REM ---- 1. Repo var mı kontrol et ----
echo [1/5] Repo kontrol ediliyor...
curl -sS -o "%TEMP%\repo_check.json" -w "%%{http_code}" ^
  -H "Authorization: token %GH2_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "https://api.github.com/repos/%GH2_USER%/%GH2_REPO%" > "%TEMP%\repo_status.txt"

set /p REPO_STATUS=<"%TEMP%\repo_status.txt"
echo   HTTP: !REPO_STATUS!

if "!REPO_STATUS!"=="404" (
    echo [2/5] Repo yok, olusturuluyor (private)...
    curl -sS -X POST ^
      -H "Authorization: token %GH2_TOKEN%" ^
      -H "Accept: application/vnd.github+json" ^
      "https://api.github.com/user/repos" ^
      -d "{\"name\":\"%GH2_REPO%\",\"private\":true,\"description\":\"Distributed load testing\",\"auto_init\":false}" ^
      -o "%TEMP%\repo_create.json" -w "   HTTP: %%{http_code}\n"
    echo   Repo olusturuldu.
) else if "!REPO_STATUS!"=="200" (
    echo [2/5] Repo zaten var, atlaniyor.
) else (
    echo   HATA: Repo API cagrisi basarisiz. HTTP: !REPO_STATUS!
    echo   Token gecerli mi? Scope'lar: repo, workflow olmalı.
    pause
    exit /b 1
)

REM ---- 3. Git remote ekle ve push et ----
echo.
echo [3/5] Git remote ekleniyor ve push yapiliyor...

REM Eger remote 'secondary' varsa kaldir
git remote remove secondary >nul 2>&1

git remote add secondary "https://%GH2_TOKEN%@github.com/%GH2_USER%/%GH2_REPO%.git"
if errorlevel 1 (
    echo   HATA: Git remote eklenemedi.
    pause
    exit /b 1
)

echo   Push ediliyor (bu birkaç saniye surebilir)...
git push -u secondary main --force
if errorlevel 1 (
    echo.
    echo   ⚠️  Push basarisiz. Muhtemel nedenler:
    echo      - Git repo initialize edilmemis (git init)
    echo      - main branch yok (git branch -m main)
    echo      - Commit yok
    echo.
    echo   Manuel dene:
    echo      git push -u secondary main
    pause
    exit /b 1
)

echo   ✅ Kod Stranic000/loadtest'e push edildi.

REM ---- 4. Workflow ID'yi cek ----
echo.
echo [4/5] Workflow ID cekiliyor...
echo   (Not: GitHub Actions'in workflow'u indexlemesi 5-15 saniye surebilir)
timeout /t 8 /nobreak >nul

curl -sS ^
  -H "Authorization: token %GH2_TOKEN%" ^
  -H "Accept: application/vnd.github+json" ^
  "https://api.github.com/repos/%GH2_USER%/%GH2_REPO%/actions/workflows" ^
  -o "%TEMP%\workflows.json"

REM Workflow ID'yi JSON'dan cek (basit parse)
set "WF_ID="
for /f "tokens=2 delims=:," %%A in ('findstr /R /C:"\"id\":" "%TEMP%\workflows.json" ^| findstr /V "node_id"') do (
    if not defined WF_ID (
        set "WF_ID=%%A"
        set "WF_ID=!WF_ID: =!"
    )
)

if "!WF_ID!"=="" (
    echo   ⚠️  Workflow ID otomatik alinamadı.
    echo   Manuel cek:
    echo      https://github.com/%GH2_USER%/%GH2_REPO%/actions
    echo   Ardindan config\secrets.env icindeki GH2_WORKFLOW_ID'yi elle doldur.
    pause
    exit /b 1
)

echo   ✅ Workflow ID bulundu: !WF_ID!

REM ---- 5. secrets dosyasini guncelle ----
echo.
echo [5/5] !SECRETS_FILE! guncelleniyor...
powershell -NoProfile -Command ^
    "$f='!SECRETS_FILE!'; $content = Get-Content $f -Raw; $content = $content -replace 'set \"GH2_WORKFLOW_ID=.*\"', 'set \"GH2_WORKFLOW_ID=!WF_ID!\"'; Set-Content $f -Value $content -NoNewline"

if errorlevel 1 (
    echo   ⚠️  Otomatik guncelleme basarisiz. Elle yap:
    echo      !SECRETS_FILE! → set "GH2_WORKFLOW_ID=!WF_ID!"
    pause
    exit /b 1
)

echo   ✅ !SECRETS_FILE! guncellendi.

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║   ✅ STRANIC000 KURULUMU TAMAMLANDI                  ║
echo ╠══════════════════════════════════════════════════════╣
echo ║   Hesap 1 (Forest123456789) : hazir                  ║
echo ║   Hesap 2 (Stranic000)      : hazir                  ║
echo ║                                                      ║
echo ║   Simdi mega saldiri baslatmak icin:                ║
echo ║      attack-mega.bat                                 ║
echo ╚══════════════════════════════════════════════════════╝
echo.
pause