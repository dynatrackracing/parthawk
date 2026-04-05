# SNAPSHOT_SERVICES.md
Generated 2026-04-05

## Core Services

### AttackListService.js
- Purpose: Scores yard vehicles by pull value — matches yard vehicles against Auto+Item inventory, YourSale history, and YourListing stock
- Key methods: `buildInventoryIndex()`, `buildSalesIndex()`, `buildStockIndex()`, `scoreVehicle()`, `findMatchedParts()`, `getAttackList()`, `getAllYardsAttackList()`
- Clean Pipe: `buildStockIndex` + `buildSalesIndex` read `extractedMake`/`extractedModel`/`partNumberBase` columns first, title-parsing fallback only when null
- Scoring upgrades:
  - Stock penalty scaling: 1 in stock=-5%, 2=-15%, 3=-30%, 4=-50%, 5+=-70%
  - Fresh arrival bonus: <=3 days=+10%, <=7 days=+5%, <=14 days=+2%
  - COGS yard factor: cheaper yards get +/-5% via `_yardCostFactor`
  - Mark boost: parts matching `the_mark` get +15 score bonus
- Price resolution: market_demand_cache first, conservative sell estimates fallback (never Item.price)
- Part filtering: PN-specific parts require exact year; generational parts get +/-1 tolerance; engine/drivetrain/fuel validated
- **Price floors:** `PART_PRICE_FLOORS` constant — ABS=$150, ECM/BCM/TCM/TIPM/CLUSTER/RADIO/THROTTLE/AMP/ECU=$100. Parts below floor flagged `belowFloor:true`, excluded from vehicle `totalValue`. Mechanical parts (mirrors, visors, console lids) have no floor.

### CacheService.js (The Cache)
- Purpose: Full lifecycle for claimed parts — yard claim through eBay listing
- Key methods: `claim()`, `returnToAlerts()`, `deleteClaim()`, `manualResolve()`, `resolveFromListings()`, `getActiveClaims()`, `getClaimedKeys()`, `getHistory()`, `getStats()`, `checkCacheStock()`
- Sources: daily_feed, scout_alert, hawk_eye, flyway, manual
- Statuses: claimed -> listed / returned / deleted
- **claim():** Accepts `itemId` field (for parts without PNs like sunroof glass, mirrors). Stores `item_id` on cache entry. Normalizes `partNumber` via `normalizePartNumber()` before storing. Dedup logic: if PN exists → match by normalized PN; if no PN but itemId → match by itemId; if both empty → allow (manual entries).
- **getClaimedKeys():** Returns three maps for puller tool sync: `claimedPNs` (normalizedPN → cacheId), `claimedItemIds` (itemId string → cacheId for no-PN parts), `claimedAlertIds` (scout alert id → cacheId). Used by Daily Feed and Scout Alerts pages.
- Auto-resolve: `resolveFromListings()` matches cache entries against YourListing by PN or make+model+partType (listing must be created AFTER claim). Runs after every sync (4x/day)

### COGSService.js
- Purpose: True COGS = parts cost + gate fee (no tax, no mileage). Target spend 30%, ceiling 35%, per-part color coding
- Key methods: `getYardProfile()`, `calculateGateMax()`, `calculateSession()`

### FlywayService.js
- Purpose: Multi-yard trip planning CRUD — trips, yard routing, trip-specific attack lists, auto-complete expired trips
- Key methods: `getTrips()`, `createTrip()`, `getFlywayAttackList()`, `cleanupExpiredTripVehicles()`

## Intelligence Services

### PhoenixService.js
- Purpose: Rebuild seller intelligence — groups competitor catalog by partNumberBase, matches against SoldItem velocity, enriches with market_demand_cache
- Key methods: `getRebuildSellers()`, `addRebuildSeller()`, `getPhoenixStats()`, `getPhoenixList()`
- SoldItem matching: FAST PATH uses `partNumberBase` column lookup (E5) for direct PN match; SLOW PATH title scan fallback for records without partNumberBase
- Scoring: `calcPhoenixScore()` — velocity (35pts), revenue (25pts), price sweet spot (20pts), market demand (20pts)
- Three layers: (1) Item catalog with fitment, (2) SoldItem velocity, (3) market_demand_cache

### ScoutAlertService.js
- Purpose: Generates yard-vehicle alerts by matching want-list parts, sold history, and marks against active yard inventory
- Key methods: `generateAlerts()` (concurrency-guarded, one-at-a-time)
- Reads: `the_mark` (active marks, highest priority PERCH alerts) + `restock_want_list` (Hunters Perch) + `YourSale` (bone pile, sold items with low/no stock) + `restock_flag`
- Matching: make+model required, year within range; confidence HIGH/MEDIUM based on engine/trim verification
- Stock filter: skips bone_pile parts that have matching active YourListing PNs
- Atomic refresh: deletes + re-inserts in transaction, preserves claimed status

### CompetitorMonitorService.js
- Purpose: Advisory alerts — underpriced vs market, competitor dropout, competitor undercut

### FitmentIntelligenceService.js
- Purpose: Fitment negations via "subtraction" — what's in eBay taxonomy but NOT in compatibility table = does not fit

### MarketPricingService.js
- Purpose: Batch market pricing for Daily Feed — dedupes by PN, checks market_demand_cache (90-day TTL), scrapes uncached via PriceCheckServiceV2 (axios+cheerio — blocked on Railway, works locally); V1 Playwright fallback

### ListingIntelligenceService.js
- Purpose: Aggregates intelligence for a single listing — programming, trim tier, fitment cache, sales history

## Restock & Inventory

