# SNAPSHOT_LIBS.md
Generated 2026-04-04

## service/lib/

### LocalVinDecoder.js
- **Purpose:** Offline VIN decoding via @cardog/corgi + Postgres VDS enrichment. Replaces all NHTSA API calls.
- **Exports:** `decode`, `decodeBatchLocal`, `getDecoder`, `close`
- **Dependencies:** `./logger`, `../database/database`, `@cardog/corgi` (lazy-loaded)
- **Singleton pattern:** `getDecoder()` caches a single corgi decoder instance in module-level `decoderInstance`; `initPromise` prevents double init.
- **decode() pipeline:** (1) Check `vin_cache` table, (2) corgi offline decode (<15ms), (3) VDS trim enrichment via `vin_decoder.vds_trim_lookup` in Postgres, (4) engine code enrichment via `vin_decoder.engine_codes`, (5) write result to `vin_cache`, (6) return standardized result. Source string tracks provenance (e.g. `corgi+vds_trim+engine_code`).
- **decodeBatchLocal():** Sequential loop over VINs, returns array shaped like NHTSA batch response (`VIN`, `Make`, `Model`, `ModelYear`, etc.) for backward compat with PostScrapeService consumers.
- **cleanDecodedTrim():** Self-contained copy from PostScrapeService. Filters junk trims (NFA, cab types, drivetrain strings like `quattro`), strips parenthetical content, chassis codes, engine displacements. Returns null if result < 2 or > 30 chars.
- **Gotchas:** Honda pos8 = trim not engine (skipped in `resolveEngineCode`). All DB queries wrapped in try/catch for tables that may not exist yet. VIN sanitized to `[A-HJ-NPR-Z0-9]` (no I/O/Q per VIN spec).

### priceResolver.js
- **Purpose:** Resolve best available price for a part number. Priority: market_demand_cache > PriceCheck (skipped in batch) > Item.price (frozen reference).
- **Exports:** `resolvePrice`, `resolvePricesBatch`, `getFreshness`
- **Dependencies:** `../database/database`
- **Key behavior:** `resolvePricesBatch()` normalizes lookup keys with `.replace(/[\s\-\.]/g, '').toUpperCase()` before querying. Freshness tiers: fresh <=30d, aging 30-60d, stale 60-90d, expired >90d (treated as missing). PriceCheck data feeds into cache via Phase 1c, so cache is the primary batch source.

### FlywayScrapeRunner.js
- **Purpose:** Cron runner for non-LKQ Flyway yard scraping. Auto-completes expired trips, scrapes yards, then enriches.
- **Exports:** `FlywayScrapeRunner` class
- **Dependencies:** `./logger`, `../database/database`, `../services/FlywayService`, `../services/PostScrapeService` (enrichYard). Scrapers lazy-loaded per chain: PullAPart, Foss, CarolinaPNP, UPullAndSave, Chesterfield, PickAPartVA.
- **Delegates enrichment to PostScrapeService.enrichYard()** -- no direct VIN decode in this file. 5-minute timeout per yard. Foss skipped on Sundays (Playwright conflict with PriceCheck). CarolinaPNP local-only (datacenter IPs blocked).

### MarketDemandCronRunner.js
- **Purpose:** DISABLED nightly job to update `market_demand_cache` via eBay Finding API `findCompletedItems`.
- **Exports:** `MarketDemandCronRunner` class
- **Dependencies:** `./logger`, `../database/database`, `./partNumberUtils`, `axios`, `xml2js`
- **upsertCache normalizes keys:** `rawPartNumberBase.replace(/[\s\-\.]/g, '').toUpperCase()` before insert/update. Calculates `seasonal_weight` (30d rate vs 90d rate) and `market_score` (sold/active ratio). CACHE_TTL_HOURS = 24. Rate limited at 100ms between eBay calls.

