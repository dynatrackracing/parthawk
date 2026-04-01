# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Daily Feed rework

## What was done
- Replaced calendar-based "Today" filter with data-driven "Newest" filter
- Date pills now relative to actual newest date_added in scrape data, not today's calendar date
- "Newest" always has results — it's the most recent batch in the data
- Removed yard health banners (yellow/red scrape warnings), added clean "Last scraped: Xh ago" line
- Removed timezone-dependent date functions (easternDateStr, easternSinceDateISO, filterSinceParam, getLastSeenDaysAgo, getSetDaysAgo)
- Replaced with parseLocalDate(), getNewestDate(), getDaysFromNewest() — no timezone issues
- Age badges now relative to newest date: NEW / 2D AGO / 7D AGO etc.
- Removed scrape-health API fetch from loadData (last_scraped comes from attack list API already)
- Removed per-filter data caching (one dataset, re-rendered client-side)

## What files were touched
- service/public/attack-list.html (full date pill rework)
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
