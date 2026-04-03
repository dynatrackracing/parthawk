# SNAPSHOT_SERVICES.md — DarkHawk Service Layer

> Generated: 2026-04-01 | Source: `service/services/` (37 files)

## Service Index

| Service | Purpose |
|---------|---------|
| `PostScrapeService.js` | Universal post-scrape enrichment: VIN decode + trim tier + scout alerts |
| `AttackListService.js` | Vehicle scoring engine for junkyard pull prioritization |
| `CacheService.js` | "The Cache" -- claimed parts lifecycle (claim/return/resolve/auto-match) |
| `AutolumenImportService.js` | CSV import for Autolumen (second eBay store) listings and sales |
| `VinDecodeService.js` | VIN decode wrapper (delegates to LocalVinDecoder) |
| `StaleInventoryService.js` | Automated stale listing price reductions via eBay TradingAPI |
| `ScoutAlertService.js` | Generates alerts when yard vehicles match profitable sales patterns |
| `FlywayService.js` | Flyway trip CRUD + yard management |
| `TrimTierService.js` | Trim tier lookup (base/mid/premium/luxury classification) |
| `PriceCheckService.js` | Per-listing eBay sold comp price checks (Playwright-based) |
| `PricingService.js` | Pricing intelligence and recommendations |
| `MarketPricingService.js` | Market pricing pass -- batch eBay sold comp scraping |
| `CompetitorMonitorService.js` | Competitor seller monitoring and alerts |
| `DemandAnalysisService.js` | Sell-through rates, velocity, demand dashboards |
| `COGSService.js` | Cost of goods tracking (gate receipts, pull sessions) |
| `OpportunityService.js` | Untapped opportunity detection from market gaps |
| `RestockService.js` | Restock recommendations from sales velocity |
| `PhoenixService.js` | Phoenix competitor dead-listing harvesting |
| `EbayMessagingService.js` | eBay message polling and auto-response |
| `ReturnIntelligenceService.js` | Return pattern analysis by part type/make |
| `FitmentIntelligenceService.js` | Fitment data and cross-reference intelligence |
| `ListingIntelligenceService.js` | Listing optimization intelligence |
| `InstantResearchService.js` | Quick market research via Apify/eBay APIs |
| `ItemLookupService.js` | Part number and fitment lookup |
| `PartNumberService.js` | Part number management |
| `PartLocationService.js` | Where-to-find-it guides for parts on vehicles |
| `WhatToPullService.js` | Pull prioritization based on demand data |
| `DeadInventoryService.js` | Dead/ended listing tracking |
| `LifecycleService.js` | Listing lifecycle analytics |
| `LearningsService.js` | Historical learnings and insights |
| `OverstockCheckService.js` | Overstock detection and alerts |
| `PricePredictionService.js` | Price prediction models |
| `TrimIntelligenceService.js` | Trim-level value intelligence |
| `AutoService.js` | Auto (vehicle) CRUD operations |
| `ApifyResearchService.js` | Apify integration for eBay research |
| `PriceCheckServiceV2.js` | Next-gen price check service |
| `ReturnIntakeService.js` | Return intake processing |

---

## PostScrapeService.js

**Purpose:** Universal post-scrape enrichment pipeline -- runs after ANY scraper completes.

**Key Methods:**
- `enrichYard(yardId)` -> `{ vinsDecoded, trimsTiered, errors }`
- `decodeBatch(vins)` -- delegates to `LocalVinDecoder.decodeBatchLocal()`
- `lookupTrimTier(year, make, model, trim, engine, trans, drivetrain)` -> `{ tier, extra }`
- `cleanDecodedTrim(raw)` -- filters junk trim values
- `titleCase(str)` -- helper

**Enrichment Pipeline:**
1. Batch VIN decode (50 per batch) via LocalVinDecoder
2. Trim tier matching: `TrimTierService` -> `trim_catalog` table -> static config fallback
3. Updates `yard_vehicle` with: engine, engine_type, drivetrain, trim_level, trim_tier, body_style, audio_brand, expected_parts, is_diesel, cult_vehicle
4. Scout alerts generated in background (non-blocking)

**Dependencies:** `LocalVinDecoder`, `TrimTierService`, `trim-tier-config`, `database`

---

## AttackListService.js

**Purpose:** Scores junkyard vehicles for pull prioritization based on sales data, market demand, and inventory.

