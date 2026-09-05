@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 全网情报系统 - 重启后端

echo 正在检查 3000 端口占用...
set "PID3000="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do set "PID3000=%%a"

if defined PID3000 (
    echo 发现旧进程 PID %PID3000%，正在结束进程树...
    taskkill /PID %PID3000% /T /F >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [错误] 无法结束 PID %PID3000%，通常是权限不足。
        echo        请右键本脚本选择“以管理员身份运行”后重试。
        pause
        exit /b 1
    )
    echo 旧进程已结束，等待端口释放...
    timeout /t 2 /nobreak >nul
) else (
    echo 3000 端口空闲，无需清理，直接启动。
)

echo.
echo 正在重新启动后端服务（server/index.js）...
echo 提示：本窗口将显示服务日志，关闭窗口即停止服务。
npm start
