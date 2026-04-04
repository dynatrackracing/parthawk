# LAST SESSION — 2026-04-04 (merged — 2 parallel sessions)

## Session A: Market Drip Rewrite
- Expanded importapart drip to 3-bucket priority queue (10,912 unique PNs):
  - Bucket 1: Active YourListing PNs (1,151)
  - Bucket 2: Sold-not-restocked 60d+ (1,583)
  - Bucket 3: Importapart catalog (9,009)
- Comp quality filter: regex excludes as-is/untested/for-parts/core before averaging
- Speed: 15s → 3s delay, 34 → 200/batch, 600 PNs/day, ~18 day cycle
- source changed: importapart_drip → market_drip
- Cache key normalization aligned to Clean Pipe standard
- Dirty keys in market_demand_cache fixed
- Employee Windows account (Office) created for office crew
- VPN reconnect 3x/day between scrape runs

## Session B: Intelligence Tuning + Cleanup (8 items from diagnostic)
- Attack list upgrades deployed: stock penalty scaling (1→5%, 5+→70%), fresh arrival bonus (≤3d=+10%), COGS per yard factor (±5%)
- Sniper expanded: batch 15→35/week, priority queue (never-checked + highest price first), preview endpoint added
- QUARRY rewritten: frozen Item table → YourSale vs YourListing pure SQL, 100 real restock candidates
- Restock flags → Scout Alerts: 49 flags wired as new source in ScoutAlertService
- instrumentclusterstore scraper: NOT broken (427 SoldItems, false alarm from stale diagnostic query)
- Auth on write endpoints: ALREADY RESOLVED — global authGate deployed 4/3 covers all routes
- The Mark: confirmed empty, workflow adoption gap (not code)
- dh-nav.js: FIELD and INTEL tabs centered (margin-left:auto → position:absolute fix)

## Closed items
- instrumentclusterstore scraper: false alarm
- Unauthenticated write endpoints: resolved (global authGate)
- QUARRY data source: rewritten to pure SQL with Clean Pipe columns
- Restock → Scout Alerts: wired
- Attack list scoring gaps: all 3 factors deployed

## What's next — priority order
1. Let market drip run 5-7 days to fill cache (currently 590 → targeting 3,000+)
2. Start using attack list daily — validate top vehicles against gut
3. After 1 week: audit cache coverage, wire market signals into attack list
4. Wire QUARRY output → Scour Stream want list (auto-populate restock candidates)
5. Wire Phoenix output → Scout Alerts (rebuild opps matched to yard vehicles)
6. Build Hunters Perch UI (competitor data exists, frontend is placeholder)
7. Wire Prey-Cycle seasonal data into attack list scoring weights
8. Stale inventory automation — validate pricing data accuracy first

## Architecture notes
- run-importapart-drip.js queries YourListing, YourSale, AND Item for PN queue
- market_demand_cache source field: 'market_drip' for new entries, 'importapart_drip' for legacy
- Comp filter regex: /\b(AS[\s-]?IS|FOR\s+PARTS|UNTESTED|NOT\s+WORKING|PARTS\s+ONLY|CORE\s+(ONLY|CHARGE|RETURN)|NEEDS\s+PROGRAMMING|MAY\s+NEED|INOP(ERABLE)?|BROKEN|DAMAGED|SALVAGE|JUNK|SCRAP)\b/i
- 3 bucket priority: active inventory refreshes fastest, importapart catalog fills remaining capacity
- eBay rate limit: 100 req/min on search endpoints. Running at 20 req/min (20%)
- extractStructuredFields() in partIntelligence.js — single source for title extraction
- sanitizePartNumberForSearch() in partIntelligence.js — single source for PN validation
- Make normalization: title case matching corgi VIN decoder
- market_demand_cache keys normalized (no dashes/spaces/dots for PN type)
- detectPartType() exists in BOTH AttackListService and partIntelligence.js — keep in sync
- Universal rule: Active listing status requires quantity > 0

## Open items (tech debt)
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitorService Thu 4am reads frozen SoldItem (degraded until Sunday scrape)
- LifecycleService loads all YourSale into memory (watch at 50K+)
- Hunters Perch frontend is placeholder
- The Mark table empty (adoption)
- QUARRY → Scour Stream not wired
- Phoenix → Scout Alerts not wired
- Sky Watch → Scout Alerts not wired
- Prey-Cycle → attack list seasonal weighting not wired
