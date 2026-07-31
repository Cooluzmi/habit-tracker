@echo off
REM ================================================================
REM  AGRESIF MULTI-ACCOUNT STOPPER
REM  Cancel + Force-Cancel + Retry + Eski run temizligi
REM ================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

if exist "config\secrets.bat" (
    call config\secrets.bat
) else if exist "config\secrets.env" (
    call config\secrets.env
) else (
    echo HATA: config\secrets.bat bulunamadi!
    pause
    exit /b 1
)

echo.
echo =====================================================
echo   AGRESIF MULTI-ACCOUNT STOPPER
echo   Cancel + Force-Cancel + Retry
echo =====================================================
echo.

REM ---- HESAP 1 ----
echo [Hesap 1] %GH1_USER%/%GH1_REPO%
call :nuke_account "%GH1_USER%" "%GH1_REPO%" "%GH1_TOKEN%"

REM ---- HESAP 2 ----
if not "%GH2_WORKFLOW_ID%"=="" (
    echo.
    echo [Hesap 2] %GH2_USER%/%GH2_REPO%
    call :nuke_account "%GH2_USER%" "%GH2_REPO%" "%GH2_TOKEN%"
)

REM ---- HESAP 3 ----
if not "%GH3_WORKFLOW_ID%"=="" (
    echo.
    echo [Hesap 3] %GH3_USER%/%GH3_REPO%
    call :nuke_account "%GH3_USER%" "%GH3_REPO%" "%GH3_TOKEN%"
)

REM ---- HESAP 4 ----
if not "%GH4_WORKFLOW_ID%"=="" (
    echo.
    echo [Hesap 4] %GH4_USER%/%GH4_REPO%
    call :nuke_account "%GH4_USER%" "%GH4_REPO%" "%GH4_TOKEN%"
)

REM ---- HESAP 5 ----
if not "%GH5_WORKFLOW_ID%"=="" (
    echo.
    echo [Hesap 5] %GH5_USER%/%GH5_REPO%
    call :nuke_account "%GH5_USER%" "%GH5_REPO%" "%GH5_TOKEN%"
)

echo.
echo =====================================================
echo   3 saniye bekleyip tekrar kontrol ediliyor...
echo =====================================================
timeout /t 3 /nobreak >nul

REM ---- IKINCI TUR (kalanlar icin) ----
echo.
echo [2. TUR - kalan run'lari zorla durdur]
call :nuke_account "%GH1_USER%" "%GH1_REPO%" "%GH1_TOKEN%"
if not "%GH2_WORKFLOW_ID%"=="" call :nuke_account "%GH2_USER%" "%GH2_REPO%" "%GH2_TOKEN%"
if not "%GH3_WORKFLOW_ID%"=="" call :nuke_account "%GH3_USER%" "%GH3_REPO%" "%GH3_TOKEN%"
if not "%GH4_WORKFLOW_ID%"=="" call :nuke_account "%GH4_USER%" "%GH4_REPO%" "%GH4_TOKEN%"
if not "%GH5_WORKFLOW_ID%"=="" call :nuke_account "%GH5_USER%" "%GH5_REPO%" "%GH5_TOKEN%"

echo.
echo =====================================================
echo   TAMAMLANDI. Kontrol et:
echo     https://github.com/%GH1_USER%/%GH1_REPO%/actions
if not "%GH2_WORKFLOW_ID%"=="" (
    echo     https://github.com/%GH2_USER%/%GH2_REPO%/actions
)
echo =====================================================
pause
exit /b 0

REM ================================================================
:nuke_account
REM ================================================================
set "USR=%~1"
set "REPO=%~2"
set "TOK=%~3"

REM --- in_progress ---
for /f "tokens=*" %%R in ('powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { $r=Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=in_progress&per_page=30' -Headers $h -TimeoutSec 10; $r.workflow_runs | ForEach-Object { Write-Host $_.id } } catch {}"') do (
    echo   Cancel: run %%R
    powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/force-cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}" >nul 2>&1
    echo     done
)

REM --- queued ---
for /f "tokens=*" %%R in ('powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { $r=Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=queued&per_page=30' -Headers $h -TimeoutSec 10; $r.workflow_runs | ForEach-Object { Write-Host $_.id } } catch {}"') do (
    echo   Cancel queued: run %%R
    powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/force-cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}" >nul 2>&1
    echo     done
)

REM --- waiting ---
for /f "tokens=*" %%R in ('powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { $r=Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs?status=waiting&per_page=30' -Headers $h -TimeoutSec 10; $r.workflow_runs | ForEach-Object { Write-Host $_.id } } catch {}"') do (
    echo   Cancel waiting: run %%R
    powershell -NoProfile -Command "$h=@{Authorization='token %TOK%';Accept='application/vnd.github+json'}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}; try { Invoke-RestMethod -Uri 'https://api.github.com/repos/%USR%/%REPO%/actions/runs/%%R/force-cancel' -Method Post -Headers $h -TimeoutSec 5 } catch {}" >nul 2>&1
    echo     done
)

exit /b 0