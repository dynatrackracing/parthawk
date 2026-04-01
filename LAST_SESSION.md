# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Fix — Homepage section links + Autolumen uploads placement

## What was done
- Created home.html: DarkHawk homepage at /admin/home with section links organized by category
- Moved Autolumen Sync card from gate.html to home.html (both upload sections preserved)
- gate.html stripped down to Nest Protector only (stock check + COGS calculator)
- DarkHawk logo in dh-nav.js now links to /admin/home instead of /
- timeAgo() kept in gate.html for cache display in stock check results

## What files were touched
- service/public/home.html (NEW)
- service/public/gate.html (removed Autolumen card + JS, kept timeAgo)
- service/public/dh-nav.js (logo links to /admin/home)
- service/index.js (added /admin/home route)
- CHANGELOG.md, LAST_SESSION.md

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- 5,552 vehicles have vin_decoded=true but decoded_trim IS NULL
- Mark icons (target) not appearing — marks lack partNumber, byTitle matching not wired up
- Scout alert icons (lightning) not appearing — depends on marks having PNs

## What's next
- First Autolumen CSV upload via /admin/home
- Test cache claim flow end-to-end on mobile
- EST badge gray styling

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- YourDataManager deactivation sweep is scoped to store='dynatrack' — DO NOT remove this
- Root / serves React SPA (DynaTrack inventory), NOT DarkHawk. DarkHawk homepage is /admin/home
- Autolumen Sync card is on home.html, NOT gate.html
- gate.html = Nest Protector only (stock check + COGS)
- dh-nav.js logo links to /admin/home
