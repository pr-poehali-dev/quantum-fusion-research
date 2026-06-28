@echo off
chcp 65001 >nul
title LLM benchmark - receipt models (GPU vs CPU)
cd /d "%~dp0"

REM ====== WHAT TO TEST ======
REM Models to benchmark (comma separated). Missing ones are skipped automatically.
set "BENCH_MODELS=qwen2.5vl:3b-q4_K_M,qwen2.5vl:3b,qwen2.5vl:7b-q4_K_M,qwen2.5vl:7b"
REM How many runs per mode (average is taken)
set "BENCH_REPEATS=3"
REM Context length (same as worker for fair comparison)
set "BENCH_NUM_CTX=8192"

REM ====== CHOOSE PYTHON ======
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo ============================================================
echo   LLM BENCHMARK - GPU vs CPU for receipt recognition
echo   Models: %BENCH_MODELS%
echo   Runs per mode: %BENCH_REPEATS%
echo ============================================================
echo.
echo This will load each model twice (on GPU, then on CPU) and
echo measure speed. It can take several minutes. Please wait...
echo.

%PY% "%~dp0benchmark_llm.py"

echo.
echo Done. Press any key to close.
pause >nul
