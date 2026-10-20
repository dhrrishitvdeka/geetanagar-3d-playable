@echo off
rem Start Geetanagar 3D: installs dependencies on first run, then opens the app in your browser.
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting Geetanagar 3D at http://localhost:5173  (close this window to stop)
call npm run dev -- --open /game.html
pause
