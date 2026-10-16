@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-docker.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. Please keep this window open to read the error.
  pause
  exit /b 1
)
