# LAST SESSION — 2026-04-04

## Clean Pipe Phases A-D + E1-E3 (ALL DEPLOYED)

### Phases A-D: Foundation
- Schema, backfill, insert wiring, cache key normalization

### Phase E1: Sniper PN Cleanup
- sanitizePartNumberForSearch + deduplicatePNQueue wired into sniper queue

### Phase E2: Stock Index Optimization
- buildStockIndex() uses columns first — 574 make/model combos, 4,322 PNs

### Phase E3: Sales Index Optimization
- buildSalesIndex() uses extractedMake, extractedModel, partType from YourSale columns
- Falls back to title regex parsing only when columns are NULL
- Eliminates ~14,600 regex parses per attack list load
- Verified: 351 make/model combos, 1,616 sales indexed

## What's next
1. Clean Pipe E4: Competitor intel routes (Gap Intel, Best Sellers GROUP BY partNumberBase)
2. Clean Pipe E5: Phoenix PN joins
3. Regenerate SNAPSHOT_SERVICES.md (AttackListService changed in E2+E3)

## Open items unchanged
- instrumentclusterstore scraper returning 0 items
- Autolumen has 0 YourListing records
- The Mark table empty
- Unauthenticated write endpoints

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- buildStockIndex() and buildSalesIndex() both use columns first, title fallback
- YourSale.partType column aliased as cpPartType in buildSalesIndex select (avoids collision with detectPartType local)
- detectPartType() exists in BOTH AttackListService and partIntelligence.js — keep in sync
- market_demand_cache keys normalized, sniper writes normalized keys
