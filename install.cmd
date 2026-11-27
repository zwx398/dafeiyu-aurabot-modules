@echo off
rem 双击这个文件就行（Windows）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