**Key Methods:**
- `getAttackList(yardId, options)` -- main entry, returns scored + sorted vehicle list
- `buildInventoryIndex()` -- indexes active YourListing items by make+model (10min cache)
- `buildSalesIndex(cutoff)` -- indexes YourSale by make+model with revenue/units (10min cache)
- `buildStockIndex()` -- indexes current stock levels by part number (10min cache)
- `buildPlatformIndex()` -- pre-loads platform siblings for sync scoring
- `scoreManualVehicles(vehicles, options)` -- scores vehicles not from scraper
- `getAllYardsAttackList(options)` -- cross-yard attack list
- `loadValidationCache()` -- loads part intelligence validation data

**Key Patterns:**
- All index methods use 10-minute in-memory TTL caches (`INDEX_CACHE_TTL`)
- `isExcludedPart(title)` -- filters engines, transmissions, body panels, transfer cases
- `PN_EXACT_YEAR_TYPES` -- ECM/PCM/BCM/TIPM/etc require exact year match (no +/-1)
- `CONSERVATIVE_SELL_ESTIMATES` -- fallback prices by part type when no market data
- Uses `priceResolver.resolvePricesBatch()` for market data enrichment
- Platform bonus via `platformMatch.getPlatformMatches()`

**Dependencies:** `platformMatch`, `partIntelligence`, `trim-tier-config`, `TrimTierService`, `priceResolver`, `database`

---

## CacheService.js

**Purpose:** Manages "The Cache" -- the claimed-parts pipeline from yard sighting to eBay listing.

**Key Methods:**
- `claim({ partType, partNumber, vehicle, yard, source, ... })` -> `{ id, ...entry }`
- `returnToAlerts(cacheId, reason)` -- returns part, re-activates scout alert if applicable
- `deleteClaim(cacheId)` -- soft delete (does NOT re-activate alerts)
- `manualResolve(cacheId, ebayItemId)` -- mark as listed manually
- `resolveFromListings()` -- auto-match claimed parts against new YourListings (runs 4x/day)
- `getActiveClaims({ source, claimedBy, sortBy })` -- query active claims
- `getHistory({ days, limit })` -- resolved entries
- `getStats()` -- dashboard stats (active/listed/returned/avg days to list)
- `checkCacheStock({ partNumber, make, model, year, partType })` -- check if part already claimed

**Valid Sources:** `daily_feed`, `scout_alert`, `hawk_eye`, `flyway`, `manual`

**Auto-resolve logic:** Matches by part number (SKU or title) or by make+model+partType. Listing must be created AFTER claim date.

**Dependencies:** `database`, `logger`, `partNumberUtils`

---

## AutolumenImportService.js

**Purpose:** CSV import for the Autolumen second eBay store -- handles both active listings and sales history.

**Key Methods:**
- `importActiveListings(csvText)` -- deactivates old Autolumen listings, upserts new ones
- `importSalesHistory(csvText)` -- imports sold item records
- `parseCSV(text)` -- csv-parse/sync wrapper
- `col(row, possibleHeaders)` -- flexible column name matching

**Pattern:** Transaction-wrapped; deactivates all existing `store='autolumen'` listings before inserting new batch.

**Dependencies:** `database`, `csv-parse/sync`, `logger`

---

## VinDecodeService.js

**Purpose:** VIN decode service class -- now delegates entirely to LocalVinDecoder.

**Key Methods:**
- `decode(vin)` -- returns `{ year, make, model, trim, engine, engineType, drivetrain, bodyStyle }`
- `decodeAllUndecoded()` -- batch decodes up to 200 undecoded `yard_vehicle` VINs
- `parseNHTSA(results)` -- legacy NHTSA response parser (still used for old cached data)
- `formatCached(row)` -- format vin_cache row

**Dependencies:** `LocalVinDecoder`, `database`, `logger`

**Gotchas:** `decodeAllUndecoded()` no longer needs rate limiting (local decode, no API calls)

---

## StaleInventoryService.js

**Purpose:** Automated price reductions for stale eBay listings via TradingAPI.

**Standard Schedule:** 60d=-10%, 90d=-15%, 120d=-20%, 180d=-25%, 270d=-30%+flag

**Programmed Schedule (slower):** 90d=-5%, 180d=-10%, 270d=-15%+flag

**Rule:** No comps available = hold and flag, do not reduce. Ended listings logged to `dead_inventory`.

**Dependencies:** `database`, `axios`, `xml2js`, `logger`

---

## ScoutAlertService.js

**Purpose:** Generates alerts when active yard vehicles match profitable sales patterns.

**Key Methods:**
- `generateAlerts()` -- main entry (concurrency-guarded, single instance)

**Safety:** Checks DB size before running -- skips if >4GB (on 5GB Railway volume)

**Dependencies:** `database`, `logger`, `partMatcher`, `partIntelligence`

**Gotchas:** Uses module-level `_running` flag as concurrency guard (not async-lock)
