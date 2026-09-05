@echo off
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
