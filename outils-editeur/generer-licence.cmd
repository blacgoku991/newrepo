@echo off
rem Génération d'une licence, en mode questions/réponses (Windows).
rem Double-cliquez sur ce fichier : il demande ce qu'il faut et affiche la licence.
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   === Algonis - generation d'une licence client ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js n'est pas installe ou n'est pas dans le PATH.
  echo   Installez-le depuis https://nodejs.org ^(version 20 ou plus^)
  echo.
  pause
  exit /b 1
)

set "CLE=%USERPROFILE%\.algonis\licence-private.pem"
if not exist "%CLE%" (
  echo   Aucune cle de signature trouvee :
  echo   %CLE%
  echo.
  set /p CREER="  La creer maintenant ? [O/n] "
  if /i "!CREER!"=="n" exit /b 1
  node scripts\licence-keygen.js
  if errorlevel 1 ( pause & exit /b 1 )
  echo.
  echo   /!\ Collez la ligne "const CLE_PUBLIQUE = ..." dans src\licence.js
  echo       du portail avant de le livrer.
  echo.
  pause
)

set /p CLIENT="  Nom du client                         : "
set /p FIN="  Dernier jour de validite (AAAA-MM-JJ) : "
set /p INSTALL="  Identifiant d'installation du client  : "
set /p NOTE="  Reference / note (optionnel)          : "

if "%CLIENT%"=="" goto :manque
if "%FIN%"=="" goto :manque

set ARGS=--client "%CLIENT%" --fin "%FIN%"
if not "%INSTALL%"=="" (
  set ARGS=!ARGS! --install "%INSTALL%"
) else (
  echo.
  echo   /!\ Sans identifiant d'installation, la licence fonctionnera sur
  echo       n'importe quel serveur. A reserver aux depannages.
)
if not "%NOTE%"=="" set ARGS=!ARGS! --note "%NOTE%"

echo.
node scripts\licence-signer.js !ARGS!
if errorlevel 1 (
  echo   Aucune licence generee : corrigez les informations et relancez.
  echo.
  pause
  exit /b 1
)
echo   Copiez la ligne ALG1... ci-dessus et envoyez-la au client.
echo   Il la colle dans Administration ^> Reglages ^> Licence.
echo.
pause
exit /b 0

:manque
echo.
echo   Le nom du client et la date de fin sont obligatoires. Rien n'a ete genere.
echo.
pause
exit /b 1
