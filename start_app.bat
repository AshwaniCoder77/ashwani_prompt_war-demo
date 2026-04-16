@echo off
echo ===========================================
echo Starting Stadium Crowd Management System...
echo ===========================================

echo Starting Backend API Server...
start "Backend Server" cmd /k "cd backend-api && node index.js"

echo Starting Frontend Web App...
start "Frontend UI" cmd /k "cd mobile-app && npm run dev"

echo Waiting for Vite server to boot up...
timeout /t 5 /nobreak > nul

echo Launching application in default browser...
start http://localhost:5173/

echo Done! The app should now be open in your browser. 
echo Note: Close the command prompt windows to stop the servers later.
