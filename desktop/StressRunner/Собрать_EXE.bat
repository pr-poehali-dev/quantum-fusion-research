@echo off
setlocal
title Build StressRunner.exe
cd /d "%~dp0"

echo ============================================
echo   Build StressRunner.exe (single file)
echo ============================================
echo.

where dotnet >nul 2>nul
if errorlevel 1 goto NODOTNET

echo .NET version:
dotnet --version
echo.
echo Building... 1-3 minutes on first run.
echo.

dotnet publish -c Release -o publish
if errorlevel 1 goto BUILDFAIL

echo.
echo ============================================
echo   DONE. File is here:
echo   %~dp0publish\StressRunner.exe
echo ============================================
echo.

if exist "%~dp0publish\StressRunner.exe" explorer "%~dp0publish"
goto END

:NODOTNET
echo [ERROR] .NET SDK not found.
echo Install .NET SDK 8.0:
echo https://dotnet.microsoft.com/download/dotnet/8.0
echo Section "SDK 8.0.x" -^> Windows x64 Installer. Then run this file again.
echo.
goto END

:BUILDFAIL
echo.
echo [ERROR] Build failed. Read the message above.
echo.

:END
pause
endlocal