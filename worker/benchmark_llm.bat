@echo off
chcp 65001 >nul
title LLM benchmark - receipt models (GPU vs CPU)
cd /d "%~dp0"

REM ====== SETTINGS ======
REM Models are chosen interactively from the ones you have downloaded.
REM How many runs per mode (average is taken)
set "BENCH_REPEATS=3"
REM Context length (same as worker for fair comparison)
set "BENCH_NUM_CTX=8192"

REM ====== CHOOSE PYTHON ======
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo ============================================================
echo   LLM BENCHMARK - GPU vs CPU for receipt recognition
echo   Runs per mode: %BENCH_REPEATS%
echo ============================================================
echo.
echo You will pick which downloaded models to test in the console.
echo Each model runs on GPU, then on CPU, to measure speed.
echo It can take several minutes. Please wait...
echo.

%PY% "%~dp0benchmark_llm.py"

echo.
echo Done. Press any key to close.
pause >nul