# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Daily Feed — Mark + Alert indicators

## What was done
- Added 🎯 icon on part chips matching The Mark (collapsed view: "🎯 ECM")
- Added ⚡ purple badge on vehicles with scout alerts (collapsed view: "⚡ 2 ALERTS")
- Added purple SCOUT ALERTS detail box in expanded view listing source + title + value per alert
- Added isMarked to part_chips slim mode mapping in both attack-list.js and FlywayService.js
- Existing MARKED/Restock claimable badges preserved alongside new ⚡ count chip

## What files were touched
- service/public/attack-list.html (chip rendering, renderAlertBadges, renderExpandedParts)
- service/routes/attack-list.js (part_chips mapping — added isMarked)
- service/services/FlywayService.js (part_chips mapping — added isMarked)
- LAST_SESSION.md (this file)

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- Trim value validation Step 4 not yet done
- yard_vehicle transmission columns exist but are never populated

## What's next
- EST badge gray styling
- buildInventoryIndex filter fix
- Continue Daily Feed polish

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- Date pills are CLIENT-SIDE only — no server filter, no timezone functions
- getDaysFromNewest() compares to newest date_added in dataset, not today's calendar date
- isMarked comes from AttackListService scoreVehicle() matching against the_mark table
- alertBadges come from attack-list.js route joining scout_alerts to yard vehicles
