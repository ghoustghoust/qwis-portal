@echo off
chcp 936 >nul
cd /d "%~dp0"
title 全网情报系统
echo ============================================
echo   全网情报系统 一键启动
echo   (公众号走 wechat2rss RSS 源,无需额外引擎)
echo ============================================
echo.

:: ---------- 启动主系统 (端口 3000) ----------
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [跳过] 情报系统已在运行 ^(3000 端口被占用^)
    echo [提示] 若刚修改过代码需要生效，请先运行 restart-server.bat 再启动
) else (
    echo [启动] 全网情报系统...
    start "情报系统 :3000" cmd /k "cd /d D:\全网情报系统 && npm start"
)

echo.
echo 等待服务就绪...
timeout /t 10 /nobreak >nul

:: ---------- 健康检查 ----------
curl -s -m 5 -o nul -w "情报系统(3000): HTTP %%{http_code}" http://127.0.0.1:3000/ 2>nul || echo 情报系统(3000): 未就绪
echo.

:: ---------- 打开浏览器 ----------
echo 打开情报系统页面...
start "" "http://localhost:3000/"

echo.
echo 完成。关闭「情报系统」窗口即停止服务。
pause
