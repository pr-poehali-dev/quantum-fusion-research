@echo off
chcp 65001 >nul
title Receipt OCR worker - qwen2.5vl:7b-q4 (quantized, fits 12GB VRAM)
cd /d "%~dp0"

REM ====== WORKER TOKEN ======
REM Put your worker token here (same as project secret RECEIPT_WORKER_TOKEN).
REM Leave empty to use the system environment variable instead.
set "RECEIPT_WORKER_TOKEN="

REM ====== QUANTIZED MODEL (Q4) - fits into 12 GB VRAM fully on GPU ======
REM Same 7B accuracy class, but ~5-6 GB instead of ~9 GB. All layers on GPU.
set "RECEIPT_MODEL=qwen2.5vl:7b-q4_K_M"
set "RECEIPT_NUM_CTX=8192"
set "RECEIPT_NUM_GPU=999"
set "RECEIPT_NUM_THREAD=2"

REM ====== GPU SETTINGS (max load on videocard, min on CPU) ======
REM Keep model in VRAM forever and never spill layers to CPU/RAM.
set "OLLAMA_KEEP_ALIVE=-1"
set "OLLAMA_NUM_PARALLEL=1"
set "OLLAMA_MAX_LOADED_MODELS=1"
set "OLLAMA_FLASH_ATTENTION=1"

REM ====== CHOOSE PYTHON ======
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo ============================================================
echo   Receipt OCR worker - model qwen2.5vl:7b-q4_K_M (quantized)
echo   Quantized 7B - fits 12 GB VRAM, 100%% on GPU
echo   Folder: %cd%
echo ============================================================
echo.

REM Install dependencies (quiet, first run only)
REM requests - HTTP; openpyxl - Excel; pypdf - PDF text; pdf2image - PDF scan to image
%PY% -m pip install --quiet --disable-pip-version-check requests openpyxl pypdf pdf2image

:loop
echo [%date% %time%] Starting worker...
%PY% "%~dp0receipt_worker_7b.py"
echo.
echo [%date% %time%] Worker stopped. Restarting in 5 seconds...
echo (Close this window to stop completely)
timeout /t 5 /nobreak >nul
goto loop
