@echo off
REM DarkHawk Yard Market Sniper
REM Fills market cache for parts on new yard vehicles
REM Searches by PART NUMBER ONLY — no keyword fallback
REM Runs after LKQ scrape in the daily pipeline
cd /d C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
node service/scripts/run-yard-market-sniper.js --execute --limit=50
