@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Version Hub - Local Server

echo.
echo   Version Hub - local preview server
echo   -----------------------------------
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  echo   Starting Python HTTP server on port 8080 ...
  echo   URL: http://127.0.0.1:8080
  echo   Press Ctrl+C to stop.
  echo.
  start "" "http://127.0.0.1:8080"
  python -m http.server 8080
  goto end
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo   Starting Python HTTP server on port 8080 ...
  echo   URL: http://127.0.0.1:8080
  echo.
  start "" "http://127.0.0.1:8080"
  py -m http.server 8080
  goto end
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo   Starting Node http-server on port 8080 ...
  echo   URL: http://127.0.0.1:8080
  echo.
  start "" "http://127.0.0.1:8080"
  npx --yes http-server -p 8080 -c-1 .
  goto end
)

echo   [!] Python / Node not found.
echo.
echo   No problem - this site works without a server too:
echo   just double-click  index.html  to open it directly.
echo.

:end
pause
