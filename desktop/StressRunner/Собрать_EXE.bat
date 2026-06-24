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

if not exist "%~dp0publish\StressRunner.exe" goto BUILDFAIL

REM --- Clean portable folder ONE LEVEL UP (next to the source folder) ---
REM   desktop\StressRunner\        <- source code (this folder)
REM   desktop\StressRunner_App\    <- clean release (exe + StressTests + Others)
pushd "%~dp0.."
set "REL=%CD%\StressRunner_App"
popd
if not exist "%REL%" mkdir "%REL%"
if not exist "%REL%\StressTests" mkdir "%REL%\StressTests"
if not exist "%REL%\Others" mkdir "%REL%\Others"
copy /y "%~dp0publish\StressRunner.exe" "%REL%\StressRunner.exe" >nul

echo.
echo ============================================
echo   DONE. Clean portable folder:
echo   %REL%
echo.
echo   Inside:
echo     StressRunner.exe   (run this)
echo     StressTests\       (put OCCT, FurMark, ... here)
echo     Others\            (settings, profiles, db - auto)
echo ============================================
echo.

explorer "%REL%"
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