### restockReport.js (THE QUARRY) — `service/routes/restockReport.js`
- Purpose: Restock intelligence using Clean Pipe columns only (no Item table, no title scanning)
- Key methods: `GET /report` (velocity scoring), `quarrySync()` (auto-adds to want list)
- Urgency tiers: CRITICAL (ratio>=4 or 0 stock+sold 3x+$100+), LOW (ratio>=2 or 0 stock), WATCH (ratio>=1)
- Scoring: price (35pts), stock gap (30pts), velocity (20pts), recency (15pts); floor overrides for high-value zero-stock
- Response shape: `{ tiers: { critical:[], low:[], watch:[] }, summary: { critical, low, watch, total, salesAnalyzed, activeListings }, items:[] }`
- `quarrySync()`: auto-adds CRITICAL+LOW to `restock_want_list` with `[quarry_auto]` notes; cleans entries where velocity dropped below LOW. Called by YourDataManager after syncAll (4x/day)

### RestockService.js
- Purpose: Flags parts where sold >= 2x active stock in 90 days. Writes to `restock_flag` table
- Key methods: `scanAndFlag()`, `getFlags()`, `acknowledge()`

### DeadInventoryService.js
- Purpose: Identifies stale listings needing action based on days listed, market demand, competition

### OverstockCheckService.js
- Purpose: Monitors overstock watch groups — triggers alerts when stock thresholds exceeded
- Key methods: `checkAll()` — runs after every YourData sync

### StaleInventoryService.js
- Purpose: Automated price reductions via TradingAPI. 60d=-10% through 270d=-30%. No comps = hold and flag

## Data Sync & Import

### YourDataManager.js — `service/managers/YourDataManager.js`
- Purpose: Syncs YOUR eBay seller data (orders + listings) via SellerAPI
- Key methods: `syncAll()`, `syncOrders()`, `syncListings()`, `getStats()`
- Clean Pipe: both `syncOrders` and `syncListings` call `extractStructuredFields(title)` to populate partNumberBase, partType, extractedMake, extractedModel
- Post-sync chain in `syncAll`: (1) OverstockCheckService.checkAll(), (2) CacheService.resolveFromListings(), (3) **quarrySync()** — auto-adds CRITICAL+LOW velocity parts to want list
- Deactivation: marks dynatrack listings not in current sync as Ended

### AutolumenImportService.js
- Purpose: CSV import for Autolumen (second eBay store) — active listings, sales history, transactions
- Key methods: `importActiveListings()`, `importSalesHistory()`, `importTransactions()`, `getStats()`
- Clean Pipe: calls `extractStructuredFields(title)` on every insert for partNumberBase, partType, extractedMake, extractedModel

### SoldItemsManager.js — `service/managers/SoldItemsManager.js`
- Purpose: Scrapes competitor sold items via Playwright, stores in SoldItem. Uses `extractStructuredFields()` on store

## VIN & Vehicle Services

### PostScrapeService.js
- Purpose: Universal post-scrape enrichment — runs after ANY yard scraper completes
- Key methods: `enrichYard(yardId)`
- Pipeline: (1) Batch VIN decode via `LocalVinDecoder.decodeBatchLocal()` (50/call, offline), (2) Trim tier matching (TrimTierService + trim_catalog + static config), (3) Scout alerts (non-blocking)
- Uses LocalVinDecoder — NOT NHTSA API

### VinDecodeService.js
- Purpose: Single-VIN and batch decode with caching
- Key methods: `decode(vin)`, `decodeAllUndecoded()`
- Delegates to LocalVinDecoder (offline corgi + VDS enrichment) — no external API calls

### TrimTierService.js
- Purpose: Trim tier lookup — 3-tier cascade: trim_tier_reference (curated), trim_catalog (eBay Taxonomy), static config fallback

## Pricing Services

### PriceCheckServiceV2.js
- Purpose: eBay sold comp scraper — axios+cheerio, no Chromium/OOM risk. Pipeline: buildSearchQuery -> scrapeSoldComps -> filterRelevantItems -> calculateMetrics
- **Status:** Blocked by eBay "Pardon Our Interruption" challenge page on Railway (HTTP 200 but captcha HTML). Still referenced as fallback by MarketPricingService. Yard sniper replaced with Playwright+stealth.

### PriceCheckService.js (V1)
- Purpose: Original Playwright-based eBay price check — persistent browser with stealth plugin

### PricingService.js / PricePredictionService.js
- Purpose: Optimal price suggestions and ML-based price prediction from historical/competitor/market data

## Other Managers

### CompetitorManager.js — returns all enabled competitor sellers (single method)
### ItemDetailsManager.js — fetches full eBay item details via Trading API (compatibility, specifics)
### MarketResearchManager.js — orchestrates market research: scrape competitors + sold items, store linked data
### SellerItemManager.js — fetches competitor listings from eBay Findings/Browse API
### UserManager.js — Firebase user CRUD with CacheManager

## Utility Services

### PartNumberService.js / PartLocationService.js — PN normalization + location/bin tracking for pullers
### ReturnIntakeService.js / ReturnIntelligenceService.js — return processing (grade A/B/C relist) + return pattern analysis
### EbayMessagingService.js — queue-based post-purchase buyer messaging with templates and retry
### DemandAnalysisService.js / OpportunityService.js / TrimIntelligenceService.js — demand scoring, opportunity detection, trim-level research
### WhatToPullService.js / InstantResearchService.js / ApifyResearchService.js — part-pull recommendations, on-demand vehicle research, batch scraping
### LifecycleService.js / LearningsService.js — lifecycle metrics (time-to-sell, seasonal) + aggregated learnings from dead/return/stale patterns
### AutoService.js — Auto (vehicle) table CRUD and eBay taxonomy compatibility
### ItemLookupService.js — inventory item CRUD with eBay compatibility lookups
