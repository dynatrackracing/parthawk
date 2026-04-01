# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Workflow setup

## What was done
- Created CLAUDE_RULES.md with all hard constraints
- Created CHANGELOG.md for session-to-session continuity
- Created this LAST_SESSION.md file

## What files were touched
- CLAUDE_RULES.md (new)
- CHANGELOG.md (new)
- LAST_SESSION.md (new)

## What is still broken / needs attention
- Attack list frontend: multiple reported display bugs — full audit needed
- Run the attack-list-audit-prompt.md diagnostic to identify specific issues
- Trim value validation Step 4 not yet done (eBay sold listing scrapes for gaps)
- yard_vehicle transmission columns exist but are never populated (need VIN re-decode)

## What's next
- Full attack list audit (read all files, run DB diagnostics, produce bug report)
- Fix whatever the audit surfaces, one bug at a time

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- DO NOT modify attack-list.html without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- Price resolution: market_demand_cache → PriceCheck → Item.price (last resort)
