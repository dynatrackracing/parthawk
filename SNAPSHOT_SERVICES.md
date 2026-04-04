# SNAPSHOT_SERVICES.md — PartHawk Service Layer

> Generated: 2026-04-04 | Source: `service/services/` (37 files), `service/managers/` (7 files)

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
| `EbayMessagingService.js` | eBay post-purchase messaging queue (template-based, auto-send via TradingAPI) |
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

## Manager Index

| Manager | Purpose |
|---------|---------|
| `YourDataManager.js` | Syncs YOUR eBay seller data (orders + listings) to database |
| `SoldItemsManager.js` | Fetches competitor sold items via Playwright scraping |
| `MarketResearchManager.js` | Orchestrates market research (comps, pricing, competitors) for inventory |
| `ItemDetailsManager.js` | eBay GetItem detail fetching + interchange number parsing |
| `SellerItemManager.js` | Competitor active-listing ingestion via BrowseAPI |
| `CompetitorManager.js` | Competitor seller CRUD (enabled/disabled) |
| `UserManager.js` | Firebase user auth + verification + caching |

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
- `_generateAlertsInner()` -- actual logic, called inside concurrency guard

**Alert Sources:**
1. **Hunters Perch** (`restock_want_list`) -- manual want list items matched against yard vehicles
2. **Bone Pile** (`YourSale` last 90 days, >= $50) -- recently sold items matched against yard vehicles, filtered to exclude parts already in stock
3. **The Mark** (`the_mark` table) -- highest-priority active marks matched against vehicles

**Bone Pile Stock Filter:** Extracts part numbers from active `YourListing` titles, skips bone_pile parts where any extracted PN matches current stock. Logs filter stats.

**Safety:**
- Concurrency guard: module-level `_running` flag prevents overlapping runs
- Disk space check: skips if DB > 4GB (on 5GB Railway volume)
- Snapshots claimed alerts before wipe so they can be restored after regeneration

**Dependencies:** `database`, `logger`, `partMatcher`, `partIntelligence`

---

## EbayMessagingService.js

**Purpose:** Queue-based eBay buyer messaging system. Queues post-purchase thank-you messages with a 15-minute delay, then processes them via TradingAPI `AddMemberMessageAAQToPartner`.

**Key Methods:**
- `queuePostPurchase(order, ebayStore)` -- queues a `post_purchase` message with 15min delay; idempotent via `ON CONFLICT DO NOTHING`
- `processQueue()` -- claims pending rows (limit 20), renders templates, sends via TradingAPI, logs results. Called by cron every 2 minutes.
- `_processQueueEntry(entry)` -- single entry: fetch template -> build variables -> render -> send -> log
- `_renderTemplate(templateText, variables)` -- `{VAR}` placeholder replacement
- `_buildTemplateVariables(entry)` -- resolves `ITEM_TITLE`, `ITEM_ID`, `ORDER_ID`, `BUYER_USER_ID` from YourSale/YourListing

**Queue Lifecycle:** `pending` -> `claimed` (by worker) -> `sent` | `failed` (retry up to 3x) | `pending` (auth token 932 auto-retry)

**Safety:** Stale claim recovery -- entries claimed > 10 minutes ago are reset to pending (crashed worker protection).

**Tables:** `ebay_message_queue`, `ebay_message_templates`, `ebay_messages` (log)

**Dependencies:** `database`, `SellerAPI`, `logger`

---

## YourDataManager.js

**Purpose:** Syncs YOUR eBay seller data (orders and listings) to the database. Central sync orchestrator.

**Key Methods:**
- `syncAll({ daysBack })` -- full sync: orders + listings + overstock check + cache auto-resolve
- `syncOrders({ daysBack })` -- fetches orders via SellerAPI, upserts each line item as YourSale record
- `syncListings()` -- fetches active listings via SellerAPI, upserts as YourListing records
- `getStats()` -- sync statistics (counts, recent activity)

**syncListings() Behavior:**
- Upserts listings with structured field extraction (Clean Pipe: partNumberBase, partType, make, model)
- Marks qty 0 listings as `Ended` at insert time (`quantityAvailable <= 0` -> `listingStatus: 'Ended'`)
- After sync, marks any dynatrack listings NOT in the sync batch as `Ended` (stale deactivation)
- Triggers `OverstockCheckService.checkAll()` after every listing sync
- Triggers `CacheService.resolveFromListings()` for auto-resolve of claimed cache entries

**Dependencies:** `SellerAPI`, `YourSale`, `YourListing`, `partIntelligence`, `OverstockCheckService`, `CacheService`

---

## SoldItemsManager.js

**Purpose:** Fetches competitor sold items via Playwright scraping (FindingsAPI decommissioned Feb 2025).

**Key Methods:**
- `scrapeAllCompetitors({ categoryId, maxPagesPerSeller, enrichCompatibility })` -- scrapes all enabled sellers from `SoldItemSeller` table
- Stores results as `SoldItem` records with structured field extraction

**Dependencies:** `SoldItemsScraper`, `TradingAPI`, `SoldItemSeller`, `SoldItem`, `partIntelligence`

---

## MarketResearchManager.js

**Purpose:** Orchestrates market research for inventory items -- searches eBay for active comps and sold items, stores data, calculates price stats.

**Key Methods:**
- `researchAllInventory({ limit, maxActivePages, maxSoldPages, categoryId })` -- runs research for items not researched in last 24h

**Flow:** Get YourListing items -> extract keywords -> search eBay active + sold -> store as CompetitorListing/SoldItem -> calculate PriceSnapshot

**Dependencies:** `MarketResearchScraper`, `MarketResearchRun`, `CompetitorListing`, `SoldItem`, `YourListing`, `PriceSnapshot`

---

## ItemDetailsManager.js

**Purpose:** Fetches full item details from eBay TradingAPI (GetItem) including compatibility and specifics.

**Key Methods:**
- `getDetailsForItem({ itemId })` -- returns raw eBay item object
- `getInterchangeNumbers(string)` -- parses interchange/OEM number strings (comma or space delimited)

**Dependencies:** `TradingAPI`, `Auto`, `Item`

---

## SellerItemManager.js

**Purpose:** Ingests competitor active listings via eBay BrowseAPI. Paginated fetch + store.

**Key Methods:**
- `getItemsForSellers(sellers)` -- iterates all sellers
- `getItemsForSeller({ seller })` -- paginated BrowseAPI fetch per category
- `processResponse(response, seller)` -- stores items in DB

**Dependencies:** `FindingsAPI`, `BrowseAPI`, `Item`

---

## CompetitorManager.js

**Purpose:** Simple CRUD for competitor sellers.

**Key Methods:**
- `getAllCompetitors()` -- returns all enabled competitors

**Dependencies:** `Competitor`

---

## UserManager.js

**Purpose:** Firebase user authentication, verification, and caching.

**Key Methods:**
- `getOrCreateUser({ user }, { trx })` -- find or create user by email; returns user if verified, null if not

**Dependencies:** `User`, `CacheManager`
