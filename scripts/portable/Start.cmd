@echo off
chcp 65001 >nul
title WebPuzzle
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Спочатку розпакуйте всю папку WebPuzzle із ZIP-архіву.
  pause
  exit /b 1
)
"runtime\node.exe" "scripts\start.mjs"
if errorlevel 1 pause
