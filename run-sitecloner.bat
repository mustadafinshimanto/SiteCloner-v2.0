@echo off
setlocal enabledelayedexpansion
title SiteCloner v2.0 — Premium Website Cloning Engine

REM --- Setup colors (Standard Windows CMD ANSI support) ---
cls
echo.
echo           ################################################
echo           ##                                            ##
echo           ##             S I T E C L O N E R            ##
echo           ##            - Premium AI Suite -            ##
echo           ##                                            ##
echo           ################################################
echo.

cd /d "%~dp0"

REM --- Check node_modules ---
if not exist "node_modules" (
  echo [!] node_modules missing. Installing dependencies...
  npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Please check your internet connection.
    pause
    exit /b 1
  )
)

REM --- Load environment variables from .env if it exists ---
if exist ".env" (
  for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
    set "key=%%a"
    set "val=%%b"
    REM Skip comments
    if not "!key:~0,1!"=="#" (
      set "!key!=!val!"
    )
  )
)

echo [SYSTEM] Environment loaded from .env...

REM --- AI Diagnostics ---
set "AI_STATUS=DISABLED"
if defined GEMINI_API_KEY (
  set "AI_STATUS=ENABLED (Gemini 1.5 Flash - Neural v2.0)"
)

echo [AI] Status: %AI_STATUS%
echo [AI] Engine: Google Gemini (Native)

REM --- Network Diagnostics ---
if not defined PORT (
  set "PORT=3000"
)

echo [NETWORK] Port: %PORT%
echo [NETWORK] Local: http://localhost:%PORT%
echo.
echo [V8] Hot-Reloading Active: System will auto-refresh on code changes.
echo.

npm run dev

endlocal
