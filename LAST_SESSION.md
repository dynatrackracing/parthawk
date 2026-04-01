# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Tab cleanup + VIN decode cron

## What was done
- Removed "All" and "Florida" tabs from Daily Feed — default is now Raleigh
- Added VIN decode cron at 3:00 AM and 8:40 AM UTC (post-scrape)
  - Loops VinDecodeService.decodeAllUndecoded() until queue drained (200/batch)
  - Then runs enrichYard() on all enabled yards for trim tier assignment
- Updated CLAUDE_RULES.md cron schedule
- Ran one-time backfill: all VINs already decoded (vin_decoded=true), 1,883 vehicles needed trim_tier assignment via enrichYard

## What files were touched
- service/public/attack-list.html (removed All/Florida tabs, default Raleigh)
- service/index.js (added VIN decode cron jobs)
- CLAUDE_RULES.md (added VIN decode to cron schedule)
- LAST_SESSION.md (this file)

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- 5,552 vehicles have vin_decoded=true but decoded_trim IS NULL (NHTSA returned no trim data — these are base trims or older vehicles)
- 1,883 vehicles had no trim_tier — enrichYard backfill running

## What's next
- EST badge gray styling
- buildInventoryIndex filter fix
- Continue Daily Feed polish

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- Date pills are CLIENT-SIDE only — getDaysFromNewest() compares to newest date_added in dataset
- Default tab is now Raleigh, not All
- VIN decode cron runs at 3am + 8:40am UTC on Railway
- isMarked comes from AttackListService scoreVehicle() matching against the_mark table
- alertBadges come from attack-list.js route joining scout_alerts to yard vehicles
