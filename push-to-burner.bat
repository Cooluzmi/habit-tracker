@echo off
REM ================================================================
REM Burner GitHub Hesabina Repo Push Script'i
REM ================================================================
setlocal enabledelayedexpansion

echo.
echo =====================================================
echo   BURNER GITHUB HESABINA PUSH
echo =====================================================
echo.

REM Kullanici adi al
set /p BURNER_USER="Burner GitHub kullanici adin: "
if "%BURNER_USER%"=="" (
    echo Kullanici adi bos olamaz!
    pause
    exit /b 1
)

REM Repo adi
set /p REPO_NAME="Repo adi [loadtest]: "
if "%REPO_NAME%"=="" set REPO_NAME=loadtest

echo.
echo Hazirlaniyor:
echo   Kullanici : %BURNER_USER%
echo   Repo      : %REPO_NAME%
echo   Remote URL: https://github.com/%BURNER_USER%/%REPO_NAME%.git
echo.
set /p confirm="Devam? (E/H): "
if /i not "%confirm%"=="E" (
    echo Iptal edildi.
    pause
    exit /b
)

REM .gitignore olustur
if not exist .gitignore (
    echo Creating .gitignore...
    (
        echo reports/*.json
        echo reports/*.html
        echo !reports/.gitkeep
        echo node_modules/
        echo *.log
    ) > .gitignore
)

REM Git init
if not exist .git (
    echo Git init...
    git init
    if errorlevel 1 (
        echo HATA: git kurulu degil. https://git-scm.com/download/win
        pause
        exit /b 1
    )
)

REM Add + commit
git add .
git commit -m "load test setup" 2>nul

REM Remote ayarla
git remote remove origin 2>nul
git remote add origin https://github.com/%BURNER_USER%/%REPO_NAME%.git

REM Branch adi main
git branch -M main

echo.
echo Push ediliyor... (kullanici adin ve PAT token gerekecek)
echo.
echo NOT: Sifre yerine Personal Access Token (PAT) girmelisin
echo   PAT olustur: https://github.com/settings/tokens
echo   Scopes: repo, workflow
echo.

git push -u origin main

if errorlevel 1 (
    echo.
    echo =====================================================
    echo HATA! Push basarisiz. Sebebler:
    echo   1) Repo henuz olusturulmadi:
    echo      https://github.com/new
    echo      Name: %REPO_NAME%
    echo      Private secin
    echo   2) PAT tokeni yanlis
    echo   3) Repo baska bir hesabin
    echo =====================================================
    pause
    exit /b 1
)

echo.
echo =====================================================
echo   PUSH BASARILI!
echo.
echo   Simdi soyle yap:
echo   1) https://github.com/%BURNER_USER%/%REPO_NAME%/actions
echo   2) "Distributed Load Test" workflow'una tikla
echo   3) "Run workflow" butonuna bas
echo   4) URL: https://hhh.frostai.com.tr
echo   5) 30 saniye sonra site cokecek
echo =====================================================
pause