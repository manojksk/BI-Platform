@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-prerequisites-windows.ps1"
echo.
pause
