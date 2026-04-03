# SNAPSHOT_LIBS.md — DarkHawk Library Layer

> Generated: 2026-04-01 | Source: `service/lib/`

## File Index

| File | Purpose |
|------|---------|
| `LocalVinDecoder.js` | Singleton offline VIN decoder via @cardog/corgi + Postgres VDS enrichment |
| `priceResolver.js` | Batch price resolution: market_demand_cache -> PriceCheck -> Item.price fallback |
| `logger.js` | Bunyan logger (writes to `service/lib/logs/dynatrack.log`) |
| `partNumberUtils.js` | Re-export shim for `../utils/partMatcher` (normalizePartNumber, extractPartNumbers) |
| `platformMatch.js` | Platform cross-reference engine (shared-platform vehicle matching for scoring) |
| `FlywayScrapeRunner.js` | Flyway scrape orchestrator: scrapes non-LKQ yards, then enriches via PostScrapeService |
| `CronWorkRunner.js` | eBay seller item sync cron (async-lock guarded, runs every 6h) |
| `PriceCheckCronRunner.js` | Weekly eBay price check cron (Sunday 2am, async-lock guarded) |
| `MarketDemandCronRunner.js` | Nightly market_demand_cache updater (3am, uses eBay Finding API) |
| `CompetitorDripRunner.js` | Randomized micro-scrape of competitor sellers (4x/day, 1-2 pages each) |
| `async-handler.js` | Express route error wrapper (try/catch -> next(err)) |
| `constants.js` | Shared constants: `dataDir`, `makes[]` (40 automotive makes) |
| `schemas/` | Joi schemas: `autoSchema.js`, `itemSchema.js`, `taxonomySchema.js` |

---

## LocalVinDecoder.js

**Purpose:** Offline VIN decoding — replaces all NHTSA API calls. Singleton pattern.

**Decode Pipeline:**
1. Check `vin_cache` table (instant hit)
2. `@cardog/corgi` offline decode (sub-15ms, zero network)
3. VDS trim enrichment (`vin_decoder.vds_trim_lookup` in Postgres)
4. Engine code enrichment (`vin_decoder.engine_codes` in Postgres)
5. Write result to `vin_cache`

**Exports:** `decode(vin)`, `decodeBatchLocal(vins)`, `getDecoder()`, `close()`

**Dependencies:** `@cardog/corgi`, `logger`, `database`

**Gotchas:**
- Honda pos8 is trim not engine -- `resolveEngineCode()` skips Honda
- `decodeBatchLocal()` returns NHTSA-shaped objects (`VIN`, `Make`, `Model`, `ModelYear`) for backward compat
- `cleanDecodedTrim()` filters junk (cab types, chassis codes, drivetrain strings, grade levels)
- All catch blocks silently swallow errors for missing `vin_decoder` schema tables

---

## priceResolver.js

**Purpose:** Resolve best available price for part numbers with freshness tracking.

**Exports:** `resolvePrice(pn, opts)`, `resolvePricesBatch(pns, opts)`, `getFreshness(date)`

**Priority chain:** `market_demand_cache` (fresh <30d) -> Item.price (frozen fallback) -> null

**Freshness tiers:** fresh (0-30d), aging (30-60d), stale (60-90d), expired (>90d = skip)

**Dependencies:** `database`

**Gotchas:** PriceCheck step is skipped in batch mode -- cache already covers it via Phase 1c pipeline

---

## platformMatch.js

**Purpose:** Resolves platform siblings (e.g., Chrysler 300 matches Dodge Charger ECM sales).

**Exports:** `getPlatformMatches(db, make, model, year)`, `getExpandedSalesQuery(db, make, model, year)`, `applyPlatformBonus(score, matches, salesData)`, `normalizeMake(make)`, `normalizeModel(model)`, `MAKE_ALIASES`, `MODEL_ALIASES`

**Dependencies:** `database` (Knex or pg pool), tables: `platform_group`, `platform_vehicle`, `platform_shared_part`

**Gotchas:**
- Handles Ram/Dodge brand split (Ram became separate brand in 2010)
- `MAKE_ALIASES` maps scraper case (uppercase) to title case for sales matching
- Platform bonus capped at 20% score boost
- Returns empty array silently if platform tables don't exist

---

## FlywayScrapeRunner.js

**Purpose:** Orchestrates scraping for non-LKQ yards on active Flyway trips.

**Exports:** `FlywayScrapeRunner` class (instantiate, call `work()`)

**Pipeline:** auto-complete expired trips -> cleanup old vehicles -> scrape yards -> enrich with PostScrapeService

**Dependencies:** `FlywayService`, `PostScrapeService.enrichYard()`, 6 scraper modules

**Gotchas:**
- Skips LKQ yards (handled separately)
- 5-minute timeout per yard scrape
- 3-second delay between yards
- Carolina PNP skipped on Railway (datacenter IPs blocked)
- Foss skipped on Sundays (PriceCheck uses Playwright at 2am)
- Deduplicates yards when multiple trips share the same yard

---

## CronWorkRunner.js

**Purpose:** eBay seller item processing cron (sync items, update details, flush caches).

**Exports:** `CronWorkRunner` class with `work()` method

**Dependencies:** `SellerItemManager`, `ItemDetailsManager`, `AsyncLock`, `CacheManager`, `CompetitorManager`

**Gotchas:** Uses `async-lock` with `maxPending: 0` -- skips entirely if already running

---

## CompetitorDripRunner.js

**Purpose:** Randomized micro-scrape of competitor eBay sellers (replaces old Sunday "blast all" cron).

**Exports:** Singleton instance with `runDrip()` method

**Pattern:** Random 0-45min delay -> pick least-recently-scraped seller -> scrape 1-2 pages -> update stats

**Dependencies:** `SoldItemsManager`, `database`

**Gotchas:** Skips if all sellers scraped within 6h; exported as singleton (not class)

---

## MarketDemandCronRunner.js

**Purpose:** Nightly job (3am) to refresh `market_demand_cache` using eBay Finding API.

**Dependencies:** `database`, `partNumberUtils`, `axios`, `xml2js`

**Gotchas:** Skips part numbers with cache fresher than 24h (`CACHE_TTL_HOURS`)

---

## PriceCheckCronRunner.js

**Purpose:** Weekly Playwright-based eBay price check (Sundays 2am). Batches listings needing checks.

**Dependencies:** `PriceCheckService`, `PriceCheck` model, `YourListing` model, `AsyncLock`

**Gotchas:** `async-lock` guarded; default `batchSize: 15`

---

## logger.js

**Purpose:** Bunyan logger named `dynatrack`, level `debug`, writes to `service/lib/logs/dynatrack.log`.

**Exports:** `{ log }` -- single logger instance used throughout the app

**Dependencies:** `bunyan`, `fs-extra`

---

## partNumberUtils.js

**Purpose:** Backward-compatibility shim -- re-exports `normalizePartNumber` and `extractPartNumbers` from `../utils/partMatcher`.

**Note:** New code should import from `service/utils/partMatcher` directly.

---

## async-handler.js

**Purpose:** Express async route wrapper. Catches thrown errors and rejected promises, forwards to `next(err)`.

**Exports:** `asyncHandler(fn)` -- wraps an async route handler

**Dependencies:** `@hapi/joi` (validates fn is a function)

---

## constants.js

**Purpose:** Shared constants: `dataDir` (path to `service/data/`), `makes` (array of 40 automotive makes).

**Exports:** `constants` object with getters for `dataDir` and `makes`
