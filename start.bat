@echo off
chcp 65001 >nul
title Space Planner
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again.
  echo  محتاج تثبت Node.js الاول من https://nodejs.org
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\start.mjs %*
if errorlevel 1 pause
