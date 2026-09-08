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
"""

RESTART = r"""@echo off
chcp 936 >nul
cd /d "%~dp0"
title 全网情报系统 - 重启后端

:: ---------- 清理全部 server/index.js 实例(含不占端口的僵尸) ----------
:: 历史教训:只杀 3000 端口占用者会漏掉启动失败的僵尸实例(占着 DB 跑调度但不监听端口),
:: 导致旧代码永远杀不掉、新修复无法生效。改为按命令行匹配 node server/index.js 全量清理。
echo 正在清理所有 server/index.js 进程(含僵尸实例)...
powershell -NoProfile -Command "$found=$false; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' } | ForEach-Object { $found=$true; Write-Output ('  结束 PID ' + $_.ProcessId); & taskkill /PID $_.ProcessId /T /F | Out-Null }; if (-not $found) { Write-Output '  没有发现运行中的实例' }"

:: ---------- 兜底:确认 3000 端口已释放 ----------
set "PID3000="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do set "PID3000=%%a"
if defined PID3000 (
    echo 端口仍被 PID %PID3000% 占用,尝试结束进程树...
    taskkill /PID %PID3000% /T /F >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [错误] 无法结束 PID %PID3000%,通常是权限不足。
        echo        请右键本脚本选择「以管理员身份运行」后重试。
        pause
        exit /b 1
    )
)
echo 等待端口释放...
timeout /t 2 /nobreak >nul

echo.
echo 正在重新启动后端服务(server/index.js)...
echo 提示:本窗口将显示服务日志,关闭窗口即停止服务。
npm start
"""

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根目录(bat 放在根目录)
for name, content in [('start-all.bat', START_ALL), ('restart-server.bat', RESTART)]:
    # 统一 CRLF，GBK 编码
    data = content.replace('\n', '\r\n').encode('gbk')
    with open(os.path.join(BASE, name), 'wb') as f:
        f.write(data)
    print(name, len(data), 'bytes')
