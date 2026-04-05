# SNAPSHOT_LIBS.md
Generated 2026-04-05

## service/utils/

### partIntelligence.js
**Purpose:** Unified matching engine for DarkHawk. Single source for PN extraction, stock counting, model matching, year parsing. Used by DAILY FEED, HAWK EYE, THE QUARRY, SCOUR STREAM, SCOUT ALERTS. Replaces partNumberExtractor.js and partMatcher.extractPartNumbers().
**Exports:** `extractPartNumbers`, `stripRevisionSuffix`, `computeBase`, `parseYearRange`, `vehicleYearMatchesPart`, `modelMatches`, `buildStockIndex`, `lookupStockFromIndex`, `extractStructuredFields`, `detectPartType`, `sanitizePartNumberForSearch`, `deduplicatePNQueue`
**Dependencies:** `./partMatcher` (for `normalizePartNumber` used by `computeBase`).
**Key behavior:**
- `extractPartNumbers(text)` — Ford 3-segment dash patterns + Chrysler, GM, Toyota, Honda, Nissan, VW, BMW, Mercedes, Hyundai, generic. Returns `{raw, normalized, base}` where `base` is computed via `computeBase()`. Filters via SKIP_WORDS + MAKES_MODELS sets.
- `computeBase(raw)` — Uses `normalizePartNumber()` from partMatcher.js for dashed PNs (Ford: 7L3A-12A650-GJH → 7L3A-12A650 → 7L3A12A650), falls back to `stripRevisionSuffix()` for dashless PNs. This is the canonical base PN used for `partNumberBase` column.
- `extractStructuredFields(title)` — Clean Pipe Phase A. Returns `{partNumberBase, partType, extractedMake, extractedModel}`. Uses `pns[0].base` from `extractPartNumbers` for partNumberBase.
- `sanitizePartNumberForSearch(pn)` — Clean Pipe Phase E1. Normalizes, rejects junk (JUNK_WORDS set, VINs, years, pure-alpha), strips Ford ECU suffixes (12A650, 14A067). Returns null for unsearchable PNs. **Intentionally aggressive — for search queries, NOT for storage.**
- `deduplicatePNQueue(entries)` — Phase E1. Sanitizes, dedupes by base, keeps highest-price entry per PN.
- `detectPartType(title)` — Keyword detection for 30+ part types (ECM, BCM, TCM, ABS, TIPM, AMP, CLUSTER, RADIO, etc.).
- `MAKE_NORMALIZE` — Map of lowercase make strings to title-case canonical names (matches corgi VIN decoder output). ~50 entries.
- `MODEL_PATTERNS` — Ordered array of ~200 model strings. Multi-word models listed first for greedy matching.
- `stripRevisionSuffix(pn)` — Strips trailing revision suffix. Chrysler 56044691AA → 56044691, GM A12345678AA → A12345678, Ford dashless patterns.

### partMatcher.js
**Purpose:** Shared part number recognition and matching. Still used for `normalizePartNumber()` by CacheService, priceResolver, and other services.
**Exports:** `extractPartNumbers`, `normalizePartNumber`, `loadModelsFromDB`, `getModels`, `MAKES`, `MAKE_ALIASES`, `MODEL_IMPLIES_MAKE`, `MODELS`, `PART_PHRASES`, plus parsing helpers.
**Dependencies:** `../database/database`, `../lib/logger`
**Key behavior:**
- `extractPartNumbers(title)` — OEM-specific regex patterns (chrysler, ford, honda, toyota, nissan, gm, bosch, bmw). Returns `{raw, base, format}`. Deduplicates by base, keeps longer raw match.
- `normalizePartNumber(pn)` — Strips OEM revision suffixes. Ford dash-style with 1-3 char suffix (AL3T-15604-BD → AL3T-15604, 7L3A-12A650-GJH → 7L3A-12A650), Chrysler/GM trailing alpha (68269652AA → 68269652), Honda sub-revision, Toyota revision, generic 2-alpha tail. **This is the canonical normalizer used by CacheService for dedup, by computeBase() in partIntelligence.js, and by the frontend normalizePN() for matching.**
- `loadModelsFromDB()` — Loads Auto table models into cache organized by make. Sorted longest-first. Falls back to FALLBACK_MODELS (~120 entries).
- `MODEL_IMPLIES_MAKE` — Reverse lookup: model name -> make (e.g. "charger" -> "dodge"). ~100 entries.

