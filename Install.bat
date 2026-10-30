@echo off
title SpareBlok Installer

if not exist "%~dp0scripts\install.ps1" (
  echo.
  echo  This file was opened from inside the ZIP, so it can't find the files it needs.
  echo.
  echo  1. Right-click the ZIP you downloaded and choose "Extract All".
  echo  2. Open the extracted folder.
  echo  3. Double-click Install.bat there.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
