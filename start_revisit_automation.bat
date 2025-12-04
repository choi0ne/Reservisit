@echo off
cd /d c:\Reservisit
:loop
echo [%DATE% %TIME%] Starting Re-visit Automation... >> console_output.log
node revisit_dom_register.js >> console_output.log 2>&1
echo [%DATE% %TIME%] Script exited. Restarting in 10 seconds... >> console_output.log
timeout /t 10
goto loop
