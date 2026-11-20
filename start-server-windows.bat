@echo off
cd /d "%~dp0"
echo ============================================
echo   Salon Manager - Server
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    set PYCMD=python
    goto :found
)
where python3 >nul 2>nul
if %errorlevel%==0 (
    set PYCMD=python3
    goto :found
)

echo Python was not found on this computer.
echo.
echo Please install it first: double-click install-python-windows.bat
echo Then run this file again.
echo.
pause
exit /b

:found
echo Starting the server using %PYCMD% ...
echo.
echo On THIS computer, open Chrome and go to:
echo     http://localhost:8765/
echo.
echo For your phone, your wife's phone, or your manager's phone to reach
echo this same app, see the "Access From Anywhere (Tailscale)" section in
echo README.md -- you only need to set that up once.
echo.
echo Keep THIS window open the whole time the salon is using the app.
echo Closing it stops the server for everyone. Your data is safe either way.
echo ============================================
echo.
%PYCMD% server.py --port 8765
pause