### CronWorkRunner.js
- **Purpose:** Primary eBay seller item processing cron. Pulls new items from sellers, processes unprocessed items, logs metrics to Cron table.
- **Exports:** `CronWorkRunner` class
- **Dependencies:** `./logger`, `../managers/SellerItemManager`, `../models/Item`, `../managers/ItemDetailsManager`, `async-lock`, `uuid`, `../models/Cron`, `../middleware/CacheManager`, `../managers/CompetitorManager`
- **Pattern:** Uses `async-lock` with `maxPending: 0` to prevent concurrent runs. Skips new item import if unprocessed items exist. Flushes item caches post-work.

### CompetitorDripRunner.js
- **Purpose:** Randomized micro-scrape of competitor eBay sellers. Called 4x daily; picks least-recently-scraped seller, scrapes 1-2 random pages.
- **Exports:** Singleton instance (`new CompetitorDripRunner()`)
- **Dependencies:** `./logger`, `../database/database`, `../managers/SoldItemsManager`
- **Pattern:** Random 0-45min startup delay per run to vary execution time. Skips sellers scraped within 6 hours. Exported as singleton (not class).

### PriceCheckCronRunner.js
- **Purpose:** Weekly price check cron for active YourListings. Uses PriceCheckService with Playwright.
- **Exports:** `PriceCheckCronRunner` class
- **Dependencies:** `./logger`, `../services/PriceCheckService`, `../models/PriceCheck`, `../models/YourListing`, `async-lock`, `uuid`
- **Pattern:** 7-day cache window. Prioritizes never-checked listings, then oldest. Random 3-6s delay between checks, 5s after errors. Default batchSize=15.

### logger.js
- **Purpose:** App-wide Bunyan logger writing to `service/lib/logs/dynatrack.log`.
- **Exports:** `{ log }`
- **Dependencies:** `bunyan`, `path`, `fs-extra`
- **Note:** `fs.ensureDirSync` creates logs dir on require. Logger name is `dynatrack`, level `debug`.

### partNumberUtils.js
- **Purpose:** Backward-compat shim. Re-exports `normalizePartNumber` and `extractPartNumbers` from `../utils/partMatcher`.
- **Exports:** `{ normalizePartNumber, extractPartNumbers }`
- **Note:** All new code should import from `../utils/partMatcher` directly.

### platformMatch.js
- **Purpose:** Platform cross-reference engine. Resolves shared-platform vehicles (e.g. Chrysler 300 matches Dodge Charger ECM sales).
- **Exports:** `getPlatformMatches`, `getExpandedSalesQuery`, `applyPlatformBonus`, `normalizeMake`, `normalizeModel`, `MAKE_ALIASES`, `MODEL_ALIASES`
- **Dependencies:** None (queries `platform_vehicle`/`platform_group`/`platform_shared_part` tables via passed db handle)
- **Pattern:** Supports both Knex (`db.raw`) and pg pool (`db.query`). `applyPlatformBonus` adds up to 20% score boost based on sibling sales volume. Tables may not exist yet (silent catch).

### constants.js
- **Purpose:** App constants -- `dataDir` path and canonical `makes` list (40 makes).
- **Exports:** `{ dataDir, makes }` (getter-based)
- **Dependencies:** `path`

### async-handler.js
- **Purpose:** Express/Restify route error wrapper. Catches thrown errors and rejected promises, forwards to `next(err)`.
- **Exports:** `{ asyncHandler }`
- **Dependencies:** `@hapi/joi` (validates fn param is a function)

---

## service/utils/

