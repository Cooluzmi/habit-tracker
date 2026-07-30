@echo off
REM ================================================================
REM MAX THROUGHPUT TEST — Maksimum bant genisligi + RPS olcumu
REM Tek makineden fiziksel LIMIT'e kadar yuk
REM ================================================================
cd /d "%~dp0.."
if not exist reports mkdir reports

echo.
echo =====================================================
echo   MAX THROUGHPUT TEST — MAKSIMUM BOTNET
echo   Hedef: hhh.frostai.com.tr
echo   VU: 20.000 max / RPS: 20.000 hedef
echo   Sure: ~5 dakika
echo =====================================================
echo.
echo   BU TEST YEREL MAKINENIZI SATURATE EDER:
echo   - CPU %%100
echo   - Ag baglantiniz dolar
echo   - RAM 4-8 GB kullanilabilir
echo.
echo   ONERI: Once TCP port limitini genislet:
echo     netsh int ipv4 set dynamicport tcp start=1025 num=64510
echo   (Yonetici komut isteminde bir defa calistirin)
echo.
set /p onay="Devam etmek icin 'EVET' yazin: "
if /i not "%onay%"=="EVET" (
    echo Iptal edildi.
    pause
    exit /b
)

echo.
echo Test basliyor - Ctrl+C ile acil durdurabilirsiniz
timeout /t 3

REM k6 icin sistem limitlerini gevset
set K6_NO_USAGE_REPORT=true
set GOMAXPROCS=0

k6 run scenarios/06-max-throughput.js

echo.
echo =====================================================
echo   TEST BITTI - reports/ klasorunde HTML rapor
echo.
echo   Gb/s hesaplama formulu:
echo     (data_received + data_sent) bayt * 8 / sure(sn) / 1e9
echo =====================================================
pause