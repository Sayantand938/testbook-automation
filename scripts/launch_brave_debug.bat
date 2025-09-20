@echo off
title Launch Brave in Debug Mode

echo ==========================================================
echo  Starting Brave Browser with Remote Debugging
echo ==========================================================
echo.
echo  This script will launch Brave with remote debugging
echo  enabled on port 9222.
echo.
echo  Path: "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
echo.

:: Use the "start" command to launch the browser without blocking the command prompt.
:: The first "" is a placeholder for the window title.
start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222

echo Brave has been launched. This window will close shortly.
timeout /t 3 >nul
exit