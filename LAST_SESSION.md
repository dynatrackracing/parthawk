# LAST SESSION — 2026-04-04

## Clean Pipe Phases A-D + E1 + E2 (ALL DEPLOYED)

### Phases A-D: Foundation
- Schema, backfill, insert wiring, cache key normalization — all deployed

### Phase E1: Sniper PN Cleanup
- sanitizePartNumberForSearch + deduplicatePNQueue in partIntelligence.js
- Wired into run-yard-market-sniper.js queue builder

### Phase E2: Stock Index Optimization
- buildStockIndex() reads partNumberBase, extractedMake, extractedModel from columns first
- Falls back to title regex parsing only when columns are NULL
- Eliminates ~2,400 regex parses per attack list load
- Verified: 574 make/model combos, 4,322 PNs — healthy counts

## What's next
1. Clean Pipe E3: Attack list demand queries (YourSale ILIKE → column match)
2. Clean Pipe E4: Competitor intel routes (Gap Intel, Best Sellers GROUP BY partNumberBase)
3. Clean Pipe E5: Phoenix PN joins

## Open items unchanged
- instrumentclusterstore scraper returning 0 items
- Autolumen has 0 YourListing records
- The Mark table empty
- Unauthenticated write endpoints

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- buildStockIndex() now uses columns first — if columns are NULL, falls back to title parsing
- extractStructuredFields() is in partIntelligence.js, NOT AttackListService
- detectPartType() exists in BOTH AttackListService and partIntelligence.js — keep in sync
- market_demand_cache keys normalized, sniper writes normalized keys
