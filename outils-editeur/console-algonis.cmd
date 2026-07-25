@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable.
  echo   Installez-le depuis https://nodejs.org (version 20 ou plus recente^), puis relancez.
  echo.
  pause
  exit /b 1
)

echo.
echo   Demarrage de la console editeur Algonis...
echo   Le navigateur s'ouvre tout seul. Fermez cette fenetre pour arreter.
echo.
node console.js
echo.
pause
