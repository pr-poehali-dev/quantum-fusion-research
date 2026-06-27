@echo off
chcp 65001 >nul
title Receipt OCR worker - qwen2.5vl:7b
cd /d "%~dp0"

REM ====== НАСТРОЙКА ТОКЕНА ======
REM Впиши сюда токен воркера (тот же, что в секрете проекта RECEIPT_WORKER_TOKEN).
REM Если оставить пусто — воркер возьмёт его из системной переменной окружения.
set "RECEIPT_WORKER_TOKEN="

REM ====== ВЫБОР PYTHON ======
where py >nul 2>nul && (set "PY=py") || (set "PY=python")

echo ============================================================
echo   Receipt OCR worker - модель qwen2.5vl:7b (точный)
echo   Папка: %cd%
echo ============================================================
echo.

REM Устанавливаем зависимости (тихо, только при первом запуске)
%PY% -m pip install --quiet --disable-pip-version-check requests

:loop
echo [%date% %time%] Запуск воркера...
%PY% "%~dp0receipt_worker_7b.py"
echo.
echo [%date% %time%] Воркер завершился. Перезапуск через 5 секунд...
echo (Чтобы полностью остановить — закрой это окно)
timeout /t 5 /nobreak >nul
goto loop
