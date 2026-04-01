# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Daily Feed fixes

## What was done
- Reworked Daily Feed date pills from hard-filter to fresh-highlight + still-on-lot split
- Removed server-side `since` filter — API always returns all active vehicles
- Date pills now control client-side grouping: "NEW TODAY" / "STILL ON LOT" split when a pill is active, age-tier grouping for "All"
- Improved detectPartType() coverage — added 17 new part types (CAMERA, HVAC, HEADLIGHT, TAILLIGHT, BLIND_SPOT, PARK_SENSOR, AIR_RIDE, CLOCK_SPRING, LOCK, IGNITION, LIFTGATE, HMI, SAM, SEAT_BELT, ALTERNATOR, STARTER, BLOWER, NAV) to reduce OTHER chips
- Updated CLAUDE_RULES.md rule 19: steering and sunroof ARE sellable, not excluded

## What files were touched
- service/public/attack-list.html (date pill rework, section grouping, removed since filter)
- service/services/AttackListService.js (detectPartType expanded)
- CLAUDE_RULES.md (rule 19 correction)
- LAST_SESSION.md (this file)

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray — should use distinct verdict-est class
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- VIN route ILIKE stock lookup (potential performance issue)
- Trim value validation Step 4 not yet done (eBay sold listing scrapes for gaps)
- yard_vehicle transmission columns exist but are never populated (need VIN re-decode)

## What's next
- EST badge gray styling
- buildInventoryIndex filter fix
- Consider adding CONSERVATIVE_SELL_ESTIMATES entries for new part types

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- DO NOT modify attack-list.html without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- Price resolution: market_demand_cache -> PriceCheck -> Item.price (last resort)
- Date pills are CLIENT-SIDE only now — no server filter
