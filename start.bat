@echo off
cd /d "%~dp0"
echo ============================================
echo   Moneybook server
echo   Open http://localhost:3000 in your browser
echo   Press Ctrl + C in this window to stop
echo ============================================
start "" http://localhost:3000
:loop
node server.js
if "%errorlevel%"=="42" (
    echo Restarting server...
    goto loop
)
pause
