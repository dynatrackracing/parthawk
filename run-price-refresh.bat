@echo off
set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
cd /d C:\DarkHawk\parthawk-deploy
node service/scripts/nightly-price-refresh.js --limit 100
