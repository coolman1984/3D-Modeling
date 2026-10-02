@echo off
setlocal
set "PLANNER_DATA=%~dp0data-demo"
set "PLANNER_PORT=4601"
call "%~dp0start.bat" %*
