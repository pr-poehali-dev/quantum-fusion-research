@echo off
chcp 65001 >nul
title Воркер распознавания счетов

REM ── Настройки (поменяй при необходимости) ───────────────────────────
set "RECEIPT_WORKER_TOKEN=recv_8Kf3pZx9Qm2Lw7Bn4Vt6Hs1Dy0Rg5C"
set "RECEIPT_MODEL=qwen2.5vl:3b"

REM Папка, где лежит этот .bat (и worker.py рядом)
cd /d "%~dp0"

echo ============================================================
echo   Воркер распознавания счетов
echo   Модель: %RECEIPT_MODEL%
echo   Папка:  %cd%
echo ============================================================
echo.

REM ── Проверка: установлен ли Python ──────────────────────────────────
where python >nul 2>nul
if %errorlevel%==0 (
    set "PY=python"
) else (
    where py >nul 2>nul
    if %errorlevel%==0 (
        set "PY=py"
    ) else (
        echo [ОШИБКА] Python не найден. Установи с python.org и поставь галочку "Add Python to PATH".
        echo.
        pause
        exit /b 1
    )
)

REM ── Доустановка зависимостей (один раз, тихо) ────────────────────────
echo Проверяю библиотеки...
%PY% -m pip install --quiet requests openpyxl pypdf pymupdf

echo.
echo Запускаю воркер. Не закрывай это окно, пока работаешь со счетами.
echo Для остановки нажми Ctrl+C или закрой окно.
echo ------------------------------------------------------------
echo.

%PY% worker.py

echo.
echo ------------------------------------------------------------
echo Воркер остановлен.
pause
