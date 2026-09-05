@echo off
chcp 65001 >nul
title 全网情报系统 - 运维工具箱
cd /d "%~dp0.."
node tools\ops-toolkit.js %*
if "%~1"=="" pause
