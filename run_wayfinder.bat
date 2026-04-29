@echo off
cd /d "c:\Users\djpal\OneDrive\Documents\GitHub\Wayfinder\src"
start cmd /k "python -m http.server 8000"
timeout /t 2 /nobreak > nul
start http://localhost:8000/Wayfinder.html