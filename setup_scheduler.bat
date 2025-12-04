@echo off
echo Cleaning up old task if exists...
schtasks /delete /tn "RevisitAutomation" /f >nul 2>&1

echo Registering ReservisitAutomation task...
schtasks /create /tn "ReservisitAutomation" /tr "c:\Reservisit\start_revisit_automation.bat" /sc onlogon /rl highest /f

if %errorlevel% equ 0 (
    echo Task "ReservisitAutomation" registered successfully.
    echo You can also start it immediately by running: schtasks /run /tn "ReservisitAutomation"
) else (
    echo Failed to register task. Please run as Administrator.
)
pause
