@echo off
chcp 65001 >nul
title Receipt OCR worker - qwen2.5vl:3b
cd /d "%~dp0"

REM ====== WORKER TOKEN ======
REM Put your worker token here (same as project secret RECEIPT_WORKER_TOKEN).
REM Leave empty to use the system environment variable instead.
set "RECEIPT_WORKER_TOKEN="

REM ====== CHOOSE PYTHON ======
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo ============================================================
echo   Receipt OCR worker - model qwen2.5vl:3b (fast)
echo   Folder: %cd%
echo ============================================================
echo.

REM Install dependency (quiet, first run only)
%PY% -m pip install --quiet --disable-pip-version-check requests

:loop
echo [%date% %time%] Starting worker...
%PY% "%~dp0receipt_worker_3b.py"
echo.
echo [%date% %time%] Worker stopped. Restarting in 5 seconds...
echo (Close this window to stop completely)
timeout /t 5 /nobreak >nul
goto loop
