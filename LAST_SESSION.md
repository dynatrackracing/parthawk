# LAST SESSION — 2026-04-04

## Clean Pipe — COMPLETE (Phases A through E5)

### Phase A: Schema + Extraction Utility
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- Created extractStructuredFields() in partIntelligence.js
- 8 indexes created for cross-table joins

### Phase B: Backfill Existing Records
- Backfilled ~20K existing rows across 3 tables
- Cross-table PN joins verified working

### Phase C: Wire Insert Paths
- YourDataManager, SoldItemsManager, AutolumenImportService — all 8 insert paths wired
- All new data auto-normalized at write time

### Phase D: Cache Key Standardization
- Normalized 590 market_demand_cache keys (stripped spaces/dashes/dots)
- Added key_type column (pn/ymm)
- Updated all cache readers and writers

### Phase E1: Sniper PN Cleanup
- sanitizePartNumberForSearch(): strips junk PNs, Ford ECU suffix stripping
- deduplicatePNQueue(): removes dash variant duplicates
- Wired into sniper queue builder

### Phase E2: Stock Index Optimization
- buildStockIndex() reads columns first, ~2,400 fewer regex parses per load

### Phase E3: Attack List Demand Queries
- buildSalesIndex() reads columns first, ~14,600 fewer regex parses per load

### Phase E4: Competitor Intel Routes
- gap-intel, best-sellers, emerging group by partNumberBase with title fallback

### Phase E5: Phoenix PN Joins
- SoldItem matching uses partNumberBase column lookup, title scan fallback
- Standalone group creation uses extractedMake/partType columns

## Also done this session
- Active Inventory CSV Import on /admin/import (368 Autolumen listings imported)
- Zero quantity = Ended (universal fix across API sync and CSV import)

## Summary Impact
- ~17,000 fewer regex parses per attack list load
- Cross-table joins by partNumberBase across YourSale, YourListing, SoldItem, market_demand_cache
- Sniper queue cleaned of junk PNs and duplicates
- All new data auto-normalized at write time via extractStructuredFields()
- All existing data backfilled

## What's next
- Run sniper again to validate improved hit rate
- Monitor attack list performance improvement
- Intelligence tuning (5 diagnostic items from 4/3 session)

## Open items
- instrumentclusterstore scraper returning 0 items
- The Mark table empty
- Unauthenticated write endpoints
- QUARRY data source needs rethink (queries frozen Item table)

## Architecture reminders
- extractStructuredFields() is in partIntelligence.js — single source of truth for title extraction
- sanitizePartNumberForSearch() is in partIntelligence.js — single source for PN validation
- Make normalization: title case matching corgi VIN decoder (Chevrolet, Toyota, Jeep)
- market_demand_cache keys normalized (no dashes/spaces/dots for PN type)
- key_type column: 'pn' for part numbers, 'ymm' for pipe-delimited keys
- detectPartType() exists in BOTH AttackListService and partIntelligence.js — keep in sync
