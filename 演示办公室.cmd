@echo off
chcp 65001 >nul
cd /d "%~dp0"
node src\server.js --demo --port 4318 --open
pause
