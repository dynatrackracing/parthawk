# LAST SESSION — 2026-04-04

## Clean Pipe Phases A+B+C+D+E1 (ALL DEPLOYED)

### Phase A: Schema + Extraction Utility
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- Created 8 indexes for cross-table joins
- Built extractStructuredFields() in partIntelligence.js

### Phase B: Backfill Existing Records
- Backfilled all existing rows (~20K total). Cross-table PN joins verified working.

### Phase C: Wire Insert Paths
- YourDataManager, SoldItemsManager, AutolumenImportService — all 8 insert paths wired

### Phase D: Cache Key Standardization
- Normalized market_demand_cache keys, added key_type column, updated all readers/writers

### Phase E1: Sniper PN Cleanup
- sanitizePartNumberForSearch(): strips junk PNs, normalizes format, strips Ford ECU suffixes
- deduplicatePNQueue(): removes duplicate dash variants, keeps highest-value entry
- Wired into run-yard-market-sniper.js queue builder
- Ford ECU base extraction: F81F-12A650-AEAWA3 → F81F12A650
- Rejects: model names, concatenated junk, short/long garbage, engine specs
- 16/17 test cases pass (1 edge case: orphan internal ID)

## What's next
1. Clean Pipe E2: Stock index optimization (buildStockIndex uses new columns)
2. Clean Pipe E3: Attack list demand queries (YourSale ILIKE → column match)
3. Clean Pipe E4: Competitor intel routes (Gap Intel, Best Sellers GROUP BY partNumberBase)
4. Clean Pipe E5: Phoenix PN joins

## Open items unchanged
- instrumentclusterstore scraper returning 0 items
- Autolumen has 0 YourListing records
- The Mark table empty
- Unauthenticated write endpoints

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- extractStructuredFields() is in partIntelligence.js, NOT AttackListService
- detectPartType() exists in BOTH AttackListService and partIntelligence.js — keep in sync
- sanitizePartNumberForSearch() rejects JUNK_WORDS set + length/pattern checks
- Ford 12A650/14A067 patterns get suffix-stripped to base in sanitize function
- market_demand_cache keys normalized (Phase D), sniper writes normalized keys (Phase E1)
