@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Version Hub - Publish Data

echo.
echo   Publishing data to GitHub ...
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo   [XX] PowerShell not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\publish.ps1" %*
if errorlevel 1 (
  echo.
  echo   Publish finished with errors. See messages above.
  pause
)
