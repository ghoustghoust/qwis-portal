@echo off
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
