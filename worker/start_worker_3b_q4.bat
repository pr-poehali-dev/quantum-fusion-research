@echo off
chcp 65001 >nul
title Receipt OCR worker - qwen2.5vl:3b-q4 (quantized, low VRAM)
cd /d "%~dp0"

REM ====== WORKER TOKEN ======
REM Put your worker token here (same as project secret RECEIPT_WORKER_TOKEN).
REM Leave empty to use the system environment variable instead.
set "RECEIPT_WORKER_TOKEN="

REM ====== QUANTIZED MODEL (Q4) - tiny VRAM footprint, all layers on GPU ======
REM Same 3B speed class, but ~2-3 GB instead of ~4-5 GB. Frees VRAM, 100%% on GPU.
set "RECEIPT_MODEL=qwen2.5vl:3b-q4_K_M"
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
echo   Receipt OCR worker - model qwen2.5vl:3b-q4_K_M (quantized)
echo   Quantized 3B - tiny VRAM, 100%% on GPU
echo   Folder: %cd%
echo ============================================================
echo.

REM Install dependencies (quiet, first run only)
REM requests - HTTP; openpyxl - Excel; pypdf - PDF text; pdf2image - PDF scan to image
%PY% -m pip install --quiet --disable-pip-version-check requests openpyxl pypdf pdf2image

:loop
echo [%date% %time%] Starting worker...
%PY% "%~dp0receipt_worker_3b.py"
echo.
echo [%date% %time%] Worker stopped. Restarting in 5 seconds...
echo (Close this window to stop completely)
timeout /t 5 /nobreak >nul
goto loop
