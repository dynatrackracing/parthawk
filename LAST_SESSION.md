# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Daily Feed — vehicle render cap

## What was done
- Capped frontend vehicle rendering per date pill for faster load times
- Caps: Newest=25, 3d=75, 7d=150, 30d=250, 60d=400, 90d/All=500 (no cap)
- Fresh arrivals sections always render fully regardless of cap
- Capped sections show "+ X more vehicles — switch to a wider filter" hint
- Fully capped sections show collapsed header with "N hidden" count
- API unchanged — still returns all vehicles for accurate scoring
- Lazy loading (IntersectionObserver) still operates within capped results

## What files were touched
- service/public/attack-list.html (VEHICLE_CAPS constant, section rendering loop)
- LAST_SESSION.md (this file)

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- 5,552 vehicles have vin_decoded=true but decoded_trim IS NULL (NHTSA returned no trim data)

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
- VEHICLE_CAPS: rendering cap per date pill, fresh sections always bypass cap
