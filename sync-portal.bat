@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在将门户数据部署到 GitHub(Vercel 自动构建)...
node tools\sync-portal.js
echo.
pause
