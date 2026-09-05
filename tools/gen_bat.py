# -*- coding: utf-8 -*-
# 生成 GBK 编码的 .bat(cmd 按系统 ANSI 代码页解析批处理文件)
import os

START_ALL = r"""@echo off
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
"""

RESTART = r"""@echo off
chcp 936 >nul
cd /d "%~dp0"
echo 正在结束旧的情报系统进程...
set KILLED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo 结束 PID %%a
    taskkill /PID %%a /T /F && set KILLED=1
)
if "%KILLED%"=="0" (
    echo.
    echo [提示] 若显示拒绝访问，请右键本脚本「以管理员身份运行」
    pause
    exit /b 1
)
echo 正在启动新服务...
cd /d D:\全网情报系统
npm start
"""

BASE = os.path.dirname(os.path.abspath(__file__))
for name, content in [('start-all.bat', START_ALL), ('restart-server.bat', RESTART)]:
    # 统一 CRLF，GBK 编码
    data = content.replace('\n', '\r\n').encode('gbk')
    with open(os.path.join(BASE, name), 'wb') as f:
        f.write(data)
    print(name, len(data), 'bytes')