### partIntelligence.js
- **Purpose:** Unified matching engine for DarkHawk. ONE module for PN extraction, stock counting, model matching, year parsing, structured field extraction, and PN sanitization. Used by Daily Feed, Hawk Eye, The Quarry, Scour Stream, Scout Alerts.
- **Exports:** `extractPartNumbers`, `stripRevisionSuffix`, `parseYearRange`, `vehicleYearMatchesPart`, `modelMatches`, `buildStockIndex`, `lookupStockFromIndex`, `extractStructuredFields`, `detectPartType`, `sanitizePartNumberForSearch`, `deduplicatePNQueue`
- **Dependencies:** None (pure logic, no DB or logger imports)
- **extractPartNumbers(text):** Runs 13 regex patterns (Ford dash, Ford no-dash, Chrysler, Toyota, Honda, Nissan, VW, BMW, Mercedes, Hyundai, GM 8-digit, generic alphanumeric). Returns `[{raw, normalized, base}]`. Filters via `isSkipWord()` which rejects years, short alpha-only tokens, and a large MAKES_MODELS set (~160 entries).
- **extractStructuredFields(title):** Clean Pipe Phase A. Extracts `{partNumberBase, partType, extractedMake, extractedModel}` at write time for YourListing/YourSale/SoldItem inserts. Make via `extractMake()` using MAKE_NORMALIZE map; model via `extractModel()` checking MODEL_PATTERNS array in priority order.
- **detectPartType(title):** Keyword-based classification into ~30 part types (ECM, TCM, BCM, ABS, TIPM, AMP, CLUSTER, RADIO, THROTTLE, STEERING, HEADLIGHT, TAILLIGHT, BLIND_SPOT, CAMERA, HVAC, etc.). Returns null if no match.
- **MAKE_NORMALIZE map:** Lowercase make string -> title-case canonical name matching corgi VIN decoder output (e.g. `'chevy'` -> `'Chevrolet'`, `'vw'` -> `'Volkswagen'`). ~40 entries including obscure makes (Datsun, Renault, Hummer, Plymouth).
- **MODEL_PATTERNS array:** ~200 model strings ordered multi-word first (Grand Cherokee before Cherokee, Silverado 3500 before Silverado). Used by `extractModel()` for word-boundary regex matching against title.
- **sanitizePartNumberForSearch(pn):** Clean Pipe Phase E1. Normalizes (strip dashes/spaces/dots, uppercase), rejects junk (<5 chars, >20 chars, JUNK_WORDS set, pure-alpha, VIN-length, years). Special Ford ECU suffix stripping for `12A650`/`14A067` patterns. Returns null if junk.
- **deduplicatePNQueue(entries):** Clean Pipe Phase E1. Takes `[{base, raw, price, sampleTitle}]`, sanitizes each PN via `sanitizePartNumberForSearch`, groups by sanitized base, keeps highest-price entry per group. Returns filtered, deduped array.
- **buildStockIndex / lookupStockFromIndex:** Builds PN index from listing titles (`byPN` exact map + `byBase` base map), then looks up stock count by exact normalized match, base match, or cross-revision base match. Returns `{count, method: 'PART_NUMBER'|'NO_MATCH'}`.
- **parseYearRange(title):** Parses year ranges from titles (`2006-2010`, `06-10`, single 4-digit year, 2-digit prefix). Returns `{start, end}` or null.
- **modelMatches(partModel, vehicleModel):** Normalized comparison with prefix matching (e.g. "Silverado" matches "Silverado 1500" if extra words are purely numeric).

### partMatcher.js
- **Purpose:** DEPRECATED -- original shared part number recognition and matching utility. Kept for backward compat; new code should use partIntelligence.js.
- **Exports:** `extractPartNumbers`, `normalizePartNumber` (plus parsing functions)
- **Dependencies:** `../database/database`, `../lib/logger`
- **Note:** Contains PN_PATTERNS array (8 OEM-specific regex patterns), MODEL_IMPLIES_MAKE reverse lookup (~120 model->make entries), FALLBACK_MODELS list (~100 models), DB-loaded model cache. `normalizePartNumber()` is still actively used via the partNumberUtils.js shim.

### partNumberExtractor.js
- **Purpose:** DEPRECATED -- original OEM part number extraction. Kept for backward compat; new code should use partIntelligence.js.
- **Exports:** `{ extractPartNumbers, stripRevisionSuffix }`
- **Dependencies:** None
- **Note:** 13 regex patterns covering Ford, Chrysler, GM, Toyota, Honda, Nissan, VW, BMW, Mercedes, Hyundai, generic. `isCommonWord()` filter rejects years and ~15 common words.