### partNumberExtractor.js
**Purpose:** DEPRECATED. Original OEM part number extractor. Kept for backward compatibility; use partIntelligence.js.
**Exports:** `extractPartNumbers`, `stripRevisionSuffix`
**Dependencies:** None (pure logic).
**Key behavior:** 13 regex patterns for multi-OEM extraction. `isCommonWord` filter rejects years and common abbreviations.

---

## service/lib/

### LocalVinDecoder.js
**Purpose:** Offline VIN decoding via @cardog/corgi + Postgres VDS enrichment. Replaces all NHTSA API calls. Singleton pattern.
**Exports:** `decode`, `decodeBatchLocal`, `getDecoder`, `close`
**Dependencies:** `./logger`, `../database/database`, `@cardog/corgi`
**Key behavior:**
- `decode(vin)` — 6-step pipeline: (1) check vin_cache table, (2) corgi offline decode (<15ms), (3) VDS trim enrichment via vin_decoder.vds_trim_lookup, (4) engine code enrichment via vin_decoder.engine_codes, (5) write to vin_cache, (6) return standardized result with year/make/model/trim/engine/drivetrain/bodyStyle/engineType/source.
- `decodeBatchLocal(vins)` — Sequential decode loop. Returns array shaped like NHTSA batch response for backward compat (VIN, Make, Model, ModelYear, Trim, DisplacementL, etc.).
- `cleanDecodedTrim(raw)` — Filters junk trims (NFA, std, cab types, drivetrain strings, chassis codes). Strips parenthetical content, engine specs, leather/nav suffixes. Returns null if <2 or >30 chars.
- Singleton: `getDecoder()` caches one corgi instance for app lifetime.
- Honda exception: position 8 = trim not engine, so engine code lookup skipped for Honda.

### priceResolver.js
**Purpose:** Resolve best available price for a part number from tiered sources.
**Exports:** `resolvePrice`, `resolvePricesBatch`, `getFreshness`
**Dependencies:** `../database/database`
**Key behavior:**
- `resolvePricesBatch(partNumbers, options)` — Normalizes keys (strip spaces/dashes/dots, uppercase). Priority: market_demand_cache (fresh/aging/stale) > Item.price (frozen reference). Freshness tiers: fresh <=30d, aging 30-60d, stale 60-90d, expired >90d (treated as missing).
- Returns Map of `{price, source, freshness, details}`. Details include median, min, max, soldCount for cache hits.
- PriceCheck data is NOT queried directly in batch mode; it feeds into market_demand_cache via Phase 1c.

### FlywayScrapeRunner.js
**Purpose:** Cron runner for non-LKQ Flyway yard scraping + post-scrape enrichment.
**Exports:** `FlywayScrapeRunner` (class)
**Dependencies:** `./logger`, `../database/database`, `../services/FlywayService`, `../services/PostScrapeService.enrichYard`, scrapers (PullAPart, Foss, CarolinaPNP, UPullAndSave, Chesterfield, PickAPartVA)
**Key behavior:**
- `work()` — (1) auto-complete expired Flyway trips, (2) cleanup expired trip vehicles, (3) get active non-LKQ yards, deduplicate, (4) scrape each with 5min timeout and 3s inter-yard delay, (5) delegates post-scrape to `PostScrapeService.enrichYard(yardId)` for VIN decode + trim tier + scout alerts.
- `scrapeYard(yard)` — Routes to chain-specific scraper by method/chain field. Skips Foss on Sundays (PriceCheck Playwright conflict). Skips Carolina PNP on Railway (datacenter IPs blocked).

### MarketDemandCronRunner.js
**Purpose:** DISABLED in production. Nightly job to update market_demand_cache for all Item partNumberBase values via eBay Finding API.
**Exports:** `MarketDemandCronRunner` (class)
**Dependencies:** `./logger`, `../database/database`, `./partNumberUtils`, `axios`, `xml2js`
**Key behavior:**
- `work()` — Queries distinct partNumberBase from Item table. Skips if cache <24h old. Calls `queryEbaySold(pn)` then `upsertCache()`. 100ms rate limit between calls.
- `upsertCache()` — Key normalization: `rawPartNumberBase.replace(/[\s\-\.]/g, '').toUpperCase()`. Computes seasonal_weight (30d estimate vs 90d) and market_score (sold/active ratio).
- `queryEbaySold(pn)` — Uses eBay Finding API XML (findCompletedItems + findItemsByKeywords). Returns `{soldCount, avgPrice, activeListings}`.

