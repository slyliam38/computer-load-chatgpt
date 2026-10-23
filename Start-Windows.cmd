@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe node scripts\setup.mjs
if errorlevel 1 goto failure
if not exist node_modules node scripts\setup.mjs
if errorlevel 1 goto failure
node server\main.mjs --open
goto end
:failure
echo Установите Node.js 20+ и Python 3.9+, затем повторите запуск.
:end
pause
