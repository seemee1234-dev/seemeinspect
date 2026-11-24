@echo off
chcp 65001 >nul
title ตารางเช็คสถานะงาน สถาปัตย์ส่วนกลางและโถงทางเดิน พัทยา
start "" "%~dp0common_area_status.html"
exit
