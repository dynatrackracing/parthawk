# LAST SESSION — 2026-04-04

## Clean Pipe Phases A+B+C (ALL DEPLOYED)

### Phase A: Schema + Extraction Utility
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- Created 8 indexes for cross-table joins
- Built extractStructuredFields() in partIntelligence.js

### Phase B: Backfill Existing Records
- Backfilled all existing rows (~20K total). Cross-table PN joins verified working.
- YourSale: 14,603 rows | YourListing: 4,365 rows | SoldItem: 1,248 rows

### Phase C: Wire Insert Paths
- YourDataManager: syncOrders (YourSale) + syncListings (YourListing) now extract structured fields
- SoldItemsManager: competitor scrape inserts (SoldItem) — both scrapeCompetitor and scrapeByKeywords
- AutolumenImportService: all 3 CSV import paths (listings, sales, transactions) extract structured fields
- All new data auto-normalized at write time — no backfill needed going forward

## What's next
1. Clean Pipe Phase D: market_demand_cache key standardization (key_type column, consistent PN format)
2. Clean Pipe Phase E: Service query upgrades to use new columns instead of runtime title parsing
3. Sniper PN dedup/cleanup (strip Ford suffixes to base, reject non-PNs, deduplicate dash variants)

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
- All 3 tables fully backfilled + insert paths wired — new data auto-normalized
- market_demand_cache has mixed keys (raw PNs AND pipe-delimited) — do NOT touch yet
- partType='OTHER' is the processed sentinel for rows with no detectable part type
