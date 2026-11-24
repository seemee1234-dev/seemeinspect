@echo off
chcp 65001 >nul
title ตารางเช็คสถานะงาน อาคาร B พัทยา
start "" "%~dp0building_b_status.html"
exit
