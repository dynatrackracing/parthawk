@echo off
cd C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
node service/scripts/validate-trim-premiums.js %*
pause
