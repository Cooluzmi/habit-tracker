@echo off
REM ================================================================
REM BREAKPOINT TEST — Kirilma noktasi bulma
REM Amac: Sunucunun MAX kapasitesini bulmak
REM UYARI: EN AGRESIF TEST — 100 -^> 5000 req/s
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   BREAKPOINT TEST — KIRILMA NOKTASI
echo   Hedef: hhh.frostai.com.tr
echo   100 -^> 5000 req/s asamali artis
echo   Hata orani ^%%30'u gecince otomatik durur
echo =====================================================
echo.
echo   DIKKAT: Bu test cok agresiftir. Sunucunuz cokebilir.
echo   VPS saglayicinizin bildirim ayarlarini kontrol edin.
echo.
set /p onay="Devam etmek icin 'EVET' yazin: "
if /i not "%onay%"=="EVET" (
    echo Test iptal edildi.
    pause
    exit /b
)

echo.
echo Test basliyor...
timeout /t 3

k6 run scenarios/05-breakpoint.js

echo.
echo =====================================================
echo   Test bitti. Rapor: reports/ klasorunde
echo   HTML dosyasini tarayicida acin.
echo =====================================================
echo.
pause