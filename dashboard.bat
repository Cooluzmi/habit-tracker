@echo off
echo === ATTACK DASHBOARD ===
echo Port 5173 uzerinde baslatiliyor...
echo CF Tunnel ile disariya acabilirsin
echo.
cd /d "%~dp0dashboard"
node server.js
pause