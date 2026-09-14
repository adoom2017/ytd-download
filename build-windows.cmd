@echo off
setlocal
chcp 65001 >nul
title Streamnest Windows Packager

echo Starting the Streamnest Windows build...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" -OpenOutput %*
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%BUILD_EXIT_CODE%"=="0" (
    echo The build did not complete. Review the error message above.
) else (
    echo The installer output folder has been opened.
)
echo.
pause
exit /b %BUILD_EXIT_CODE%

