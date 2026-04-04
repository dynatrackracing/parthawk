# LAST SESSION — 2026-04-04

## Clean Pipe Phase A+B (DEPLOYED)

### Phase A: Schema + Extraction Utility
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- Created 8 indexes for cross-table joins
- Built extractStructuredFields() in partIntelligence.js
- Make normalization (47 makes), model patterns (200+ models)

### Phase B: Backfill Existing Records
- Backfilled all existing rows with extracted data
- YourSale: 14,603 rows (81% PN, 89% type, 97% make, 84% model)
- YourListing: 4,365 rows (75% PN, 86% type, 98% make, 79% model)
- SoldItem: 1,248 rows (43% PN, 83% type, 83% make, 70% model)
- Cross-table PN joins now work (verified: Ford ECM 623 sales / 77 competitor / 110 in stock)
- Script: service/scripts/backfill-clean-pipe.js (rerunnable, skips already-processed rows)

## What's next
1. Clean Pipe Phase C: Wire extractStructuredFields into all insert/update paths (YourDataManager, AutolumenImportService, SoldItemsManager)
2. Clean Pipe Phase D: market_demand_cache key standardization
3. Clean Pipe Phase E: Service query upgrades to use new columns
4. Sniper PN dedup/cleanup

## Open items unchanged
- instrumentclusterstore scraper returning 0 items
- Autolumen has 0 YourListing records
- The Mark table empty
- Unauthenticated write endpoints

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- extractStructuredFields() is in partIntelligence.js, NOT AttackListService
- detectPartType() now exists in BOTH AttackListService and partIntelligence.js — keep in sync
- All 3 tables fully backfilled — new inserts need Phase C wiring to stay populated
- market_demand_cache has mixed keys (raw PNs AND pipe-delimited) — do NOT touch yet
- partType='OTHER' is the processed sentinel for rows with no detectable part type
- 2 SoldItem rows had empty-string titles — manually set to OTHER
