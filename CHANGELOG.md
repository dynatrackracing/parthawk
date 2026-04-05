# DARKHAWK CHANGELOG

Reverse chronological. Every deploy gets one entry. Claude Code appends to this after every session.

---

## Ford partNumberBase Fix + Stock Index Dedup — 2026-04-05
- Ford PNs now keep vehicle prefix (7L3A12A650 not 12A650) — fixes 241→5 stock inflation
- Stock index deduplicates per listing via Set — prevents triple-counting
- normalizePartNumber handles 3-char Ford suffixes (GJH)
- Backfill: 9,490 rows updated across 3 tables

---

## Cache + Scour Stream Inline Edit — 2026-04-05
- PATCH /cache/:id, PATCH /restock-want-list/:id, PATCH /restock-want-list/by-title
- cache.html, restock-list.html, scout-alerts.html: tap-to-edit inline with green flash save

---

## Scout Alerts: is_core Yard Flag — 2026-04-05
- is_core boolean on yard table, set true for 4 LKQ NC yards only
- Foss/Young's/FL LKQ correctly non-core, FlywayService.getCoreYardIds() reads DB

---

## Scout Alerts: Confidence Matching Overhaul — 2026-04-05
- Part-type sensitivity: engine/drivetrain/trim verification per part type
- Real value comparison replaces existence checking
- Model conflict rejection, isExcludedPart() on alert generation

---

## Scout Alerts: Flyway Trip Filter — 2026-04-05
- Yard vehicle query filters by is_core OR active flyway trip
- Road trip yards no longer generate alerts after trip completion

---

## Global Part Value Colors + Exclusion Filter — 2026-04-05
- dh-parts.js/css: shared 6-tier system + isExcludedPart() across all 6 field pages
- Replaces inline badge CSS/JS on attack-list, adds badges to scout-alerts/cache/vin-scanner/gate/flyway

---

## Inline Edit: Cache Part Numbers + Scour Stream Want List — 2026-04-05
- PATCH /cache/:id — update partNumber (re-normalized via normalizePartNumber), partDescription, partType, make, model, year, notes
- PATCH /restock-want-list/:id — update title, notes on want list entries
- PATCH /restock-want-list/by-title — update by title match + sync scout_alerts.source_title
- cache.html: inline edit on part number and description (tap to edit, blur/Enter to save, green flash feedback)
- restock-list.html: inline edit on want list title and notes in WANT LIST tab
- scout-alerts.html: inline edit on STREAM alert source_title (patches want list + alert records)
- Files: CacheService.js, cache.js, restock-want-list.js, cache.html, restock-list.html, scout-alerts.html

---

## Scout Alerts is_core Yard Flag — 2026-04-05
- Added is_core boolean to yard table, set true for 7 NC local yards
- ScoutAlertService: WHERE yard.is_core = true OR active trip (replaces broken trip-absence inference)
- FlywayService.getCoreYardIds(): reads is_core flag instead of hardcoded name list
- FL LKQ yards no longer incorrectly protected from vehicle cleanup

---

## Scout Alerts Confidence Matching Rewrite — 2026-04-05
- scoreMatch() now verifies engine/drivetrain/trim MATCH, not just existence
- PART_TYPE_SENSITIVITY: engine-sensitive (ECM/PCM), drivetrain-sensitive (ABS), trim-sensitive (AMP/RADIO), universal (BCM/TIPM/etc.)
- Engine: displacement + cylinder + named engine comparison (mismatch = LOW, unknown = MEDIUM)
- Model conflicts: Cherokee ≠ Grand Cherokee, Transit ≠ Transit Connect, Wrangler ≠ Gladiator
- isExcludedPart() filters excluded parts before alert generation
- SELECT adds decoded_drivetrain, decoded_transmission, diesel, trim_tier, body_style

---

## Scout Alerts Trip Filtering — 2026-04-05
- generateAlerts() yard_vehicle query now filters by trip status
- Core yards (not in flyway_trip_yard) always generate alerts
- Flyway yards only generate alerts when their trip is active
- Vehicles from completed/expired trips excluded immediately (no 24h wait)

