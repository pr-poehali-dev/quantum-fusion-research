@echo off
chcp 65001 >nul
title Сборка StressRunner.exe
cd /d "%~dp0"

echo ============================================
echo   Сборка StressRunner.exe (один файл)
echo ============================================
echo.

REM --- Проверка, установлен ли .NET SDK ---
where dotnet >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Не найден .NET SDK.
    echo Установи его отсюда: https://dotnet.microsoft.com/download/dotnet/8.0
    echo Раздел "SDK 8.0.x" -^> Windows x64 Installer. Потом перезапусти этот файл.
    echo.
    pause
    exit /b 1
)

echo Версия .NET:
dotnet --version
echo.
echo Собираю... это займёт 1-3 минуты при первом запуске.
echo.

dotnet publish -c Release -o publish

if errorlevel 1 (
    echo.
    echo [ОШИБКА] Сборка не удалась. Прочитай сообщение выше.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   ГОТОВО! Файл собран:
echo   %~dp0publish\StressRunner.exe
echo ============================================
echo.

REM --- Открыть папку с готовым exe ---
if exist "%~dp0publish\StressRunner.exe" (
    explorer "%~dp0publish"
)

pause
