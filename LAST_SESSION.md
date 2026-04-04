# LAST SESSION — 2026-04-04

## Clean Pipe Phases A+B+C+D (ALL DEPLOYED)

### Phase A: Schema + Extraction Utility
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- Created 8 indexes for cross-table joins
- Built extractStructuredFields() in partIntelligence.js

### Phase B: Backfill Existing Records
- Backfilled all existing rows (~20K total). Cross-table PN joins verified working.

### Phase C: Wire Insert Paths
- YourDataManager, SoldItemsManager, AutolumenImportService — all 8 insert paths wired

### Phase D: Cache Key Standardization
- Added key_type column (pn/ymm) to market_demand_cache
- Normalized all 582 PN keys (stripped spaces/dashes/dots, uppercased). 74 renamed, 0 dupes.
- Tagged 8 YMM pipe-delimited keys
- Updated MarketPricingService, PriceCheckService, MarketDemandCronRunner writers to normalize before insert
- Updated priceResolver.js reader to normalize lookup keys
- Cache keys now joinable with partNumberBase columns

## What's next
1. Clean Pipe Phase E: Service query upgrades (Gap Intel, Phoenix, Competitor Monitor use new columns)
2. Sniper PN dedup/cleanup (strip Ford suffixes, reject non-PNs, deduplicate dash variants)

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
- market_demand_cache keys are now normalized (no dashes/spaces/dots for PN keys)
- key_type column: 'pn' for part numbers, 'ymm' for pipe-delimited year|make|model|type keys
- priceResolver normalizes lookup keys before querying cache
