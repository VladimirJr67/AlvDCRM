@echo off
rem ============================================================
rem  Alvid CRM - launcher. Just double-click this file.
rem  Text is kept ASCII-only on purpose: Russian letters in a
rem  .bat file break cmd.exe (codepage), the CRM itself prints
rem  a Russian banner once the server starts.
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
title Alvid CRM

echo.
echo   Alvid CRM
echo   =========
echo.
echo   Starting the server, the browser will open automatically.
echo.
echo     This computer:  http://localhost:3000
echo     Colleagues:     http://^<IP-of-this-PC^>:3000   (see: ipconfig)
echo.
echo   Keep this window open while working with the CRM.
echo   To stop the server: Ctrl+C or close this window.
echo.

node server.js
pause