### CompetitorDripRunner.js
**Purpose:** Randomized micro-scrape runner for competitor eBay sellers. Replaces old Sunday "blast all sellers" approach.
**Exports:** Singleton instance of `CompetitorDripRunner`
**Dependencies:** `./logger`, `../database/database`, `../managers/SoldItemsManager`
**Key behavior:**
- `runDrip()` — Called 4x daily (6am, noon, 6pm, midnight UTC). Random 0-45min startup delay. Picks least-recently-scraped enabled seller from SoldItemSeller. Skips if all sellers scraped <6h ago. Scrapes 1-2 random pages via SoldItemsManager.scrapeCompetitor(). Updates lastScrapedAt and itemsScraped. Closes Playwright browser after each run.

### PriceCheckCronRunner.js
**Purpose:** Weekly batch price checker for active YourListing items.
**Exports:** `PriceCheckCronRunner` (class)
**Dependencies:** `./logger`, `../services/PriceCheckService`, `../models/PriceCheck`, `../models/YourListing`, `async-lock`, `uuid`
**Key behavior:**
- `work({batchSize=35})` — Uses async-lock to prevent concurrent runs. Delegates to `doWork()`.
- `getListingsNeedingPriceCheck(limit)` — SQL: active listings with quantityAvailable > 0, not omitted, no PriceCheck in 7 days. Prioritized by never-checked first, then stalest, then highest price.
- 3-6s random delay between checks; 5s after errors. Calls `PriceCheckService.checkPrice()` per listing.
- Scheduled Sunday 2am (weekly cycle so each listing checked once/week).

### CronWorkRunner.js
**Purpose:** Primary eBay seller item processing cron. Imports new items from competitors, then processes unprocessed items.
**Exports:** `CronWorkRunner` (class)
**Dependencies:** `./logger`, `../managers/SellerItemManager`, `../models/Item`, `../managers/ItemDetailsManager`, `async-lock`, `uuid`, `../models/Cron`, `../middleware/CacheManager`, `../managers/CompetitorManager`
**Key behavior:**
- `work()` — Async-locked. If unprocessed Items exist, skips import and processes them. Otherwise imports from all competitors via SellerItemManager, then processes via ItemDetailsManager. Logs metrics to Cron table. Flushes item caches post-run.

### async-handler.js
**Purpose:** Express route error wrapper. Catches thrown errors and rejected promises, forwards to next(err).
**Exports:** `asyncHandler`
**Dependencies:** `@hapi/joi`

### constants.js
**Purpose:** Shared constants. Provides `dataDir` (path to service/data/) and `makes` (40 supported automotive makes).
**Exports:** `dataDir`, `makes`

### logger.js
**Purpose:** Bunyan logger singleton. Writes to service/lib/logs/dynatrack.log at debug level.
**Exports:** `log`
**Dependencies:** `bunyan`, `fs-extra`

### partNumberUtils.js
**Purpose:** Backward-compatibility re-export. Proxies `normalizePartNumber` and `extractPartNumbers` from `../utils/partMatcher`.
**Exports:** `normalizePartNumber`, `extractPartNumbers`

### platformMatch.js
**Purpose:** Platform cross-reference engine. Resolves shared-platform vehicles (e.g., Chrysler 300 matches Dodge Charger ECM sales).
**Exports:** `getPlatformMatches`, `getExpandedSalesQuery`, `applyPlatformBonus`, `normalizeMake`, `normalizeModel`, `MAKE_ALIASES`, `MODEL_ALIASES`
**Dependencies:** `../database/database` (via platform_vehicle, platform_group, platform_shared_part tables)
**Key behavior:**
- `getPlatformMatches(db, make, model, year)` — SQL join across platform_vehicle/platform_group/platform_shared_part. Returns sibling vehicles with shared part_types.
- `getExpandedSalesQuery(db, make, model, year)` — Builds ILIKE conditions for YourSale title matching across original vehicle + all platform siblings with make/model aliases.
- `applyPlatformBonus(baseScore, platformMatches, salesData)` — Up to 20% score boost based on sibling sales volume.
- `MAKE_ALIASES` — Uppercase make -> array of display variants (e.g., 'RAM' -> ['Ram', 'Dodge']).
- `MODEL_ALIASES` — Model -> array of name variants (e.g., 'Town & Country' -> ['Town & Country', 'Town and Country', 'T&C']).
