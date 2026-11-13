@echo off
chcp 65001 >nul
title WebPuzzle
cd /d "%~dp0"
"%ProgramFiles%\nodejs\node.exe" --experimental-strip-types scripts\start-lan.mts
pause
