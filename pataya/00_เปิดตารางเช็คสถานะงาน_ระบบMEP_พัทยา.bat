@echo off
chcp 65001 >nul
title ตารางเช็คสถานะงานระบบ MEP พัทยา
start "" "%~dp0mep_system_status.html"
exit