---

## Global Part Value Colors + Exclusion Filter — 2026-04-05
- Created dh-parts.js + dh-parts.css: shared 6-tier color system (getPartTier, renderPriceBadge, isExcludedPart)
- Wired into all 6 field pages: attack-list, scout-alerts, cache, vin-scanner, gate, flyway
- Global exclusion: engines, transmissions, body panels filtered; modules/trim/glass/steering allowed
- Backend isExcludedPart() updated: removed transfer case + steering rack (sellable), added trunk lid/roof panel

---

## Price Resolution + Badge Tiers — 2026-04-05
- Removed CONSERVATIVE_SELL_ESTIMATES — price chain now: market_demand_cache → Item.price (REF prefix) → NO DATA
- 6-tier part badges: ELITE gold pulse ($500+), PREMIUM purple pulse ($350+), HIGH blue, SOLID green, BASE orange, LOW red
- Category chips + vehicle score use same 6-tier colors based on highest part value
- BASE tier yellow→orange (#FF8C00) for visual distinction from gold

---

## Scout Alerts Cache Sync — 2026-04-05
- Scout alerts now use /cache/claimed-keys for shared truth with Daily Feed
- Three matching strategies: alertId, normalized PN (cross-tool), itemId (no-PN parts)
- Claim/unclaim syncs both cache entry and scout_alert claimed field
- Cross-tool: pull from Daily Feed → shows checkmark on Scout Alerts page

---

## Cache itemId Fallback — 2026-04-05
- Added item_id column to the_cache table (migration)
- CacheService.claim() accepts and stores itemId
- Dedup by itemId when partNumber is empty (sunroof glass, mirrors, etc.)
- GET /cache/claimed-keys returns both claimedPNs and claimedItemIds maps
- Frontend getCachedId() checks PN first, falls back to itemId

---

## Cache ↔ Attack List Sync — 2026-04-05
- GET /cache/claimed-keys endpoint — lightweight, returns normalized PNs + cache IDs
- CacheService.claim() deduplicates by normalizePartNumber() (Ford/Toyota/Honda/Chrysler suffix stripping)
- Frontend normalizePN() mirrors backend normalization exactly
- Pull button toggles: Pull → checkmark (claimed), checkmark → Pull (unclaimed via DELETE /cache/:id)
- Persists across page reloads — reads cache state on every page init

---

## QUARRY Frontend Fix — 2026-04-05
- Summary cards: d.summary.green/yellow/orange → d.summary.critical/low/watch
- Row fields: sold7d→timesSold, activeStock→inStock, action→urgency
- TIER_CONFIG keys updated from color names to urgency names

---

## Attack List Price Floors — 2026-04-05
- PART_PRICE_FLOORS constant in AttackListService: ABS=$150, electronic modules=$100
- Mechanical parts have no floor
- Below-floor parts flagged belowFloor:true, excluded from vehicle totalValue
- Frontend: collapsed "X parts below price floor" section, greyed at opacity 0.4

---

## Sniper Overhaul — 2026-04-05
- Replaced dead PriceCheckServiceV2 (eBay blocks axios) with Playwright+stealth
- Filtered to NC pull yards only (Raleigh, Durham, Greensboro)
- Newest vehicles only (first_seen >= 24h default, --hours CLI flag)
- Dry run verified: 192 vehicles → 50 PNs queued by price descending

---

## The Mark Management Page + Want List Push — 2026-04-04
- the-mark.html rebuilt: shows active marks with source badges (SKY/PERCH), status (HUNTING/IN-YARD/LISTED/SOLD)
- 'Send to want list' pushes mark to Scour Stream (restock_want_list)
- 'Remove' deletes mark, item returns to source list automatically
- Manual text entry adds directly to want list
- Sky Watch + Hunters Perch mark buttons confirmed working (already existed)
- Gap-intel already excludes marked items (already existed)

---

## QUARRY Velocity Scoring + Want List Auto-Sync — 2026-04-04
- Velocity ratio: sold_count / in_stock, urgency tiers CRITICAL/LOW/WATCH/FINE
- CRITICAL + LOW auto-added to restock_want_list (518 entries on first run)
- POST /restock/quarry-sync for manual trigger
- Runs after YourDataManager.syncAll (4x/day via cron)
- Cleanup: deactivates quarry_auto entries when velocity drops below threshold
- Scout Alerts reads want list via Hunters Perch source (no changes needed)
- Verified: 126 CRITICAL, 512 LOW, 133 WATCH

---

## Market Drip Rewrite — 2026-04-04
- Expanded importapart drip to 3-bucket priority queue: active inventory (1,151) + sold-not-restocked (1,583) + importapart catalog (9,009) = 10,912 unique PNs
- Comp quality filter: regex excludes as-is/untested/for-parts/core before averaging
- DELAY_MS: 15000 → 3000, batch: 34 → 200, cycle: 72 days → 18 days
- source: importapart_drip → market_drip
- Cache keys normalized to Clean Pipe, key_type='pn' on all upserts
- Fixed dirty keys in market_demand_cache

---

## QUARRY: Pure SQL rewrite with Clean Pipe columns — 2026-04-04
- restockReport.js rewritten: pure SQL grouping by partNumberBase/extractedMake/extractedModel
- No runtime title parsing — all extraction done at write time via Clean Pipe
- Stock lookup: exact key (pn+make+model) then pn-only fallback, both from SQL aggregation
- Market enrichment from market_demand_cache by partNumberBase
- Verified: 100 results, 93 green tier, 1,632 sales analyzed

---

## Sniper: Batch Size 15→35, Priority Queue, Preview — 2026-04-04
- PriceCheckCronRunner batch size 15→35 (70 weeks full coverage vs 163)
- Queue priority: never-checked first, highest price first, oldest check last
- Single LEFT JOIN SQL replaces ORM two-query approach
- GET /pricing/sniper-preview for dry-run queue inspection
- 2,449 active listings, all never-checked

---

## Attack List Scoring Upgrades — 2026-04-04
- Stock penalty scaling: 5% (1 in stock) → 70% (5+ in stock) multiplicative reduction on score
- Fresh arrival bonus: +10% for ≤3 days, +5% for ≤7, +2% for ≤14 days
- COGS yard factor: cheap yards +5%, expensive -5% (uses entry_fee + tax_rate)
- All factors multiplicative, applied after additive scoring, capped 0-100
- Yard profiles loaded once per call (no per-vehicle queries)
- Verified: 0 NaN, healthy distribution across 1,500 vehicles

---

## [Clean Pipe E5] Phoenix PN Joins — 2026-04-04
- Phoenix SoldItem matching uses partNumberBase column for direct lookup (replaces title scanning)
- Standalone group creation uses extractedMake/partType columns
- pnBaseSet keys normalized to match Clean Pipe format
- Verified: 10 results with healthy scores (TIPM 80, CLUSTER 80, HVAC 68)

---

## [Clean Pipe E4] Competitor Intel Routes — 2026-04-04
- gap-intel, best-sellers, emerging routes now group SoldItems by partNumberBase (exact) with normalizeTitle fallback
- Added partNumberBase/partType to query SELECTs for all 3 routes
- gap-intel and emerging use Clean Pipe partNumberBase and partType in output
- Same scoring formulas, same API response shape, backward compatible

---

## 2026-04-04 — Active Inventory CSV Import + Zero Qty Fix
- **Active Inventory CSV import** on /admin/import — store selector, flexible column mapping, preview, upsert to YourListing
- 368 Autolumen listings imported — stock index now sees both stores (fixes Autolumen blind spot)
- **Zero quantity = Ended** — universal rule across API sync and CSV import paths
- CSV import deactivation pass — listings missing from file marked Ended
- One-time cleanup: 290 ghost Active listings with qty=0 deactivated

---

## [Clean Pipe E3] Sales Index Optimization — 2026-04-04
- buildSalesIndex() reads extractedMake, extractedModel, partType from YourSale columns first
- Falls back to title parsing only when columns are NULL
- Eliminates ~14,600 regex parses per attack list load (90-day sales window)
- Verified: 351 make/model combos, 1,616 sales indexed

---

## [Clean Pipe E2] Stock Index Optimization — 2026-04-04
- buildStockIndex() reads new columns first (partNumberBase, extractedMake, extractedModel)
- Falls back to title parsing only when columns are NULL
- Eliminates ~2,400 regex parses per attack list load
- Verified: 574 make/model combos, 4,322 PNs indexed

---

## [Clean Pipe E1] Sniper PN Cleanup — 2026-04-04
- sanitizePartNumberForSearch() and deduplicatePNQueue() added to partIntelligence.js
- Strips Ford ECU suffixes to searchable base (12A650, 14A067 patterns)
- Rejects junk PNs: model names, VIN fragments, concatenated keywords, short/long garbage
- Wired into run-yard-market-sniper.js — sanitizes + deduplicates queue before scraping
- Expected: dramatically improved sniper hit rate (was 1/50 due to junk PNs)

---

## [Clean Pipe Phase D] Cache Key Standardization — 2026-04-04
- market_demand_cache: added key_type column (pn/ymm), normalized all PN keys (stripped spaces/dashes/dots)
- 74 keys renamed, 0 duplicates found, 582 PN + 8 YMM total
- Updated MarketPricingService, PriceCheckService, MarketDemandCronRunner writers to normalize before insert
- Updated priceResolver.js reader to normalize lookup keys
- Cache keys now joinable with YourSale/YourListing/SoldItem partNumberBase columns

---

## [Clean Pipe Phase C] Wire Insert Paths — 2026-04-04
- Wired extractStructuredFields() into all insert/upsert paths
- YourDataManager: syncOrders (YourSale) + syncListings (YourListing)
- SoldItemsManager: competitor scrape inserts (SoldItem) — scrapeCompetitor + scrapeByKeywords
- AutolumenImportService: CSV import inserts (YourListing + YourSale) — all 3 import methods
- All new records automatically get partNumberBase, partType, extractedMake, extractedModel

---

## [Clean Pipe Phase B] Backfill Existing Records — 2026-04-04
- Backfilled partNumberBase, partType, extractedMake, extractedModel on all YourSale (14,603), YourListing (4,365), SoldItem (1,248) rows
- Script: service/scripts/backfill-clean-pipe.js (rerunnable, skips already-processed rows)
- partType='OTHER' used as processed sentinel for rows with no detectable part type
- Cross-table joins by partNumberBase now functional (verified: Ford ECM 623 sales / 77 competitor / 110 in stock)

---

## [Clean Pipe Phase A] Schema + Extraction Utility — 2026-04-04
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- 8 indexes for cross-table joins (partNumberBase, partType, extractedMake)
- extractStructuredFields() in partIntelligence.js: extracts PN base, part type, make, model from any title
- Make normalization map (47 entries) with title-case output matching corgi VIN decoder
- Model pattern list (200+ models) with multi-word priority (Grand Cherokee before Cherokee)
- detectPartType() added to partIntelligence.js (self-contained copy from AttackListService)
- Tested 11 titles: Grand Cherokee, Silverado 1500, BMW 5 Series, Datsun 280ZX all correct
- Columns exist on prod, all NULL — backfill (Phase B) and insert wiring (Phase C) coming next

---

## [Phase 9] Local VIN Decoder — 2026-04-03
- Installed @cardog/corgi for offline VIN decoding (eliminates all NHTSA API calls)
- Created vin_decoder schema with manufacturers, vds_trim_lookup, engine_codes, name_aliases tables
- Seeded GM, Chrysler, Honda, Ford trim and engine lookup data
- Built LocalVinDecoder singleton service (service/lib/LocalVinDecoder.js)
- Rewired 5 NHTSA callers: PostScrapeService, VinDecodeService, VIN routes, attack list
- Fixed tonnage series values leaking into trim field
- Fixed chassis codes (MCX20L) filtered by cleanDecodedTrim()
- Added engine fallback for null corgi engine data
- Added /vin/test-local/:vin diagnostic endpoint
- Pre-initializes decoder on app startup
- Tested 20 real VINs: 20/20 year/make/model, 20/20 drivetrain, 15/20 engine improved
- Full intelligence diagnostic run: attack list healthy, 5 tuning items identified
- **Added:** @cardog/corgi for offline VIN decoding (sub-15ms, zero network, ~20MB bundled SQLite)
- **Added:** vin_decoder schema with manufacturers, vds_trim_lookup, engine_codes, name_aliases tables
- **Added:** GM/Chrysler/Honda/Ford trim and engine code seed data
- **Added:** LocalVinDecoder singleton service (corgi + VDS enrichment pipeline)
- **Added:** /vin/test-local/:vin diagnostic endpoint
- **Changed:** PostScrapeService.decodeBatch() → local decode (was NHTSA batch API)
- **Changed:** VinDecodeService.decode() → local decode (was NHTSA single VIN API)
- **Changed:** /vin/decode-photo and /vin/scan routes → local decode
- **Changed:** attack-list manual VIN decode → local decode
- **Changed:** nixpacks.toml adds python3 + build-essential for better-sqlite3
- **Removed:** All NHTSA API calls (zero remain in codebase)
- **Removed:** NHTSA rate limit sleeps (200ms, 1000ms, 2000ms)
- **Files touched:** package.json, nixpacks.toml, migration (new), LocalVinDecoder.js (new), PostScrapeService.js, VinDecodeService.js, vin.js, attack-list.js, index.js
- **Affects:** All VIN decoding across DarkHawk — post-scrape, cron, VIN scanner, manual lists
- **Notes:** Decoder pre-inits on startup. VDS enrichment falls back gracefully if tables not yet migrated.

---

## [2026-04-01] Homepage section links + Autolumen uploads placement
- **Added:** home.html at /admin/home — DarkHawk homepage with categorized section links (Field/Intel/Inventory/Tools)
- **Moved:** Autolumen Sync card from gate.html to home.html (both Active Listings + Sales History uploads)
- **Changed:** gate.html stripped to Nest Protector only (stock check + COGS)
- **Changed:** DarkHawk logo in dh-nav.js links to /admin/home instead of /
- **Files touched:** home.html (new), gate.html, dh-nav.js, index.js
- **Notes:** Root / still serves React SPA (DynaTrack inventory). DarkHawk homepage is /admin/home.

---

## [2026-04-01] Fix: Cache check-stock matches Nest Protector accuracy
- **Fixed:** cache.html sent `part_number` param but both `/cogs/check-stock` and `/cache/check-stock` expect `pn`
- **Fixed:** cache.html parsed `/cogs/check-stock` response as `d.results` instead of `d.exact`/`d.variants`
- **Fixed:** cache.html parsed `/cache/check-stock` response as `d.results` instead of `d.cached`
- **Files touched:** cache.html
- **Notes:** Cache check-stock now produces identical results to Nest Protector for the same PN input

---

## [2026-04-01] The Cache Phase 7 Part 2 — Frontend + Puller Tool Wiring
- **Added:** cache.html — Active/History/Add Part tabs, mobile-first, manual entry by PN or YMM
- **Added:** Pull buttons on Daily Feed, Hawk Eye, Flyway expanded parts
- **Added:** THE CACHE nav link in dh-nav.js (between Scout Alerts and Hawk Eye)
- **Changed:** Daily Feed markPulled() → claimPart() via POST /cache/claim
- **Changed:** Scout Alerts claim handler → routes through /cache/claim (server marks alert claimed)
- **Changed:** Hawk Eye shows cachedParts notice and Pull buttons on scan results
- **Changed:** gate.html stock check shows "In The Cache" section for cached claims
- **Files touched:** cache.html (new), dh-nav.js, attack-list.html, scout-alerts.html, vin-scanner.html, flyway.html, gate.html, index.js
- **Affects:** All puller tools, stock checks, nav across all pages
- **Notes:** Source badges color-coded: daily_feed=red, scout_alert=orange, hawk_eye=teal, flyway=blue, manual=gray

---

## [2026-04-01] Fix: the_cache migration + CacheService.getStats()
- **Fixed:** Store column migration failed on prod because column already existed — made idempotent with `hasColumn` check
- **Fixed:** Cache migration blocked by store column migration failure — both now run with existence guards
- **Fixed:** `CacheService.getStats()` destructured `database.raw()` result incorrectly for pg driver — returns `{ rows }` not array
- **Removed:** Temporary diagnostic endpoints (`/api/migrate-status`, `/api/run-migrations`)
- **Files touched:** migrations/20260401300000, migrations/20260401400000, CacheService.js, index.js
- **Notes:** Migrations now recorded in knex_migrations (batch 51). All /cache endpoints verified working on production.

---

## [2026-04-01] The Cache Phase 7 Part 1 — Backend
- **Added:** `the_cache` table with UUID PK, vehicle/part/yard fields, status lifecycle (claimed→listed/returned/deleted)
- **Added:** CacheService — claim, return, delete, resolve, stats, checkCacheStock
- **Added:** /cache routes — active, history, stats, claim, return, delete, resolve, check-stock
- **Added:** Manual entry via source='manual' (by PN or by YMM+description)
- **Changed:** YourDataManager.syncAll now runs cache auto-resolution after listing sync (4x/day)
- **Changed:** /cogs/check-stock returns cachedClaims alongside YourListing results
- **Changed:** /vin/scan returns cachedParts for scanned vehicle
- **Files touched:** migration (new), CacheService.js (new), routes/cache.js (new), YourDataManager.js, cogs.js, vin.js, index.js
- **Affects:** Stock checks (Nest Protector + Hawk Eye), VIN scanner, all puller tools
- **Notes:** Scout alert cross-linking: claim marks alert claimed, return re-activates. Phase 7 Part 2 (frontend) not yet built.

---

## [2026-04-01] Autolumen Multi-Store Integration
- **Added:** `store` column on YourListing and YourSale (default: 'dynatrack')
- **Added:** AutolumenImportService — CSV import for active listings, orders, and transaction reports
- **Added:** /autolumen routes (import/listings, import/sales, import/transactions, stats)
- **Added:** Collapsible Autolumen Sync card on Nest Protector (gate.html)
- **Added:** DYNATRACK/AUTOLUMEN store badges on stock check results
- **Changed:** YourDataManager deactivation sweep scoped to store='dynatrack'
- **Changed:** StaleInventoryService scoped to store='dynatrack'
- **Changed:** check-stock API now returns `store` field on results
- **Files touched:** migration (new), AutolumenImportService.js (new), routes/autolumen.js (new), YourDataManager.js, cogs.js, gate.html, StaleInventoryService.js, index.js, package.json
- **Affects:** Stock checks, attack list scoring, restock flags, overstock watch, stale inventory automation
- **Notes:** All existing services automatically see both stores — no store filter in AttackListService. StaleInventoryService and YourDataManager are the only places scoped to dynatrack.

---

## [2026-04-01] Workflow Infrastructure
- **Added:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Purpose:** Prevent Claude Code sessions from overwriting each other's work
- **Files:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Notes:** Every future session reads these files first before touching code

---

<!-- TEMPLATE FOR NEW ENTRIES (copy and fill in at top of file):

## [YYYY-MM-DD] Short Description
- **Changed:** What was modified
- **Added:** What was created
- **Fixed:** What bugs were resolved
- **Files touched:** List every file modified
- **Affects:** What downstream features are impacted
- **Notes:** Anything the next session needs to know

-->
