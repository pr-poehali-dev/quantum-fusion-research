@echo off
title Receipt OCR worker

REM ===== Settings (change if needed) =====
set "RECEIPT_WORKER_TOKEN=recv_8Kf3pZx9Qm2Lw7Bn4Vt6Hs1Dy0Rg5C"
set "RECEIPT_MODEL=qwen2.5vl:3b"

REM Folder where this .bat is located (worker.py must be next to it)
cd /d "%~dp0"

echo ============================================================
echo   Receipt OCR worker
echo   Model: %RECEIPT_MODEL%
echo   Folder: %cd%
echo ============================================================
echo.

REM ===== Check Python =====
where python >nul 2>nul
if %errorlevel%==0 (
    set "PY=python"
    goto found
)
where py >nul 2>nul
if %errorlevel%==0 (
    set "PY=py"
    goto found
)
echo [ERROR] Python not found. Install from python.org with "Add Python to PATH".
echo.
pause
exit /b 1

:found
echo Installing libraries (first run only)...
%PY% -m pip install --quiet requests openpyxl pypdf pymupdf

echo.
echo Worker is running. Keep this window open while processing receipts.
echo Press Ctrl+C or close the window to stop.
echo ------------------------------------------------------------
echo.

%PY% worker.py

echo.
echo ------------------------------------------------------------
echo Worker stopped.
pause
