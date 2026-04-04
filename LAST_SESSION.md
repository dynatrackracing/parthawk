# LAST SESSION — 2026-04-04

## Clean Pipe Phase A: Schema + Extraction (DEPLOYED)
- Added partNumberBase, partType, extractedMake, extractedModel columns to YourListing, YourSale, SoldItem
- Created 8 indexes for cross-table joins and filtering
- Built extractStructuredFields() in partIntelligence.js — single function extracts all 4 fields from any title
- Make normalization to title case (Chevrolet, Toyota, Jeep — matches corgi VIN decoder output)
- Model extraction with word-boundary matching (Grand Cherokee ≠ Cherokee)
- detectPartType() copied into partIntelligence.js for self-contained use
- Tested against 11 representative titles — all constraints passed
- Migration run directly against production DB (columns + indexes confirmed)

## What files were touched
- service/database/migrations/20260404000000_clean_pipe_phase_a.js (NEW)
- service/utils/partIntelligence.js (extractStructuredFields, detectPartType, MAKE_NORMALIZE, MODEL_PATTERNS)

## Open for Next Session
1. Clean Pipe Phase B: Backfill existing rows (run extractStructuredFields on all YourListing/YourSale/SoldItem)
2. Clean Pipe Phase C: Wire insert paths (YourDataManager sync, AutolumenImportService, competitor scrapers)
3. Debug instrumentclusterstore scraper (0 items)
4. Import Autolumen active listings
5. The Mark adoption (table is empty)
6. QUARRY data source fix (queries frozen Item table)

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- extractStructuredFields() is in partIntelligence.js, NOT AttackListService
- detectPartType() now exists in BOTH AttackListService and partIntelligence.js — keep in sync
- Columns exist on prod but are all NULL — backfill needed (Phase B)
- market_demand_cache has mixed keys (raw PNs AND pipe-delimited) — do NOT touch yet
- Zero NHTSA API calls in codebase (LocalVinDecoder handles all VIN decoding)
