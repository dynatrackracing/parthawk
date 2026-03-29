# DARKHAWK POST-BUILD AUDIT

**Date:** 2026-03-28
**Scope:** Every change made across Phases 1c, 1d, 2a-2c, 2.5, 3a, 3b, 4a-4c, 5
**Purpose:** Verify all implementations are correct, data flows are safe, no regressions introduced

---

## AUDIT METHOD

For each change: identify what was modified, what the risk is, and provide an exact verification command. Claude Code should run every verification in order and report results.

---

## 1. CRON SCHEDULE AUDIT

The cron schedule is the most dangerous surface area — bad crons can corrupt data, burn API credits, or OOM the server.

### VERIFY: Current cron registrations

```bash
# Find every cron.schedule() or node-cron registration in the codebase
grep -rn "cron.schedule\|schedule(" service/routes/ service/index.js --include="*.js" | grep -v node_modules | grep -v "// "
```

**Expected state after all phases:**

| Cron | Schedule | File | Status |
|------|----------|------|--------|
| YourDataManager.syncAll | `0 1,7,13,19 * * *` | index.js or sync.js | ACTIVE — uses SellerAPI, safe |
| LKQScraper.scrapeAll | `0 2 * * *` | index.js | ACTIVE but should only run locally (verify it doesn't actually execute on Railway due to CloudFlare) |
| PriceCheckCronRunner | `0 2 * * 0` | price-check.js | ACTIVE — Playwright scraping, safe |
| MarketDemandCronRunner | `0 3 * * *` | index.js or cron.js | MUST BE DISABLED — uses Finding API |
| StaleInventoryService | `0 3 * * 3` | stale-inventory.js | ACTIVE — uses Trading API, safe |
| DeadInventoryService | `0 4 * * 1` | stale-inventory.js | ACTIVE — reads local tables only |
| RestockService | `0 4 * * 2` | stale-inventory.js | ACTIVE — reads local tables only |
| CompetitorMonitorService | `0 4 * * 4` | stale-inventory.js | ACTIVE but reads frozen SoldItem data — degraded, not harmful |
| CronWorkRunner | `0 */6 * * *` | index.js or cron.js | MUST BE DISABLED — uses Finding API via SellerItemManager |
| Competitor auto-scrape | `0 11 * * *` | competitors.js | MUST BE DISABLED (replaced by weekly) |
| Competitor weekly scrape | `0 20 * * 0` | competitors.js | ACTIVE — Phase 2.5, uses Playwright |
| ScoutAlertService | Startup +10s | index.js | ACTIVE — reads local tables only |

### VERIFY: No Finding API calls in active code paths

```bash
# Find all imports of FindingsAPI
grep -rn "FindingsAPI\|findingsAPI\|findings-api" service/ --include="*.js" | grep -v node_modules | grep -v "\.js:" | grep -v "// "

# The ONLY acceptable results:
# - FindingsAPI.js itself (the dead module)
# - SellerItemManager.js (dead CronWorkRunner path, cron disabled)
# - Comment lines explaining removal
```

**RISK:** If any ACTIVE code path still imports and calls FindingsAPI, it will silently fail (return 0 results) and corrupt downstream data with empty datasets.

---

## 2. PRICECHECK → CACHE PIPELINE (Phase 1c)

### What changed:
PriceCheckService.checkPrice() now UPSERTs market_demand_cache after saving a PriceCheck record.

### VERIFY: Cache write exists and has staleness guard

```bash
# In the deployed PriceCheckService, find the cache write
grep -n "market_demand_cache\|upsert\|staleness\|3.*day" service/services/PriceCheckService.js service/ebay/PriceCheckService.js
```

**Expected:** After `PriceCheck.saveCheck()`, there should be:
1. Extract PN from title using extractPartNumbers or similar
2. Check if cache entry exists and is < 3 days old (skip if fresher)
3. UPSERT market_demand_cache with scraped price data
4. INSERT PriceSnapshot row with source 'price_check'
5. Both wrapped in try/catch so primary PriceCheck save is never affected

### RISK: Column name mismatch
The market_demand_cache table was previously hit by a column name bug (market_avg_price vs ebay_avg_price). Verify the UPSERT uses correct column names.

```bash
# Check what columns exist on market_demand_cache
cat service/database/migrations/*market* | grep -i "column\|table"
# OR run against the database:
# SELECT column_name FROM information_schema.columns WHERE table_name = 'market_demand_cache';
```

**Expected columns:** part_number_base, ebay_avg_price, ebay_sold_90d, ebay_median_price, ebay_min_price, ebay_max_price, market_score, sales_per_week, updated_at

### RISK: PriceSnapshot table schema
Phase 1c/1d added columns to PriceSnapshot via migration. Verify migration ran.

```bash
# Check PriceSnapshot has the new columns
grep -n "part_number_base\|source\|snapshot_date" service/database/migrations/*price_snapshot* service/database/migrations/*repurpose*
```

---

## 3. SOLDITEMSMANAGER REWIRE (Phase 2.5)

### What changed:
SoldItemsManager.scrapeCompetitor() was rewired from FindingsAPI to SoldItemsScraper (Playwright).

### VERIFY: FindingsAPI is not imported

```bash
grep -n "FindingsAPI\|findingsAPI" service/managers/SoldItemsManager.js
```

**Expected:** Only comments. No active require() or import.

### VERIFY: SoldItemsScraper is imported and used

```bash
grep -n "SoldItemsScraper\|scraper\|scrapeSoldItems" service/managers/SoldItemsManager.js | head -20
```

**Expected:** SoldItemsScraper is required and called in scrapeCompetitor().

### VERIFY: Default category is 0 (all categories)

```bash
grep -n "categoryId\|35596\|category" service/managers/SoldItemsManager.js | head -10
```

**Expected:** Default categoryId should be '0' (not '35596'). The old 35596 was ECU-only which blinded gap intel.

### VERIFY: Browser cleanup in finally block

```bash
grep -n "finally\|closeBrowser" service/managers/SoldItemsManager.js
```

**RISK:** If Playwright browser isn't closed after scraping, orphaned Chromium processes will OOM Railway. There MUST be a finally block calling closeBrowser() or the scraper must manage its own lifecycle.

### VERIFY: Weekly cron registered correctly

```bash
grep -n "0 20.*0\|sunday\|weekly.*compet" service/routes/competitors.js
```

**Expected:** `cron.schedule('0 20 * * 0', ...)` with SoldItemsManager.scrapeAllCompetitors() + graduateMarks()

### VERIFY: Old 11am cron is disabled

```bash
grep -n "0 11\|daily.*11" service/routes/competitors.js
```

**Expected:** Commented out or removed. Should NOT be active.

---

## 4. ATTACK LIST MARK BOOST (Phase 2b)

### VERIFY: the_mark is queried and used in scoring

```bash
grep -n "the_mark\|markIndex\|isMarked" service/services/AttackListService.js | head -20
```

**Expected:**
- the_mark queried WHERE active = true in getAllYardsAttackList() or buildInventoryIndex()
- markIndex built as a Map
- scoreVehicle() checks each part against markIndex
- Matched parts get isMarked: true and +15 score bonus

### RISK: Score inflation
If the mark check matches too broadly (e.g., substring match instead of exact PN match), every part could get +15 and the boost becomes meaningless.

```bash
# Check HOW the match works — should be exact partNumberBase or normalizedTitle match
grep -A5 "isMarked\|markIndex.get\|markIndex.has" service/services/AttackListService.js
```

---

## 5. INSTANT RESEARCH SERVICE (Phase 3a)

### VERIFY: No Playwright scraping in request path

```bash
grep -n "playwright\|chromium\|scrapeSoldItems\|_doScrape" service/services/InstantResearchService.js service/routes/instant-research.js
```

**Expected:** ZERO results. InstantResearchService should be pure database queries. The old route had Playwright scraping in the request path (15s+ response time).

### VERIFY: Uses Auto+AIC JOIN (not title ILIKE)

```bash
grep -n "AutoItemCompatibility\|autoId\|itemId\|ILIKE\|ilike" service/services/InstantResearchService.js
```

**Expected:** JOIN through AutoItemCompatibility. No ILIKE on Item.title for part discovery.

### VERIFY: Engine filter includes N/A records

```bash
grep -n "engine\|N/A\|null\|normalizeEngine" service/services/InstantResearchService.js
```

**Expected:** When engine is provided, query includes both matching engine records AND records where engine is N/A/null/empty. Otherwise you lose most parts since Auto.engine is "N/A" for many records.

### VERIFY: Cache has TTL

```bash
grep -n "instant_research_cache\|24.*hour\|cache.*expire\|vehicle_key" service/services/InstantResearchService.js
```

**Expected:** Results cached in instant_research_cache with 24h TTL. ?refresh=true bypasses cache.

### RISK: Cache key collision
If cache key doesn't include engine, a lookup for "2017 Ram 1500 5.7L" would return cached results from "2017 Ram 1500 3.6L".

```bash
grep -n "vehicle_key\|cacheKey" service/services/InstantResearchService.js
```

**Expected:** Cache key format includes engine: `${year}|${make}|${model}|${engine || 'any'}` or similar.

---

## 6. PRICE RESOLVER (Phase 4c)

### VERIFY: priceResolver.js exists and exports batch function

```bash
ls -la service/lib/priceResolver.js
grep -n "resolvePrice\|resolvePricesBatch\|module.exports" service/lib/priceResolver.js
```

### VERIFY: AttackListService uses priceResolver

```bash
grep -n "priceResolver\|resolvePrice\|resolvePricesBatch\|priceSource" service/services/AttackListService.js
```

**Expected:** buildInventoryIndex() batch-loads cache prices. Each part gets a priceSource field ('market_cache' or 'item_reference').

### VERIFY: Freshness tiers are correct

```bash
grep -n "fresh\|aging\|stale\|expired\|30\|60\|90" service/lib/priceResolver.js
```

**Expected:** fresh <30d, aging 30-60d, stale 60-90d, expired >90d.

### RISK: Item.price shown as current market data
The whole point of 4c is that Item.price (frozen since Feb 2025) is never presented as current market data.

```bash
# Check if any service reads Item.price without going through priceResolver
grep -n "item\.price\|Item\.price\|\.price" service/services/AttackListService.js | grep -v "priceResolver\|priceSource\|cache\|//\|startPrice\|currentPrice\|yourPrice\|salePrice\|soldPrice"
```

**Expected:** Minimal or zero direct Item.price reads in scoring logic. All pricing should go through priceResolver or use cache.

---

## 7. TRADINGAPI (Phase 5)

### VERIFY: All four methods exist

```bash
grep -n "async.*reviseItem\|async.*endItem\|async.*relistItem\|async.*makeRequest" service/ebay/TradingAPI.js
```

**Expected:** makeRequest (GetItem), reviseItem, endItem, relistItem.

### VERIFY: Dynamic callName headers

```bash
grep -n "X-EBAY-API-CALL-NAME\|callName\|createHeaders" service/ebay/TradingAPI.js
```

**Expected:** createHeaders(callName) with dynamic value. NOT hardcoded 'GetItem'.

### VERIFY: Compatibility level updated

```bash
grep -n "COMPATIBILITY-LEVEL\|1225\|837" service/ebay/TradingAPI.js
```

**Expected:** 1225 (not 837). Old 837 could cause XML parsing issues with newer eBay API responses.

### VERIFY: Auth token used correctly

```bash
grep -n "TRADING_API_TOKEN\|eBayAuthToken\|getAuthToken" service/ebay/TradingAPI.js
```

**Expected:** All methods use the IAF auth token from env var.

### VERIFY: StaleInventoryService not broken

```bash
grep -n "ReviseItem\|reviseItem\|TradingAPI" service/services/StaleInventoryService.js
```

**Expected:** StaleInventoryService still has working ReviseItem logic (either inline or via TradingAPI.reviseItem()). Wednesday 3am automation must still work.

### RISK: StaleInventoryService inline ReviseItem vs TradingAPI.reviseItem()
Deploy summary said "Existing automation untouched: StaleInventoryService.runAutomation() still uses its own inline ReviseItem." This means there are TWO ReviseItem implementations: one in TradingAPI.js (new) and one inline in StaleInventoryService (old). This is technical debt but not a bug — both should work. Verify they use the same auth pattern.

```bash
grep -n "RequesterCredentials\|eBayAuthToken\|TRADING_API_TOKEN" service/services/StaleInventoryService.js
```

---

## 8. STALE INVENTORY ENDPOINTS (Phase 5)

### VERIFY: Safety checks on live eBay operations

```bash
# EndItem should verify listing is Active before calling eBay
grep -n "Active\|listingStatus\|verify\|check" service/routes/stale-inventory.js | grep -i "end\|relist"

# Bulk end should have item cap
grep -n "25\|bulk\|max\|limit" service/routes/stale-inventory.js

# Rate limiting between calls
grep -n "delay\|setTimeout\|1000\|rate" service/routes/stale-inventory.js
```

### RISK: No confirmation required in API
The UI has confirmation dialogs, but the API endpoints themselves should also validate. If someone hits POST /stale-inventory/end-item directly without the UI, the listing should still be verified as Active.

```bash
grep -n "findOne\|findById\|Active\|listingStatus" service/routes/stale-inventory.js | head -10
```

---

## 9. LEARNINGS SERVICE (Phase 2a)

### VERIFY: Handles empty tables gracefully

```bash
grep -n "length.*0\|empty\|\[\]\|catch\|null" service/services/LearningsService.js | head -15
```

**Expected:** dead_inventory, return_intake, and stale_inventory_action queries return empty arrays (not errors) when tables have zero rows.

---

## 10. LIFECYCLE + SEASONAL (Phase 4a/4b)

### VERIFY: SQL aggregation, not JS-side processing

```bash
grep -n "GROUP BY\|groupBy\|EXTRACT\|DATE_TRUNC\|raw(" service/services/LifecycleService.js | head -20
```

**Expected:** All grouping/aggregation done in SQL. Should NOT load all 9,500+ YourSale records into JS memory.

### RISK: Part type detection is JS-side
Deploy summary noted "All SQL-side aggregation except part type detection (JS regex on loaded rows)." This means ALL YourSale rows are loaded into memory for part type extraction. With 9,500+ records this is fine. With 50,000+ (a year from now with backfill + growth) it could be slow.

```bash
# Check if all rows are loaded
grep -n "\.query()\|\.select(\|limit\|\.map(\|extractPartType" service/services/LifecycleService.js | head -20
```

---

## 11. DATA HEALTH ENDPOINT (Phase 4c)

### VERIFY: Endpoint exists and returns cache stats

```bash
grep -n "data-health\|dataHealth\|data_health" service/routes/intelligence.js
```

**Expected:** GET /intelligence/data-health returns: marketCache stats (fresh/aging/stale/expired), priceCheck coverage, itemTable status, yourData stats.

---

## 12. MIGRATION SAFETY

### VERIFY: All migrations use hasColumn() checks

```bash
grep -n "hasColumn\|hasTable\|ifNotExists" service/database/migrations/*repurpose* service/database/migrations/*2026032*
```

**Expected:** Phase 1c/1d migration (PriceSnapshot repurpose) uses hasColumn() so it's safe to run repeatedly.

### VERIFY: No destructive migrations

```bash
# Check for DROP TABLE, DROP COLUMN, or ALTER TABLE DROP in recent migrations
grep -n "dropTable\|dropColumn\|DROP" service/database/migrations/*2026* | grep -v "ifExists\|down"
```

**Expected:** Only in `down()` functions (rollback), never in `up()`.

---

## 13. FRONTEND NAVIGATION CONSISTENCY

### VERIFY: All new pages are in the nav

```bash
# Check what's in the INTEL nav row across all HTML pages
grep -n "VELOCITY\|LEARNINGS\|LIFECYCLE\|STALE\|INTEL" public/*.html | grep -i "nav\|href\|link" | head -20
```

**Expected:** VELOCITY, LEARNINGS, LIFECYCLE, STALE all appear in the nav row. Every DarkHawk page should have consistent navigation.

---

## 14. AUTH SURFACE CHECK

### VERIFY: New endpoints match DarkHawk auth pattern

```bash
# All DarkHawk endpoints should be NO AUTH (admin pages are behind static /admin)
# Check if any new routes accidentally require auth
grep -n "authMiddleware\|isAdmin" service/routes/intelligence.js service/routes/stale-inventory.js service/routes/instant-research.js service/routes/demand-analysis.js
```

**Expected:** New DarkHawk-facing endpoints (learnings, data-health, lifecycle, seasonal, candidates, velocity) should NOT require auth. The /admin static serve provides the access control for the HTML pages.

### RISK: Unauthenticated write endpoints
POST /stale-inventory/end-item, /revise-price, /relist-item, /bulk-end are WRITE operations that modify live eBay listings. Having these unauthenticated means anyone who knows the URL can end your listings.

```bash
grep -n "post.*end-item\|post.*revise\|post.*relist\|post.*bulk" service/routes/stale-inventory.js | head -10
```

**RECOMMENDATION:** These should either require auth OR at minimum be IP-restricted. Currently they're probably unauthenticated like all DarkHawk endpoints. This is a security risk — not urgent since the app isn't publicly discoverable, but should be addressed.

---

## 15. RACE CONDITIONS

### NEW RISK from Phase 1c: PriceCheck + cache write concurrency

PriceCheckCronRunner runs Sunday 2am checking multiple listings in parallel. Each check now writes to market_demand_cache. If two checks for the same partNumberBase run concurrently, the UPSERT could produce inconsistent data.

```bash
# Check if PriceCheckCronRunner processes items serially or in parallel
grep -n "Promise.all\|parallel\|concurrent\|batch\|forEach\|for.*of" service/crons/PriceCheckCronRunner.js service/routes/price-check.js | head -15
```

**Expected:** Serial processing (for loop, one at a time) is safe. Parallel processing (Promise.all with batches) could cause UPSERT conflicts but Postgres UPSERT is atomic per-row, so data won't corrupt — just the "last write wins" behavior, which is fine since both writes have the same source data.

### NEW RISK from Phase 2.5: Competitor scrape + cache write overlap

The weekly competitor scrape runs Sunday 8pm. PriceCheck cron runs Sunday 2am. If PriceCheck runs long and overlaps with competitor scrape, both are using Playwright simultaneously on Railway.

```bash
# Check memory — two Playwright instances on Railway could OOM
grep -n "browser\|chromium\|singleton\|_browser" service/services/PriceCheckService.js service/ebay/SoldItemsScraper.js | head -20
```

**RISK:** PriceCheckService uses a persistent browser singleton (module-level `_browser`). SoldItemsScraper creates its own browser. If both run simultaneously, Railway gets two Chromium instances. With Railway's default 512MB-1GB memory, this could OOM.

**MITIGATION:** PriceCheck finishes by ~4-5am. Competitor scrape doesn't start until 8pm. 15-hour gap. Low risk in practice, but if PriceCheck ever hangs, the browser stays alive.

### EXISTING RISK: StaleInventoryService double-reduce

```bash
grep -n "async-lock\|lock\|mutex\|dedup\|running" service/services/StaleInventoryService.js | head -10
```

This was flagged in the original audit. If POST /stale-inventory/run is hit while the Wednesday cron is already running, items could get double-reduced. The new manual "Run Now" button in stale-inventory.html increases this risk.

---

## 16. DATA FLOW INTEGRITY — END-TO-END CHAINS

### Chain A: PriceCheck → market_demand_cache → attack list scoring

```
PriceCheckService.checkPrice()
  → runPipeline() → scrapeSoldItems() → calculateMetrics()
  → PriceCheck.saveCheck() (always works)
  → [NEW] extract PN → UPSERT market_demand_cache (try/catch, 3-day guard)
  → [NEW] INSERT PriceSnapshot (try/catch)

AttackListService.scoreVehicle()
  → [CHANGED] buildInventoryIndex() batch-loads market_demand_cache
  → priceResolver.resolvePricesBatch() → one SQL query
  → Each part gets price from cache (or Item.price fallback)
  → Score uses cache price for value calculation
```

**VERIFY:** The PN extracted from PriceCheck titles matches the partNumberBase format used in market_demand_cache lookups.

```bash
# How does PriceCheck extract PNs?
grep -n "extractPartNumbers\|partNumberBase\|partNumber" service/services/PriceCheckService.js service/ebay/PriceCheckService.js | head -10

# How does priceResolver look them up?
grep -n "part_number_base\|partNumberBase" service/lib/priceResolver.js | head -10
```

**RISK:** If PriceCheck extracts "56044691AA" but attack list looks up "56044691" (base without suffix), the cache hit misses. Verify both sides use the same normalization.

### Chain B: Competitor scrape → SoldItem → gap intel → the_mark → attack list

```
SoldItemsScraper.scrapeSoldItems()
  → [CHANGED] Playwright scraping (was FindingsAPI)
  → SoldItemsManager processes items → INSERT SoldItem

GET /competitors/gap-intel
  → SQL reads SoldItem, compares against YourSale + YourListing + Item
  → Returns parts competitors sell that we don't

POST /competitors/mark → INSERT the_mark

AttackListService.scoreVehicle()
  → [NEW] Loads the_mark WHERE active = true
  → Checks each part against mark index
  → +15 bonus + isMarked flag
```

**VERIFY:** Gap intel SQL doesn't filter on any FindingsAPI-specific fields that Playwright wouldn't populate:

```bash
grep -n "gap-intel" service/routes/competitors.js | head -5
# Then read the SQL query it runs — check for fields like 'compatibility', 'categoryName' etc that Playwright might not populate
```

### Chain C: VIN decode → instant research → UI

```
POST /vin/decode-photo → Claude Vision → NHTSA → { year, make, model, trim, engine, drivetrain }
Frontend stores: _lastEngine, _lastDrivetrain
Frontend calls: GET /api/instant-research?year=X&make=Y&model=Z&engine=E&drivetrain=D

InstantResearchService.researchVehicle()
  → [NEW] Query Auto WHERE year + make + model (word-boundary) + engine (normalized, includes N/A)
  → JOIN AIC → Item
  → Enrich: YourSale, YourListing, market_demand_cache, the_mark
  → Score, badge, cache
```

**VERIFY:** VIN scanner HTML actually passes engine in the fetch URL:

```bash
grep -n "instant-research\|_lastEngine\|engine" public/vin-scanner.html | head -15
```

### Chain D: Stale inventory automation → eBay (SAFETY CRITICAL)

```
Wednesday 3am: StaleInventoryService.runAutomation()
  → Finds listings > threshold days
  → Checks programmed schedules
  → Calls ReviseItem (inline, NOT via TradingAPI.js) to reduce price
  → Logs to stale_inventory_action

Manual via UI: POST /stale-inventory/revise-price
  → Calls TradingAPI.reviseItem() (new method)
  → Logs to stale_inventory_action

Manual via UI: POST /stale-inventory/end-item
  → Calls TradingAPI.endItem() (new method)
  → Logs to stale_inventory_action
```

**VERIFY:** Both automation and manual paths log to stale_inventory_action:

```bash
grep -n "stale_inventory_action" service/services/StaleInventoryService.js service/routes/stale-inventory.js | head -20
```

---

## 17. DEAD / UNUSED CODE

### Phase changes may have orphaned code

```bash
# Check if old MarketDemandCronRunner is still imported anywhere active
grep -rn "MarketDemandCronRunner" service/ --include="*.js" | grep -v node_modules | grep -v "// "

# Check if CronWorkRunner is still imported anywhere active
grep -rn "CronWorkRunner" service/ --include="*.js" | grep -v node_modules | grep -v "// "
```

**Expected:** Both should only appear in their own files and in disabled/commented code. If they appear in index.js startup without being commented out, they'll still register their cron schedules and silently fail.

### PriceSnapshot was "orphaned" in original audit — now it's used

```bash
grep -rn "PriceSnapshot\|price_snapshot" service/ --include="*.js" | grep -v node_modules | grep -v migration | head -10
```

**Expected:** PriceCheckService, run-yard-market-sniper.js, and run-importapart-drip.js all write to PriceSnapshot. It's no longer orphaned.

---

## 18. ENVIRONMENT VARIABLE DEPENDENCIES

### VERIFY: All required env vars for new features

```bash
# New code shouldn't need any NEW env vars beyond what already exists
# But verify nothing references an undefined var
grep -rn "process.env\." service/services/InstantResearchService.js service/services/LearningsService.js service/services/LifecycleService.js service/lib/priceResolver.js service/ebay/TradingAPI.js | grep -v node_modules
```

**Expected:** Only standard vars (DATABASE_URL, TRADING_API_TOKEN, ANTHROPIC_API_KEY, etc). No new vars introduced.

---

## 19. VERIFICATION QUERIES (Run against production database)

These should be run via Claude Code connecting to the shared Postgres:

```sql
-- 1. market_demand_cache health
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days') as fresh,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '60 days' AND updated_at <= NOW() - INTERVAL '30 days') as aging,
  COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '90 days' AND updated_at <= NOW() - INTERVAL '60 days') as stale,
  COUNT(*) FILTER (WHERE updated_at <= NOW() - INTERVAL '90 days') as expired
FROM market_demand_cache;

-- 2. PriceSnapshot has data (Phase 1c/1d)
SELECT source, COUNT(*), MAX(snapshot_date) as latest
FROM "PriceSnapshot"
WHERE source IS NOT NULL
GROUP BY source;

-- 3. PriceCheck records with searchQuery (ready for cache seeding)
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE "searchQuery" IS NOT NULL) as has_query
FROM "PriceCheck";

-- 4. the_mark active items (Phase 2b boost source)
SELECT COUNT(*) as total_marks,
       COUNT(*) FILTER (WHERE active = true) as active_marks
FROM the_mark;

-- 5. stale_inventory_action recent entries
SELECT action_type, COUNT(*), MAX(created_at) as latest
FROM stale_inventory_action
GROUP BY action_type
ORDER BY latest DESC;

-- 6. SoldItemSeller status (Phase 2.5 — should show lastScrapedAt if scrape has run)
SELECT name, enabled, "itemsScraped", "lastScrapedAt"
FROM "SoldItemSeller"
ORDER BY "lastScrapedAt" DESC NULLS LAST
LIMIT 10;

-- 7. instant_research_cache entries (Phase 3a)
SELECT COUNT(*) as cached_vehicles,
       MAX(created_at) as newest_cache
FROM instant_research_cache;

-- 8. YourSale record count (should be 9,517+ from API sync + 14,357 from CSV backfill)
SELECT COUNT(*) as total,
       MIN("soldDate") as earliest,
       MAX("soldDate") as latest
FROM "YourSale";

-- 9. Verify no duplicate PriceSnapshot source='price_check' entries
SELECT part_number_base, COUNT(*)
FROM "PriceSnapshot"
WHERE source = 'price_check'
GROUP BY part_number_base
HAVING COUNT(*) > 10
LIMIT 5;
-- A few dupes are fine (history). Thousands per PN = runaway loop.
```

---

## 20. ENDPOINT SMOKE TESTS

Hit each new endpoint and verify response shape:

```bash
BASE=https://parthawk-production.up.railway.app

# Phase 2a
curl -s "$BASE/intelligence/learnings" | jq 'keys'
# Expected: ["deadPatterns","generatedAt","returnPatterns","staleOutcomes"]

# Phase 2c
curl -s "$BASE/demand-analysis/health" | jq '.healthScore'
# Expected: a number 0-100

# Phase 3a
curl -s "$BASE/api/instant-research?year=2017&make=Ram&model=1500" | jq '.totalParts'
# Expected: a number > 0

# Phase 4a
curl -s "$BASE/intelligence/lifecycle?days=365" | jq '.totals'
# Expected: {"totalRevenue":...,"totalSales":...,"avgDaysToSell":...,"periodDays":365}

# Phase 4b
curl -s "$BASE/intelligence/seasonal?years=2" | jq '.monthly | length'
# Expected: 12

# Phase 4c
curl -s "$BASE/intelligence/data-health" | jq '.marketCache'
# Expected: {"total":...,"fresh":...,"aging":...,"stale":...,"expired":...}

# Phase 5
curl -s "$BASE/stale-inventory/candidates" | jq '.candidates | length'
# Expected: a number (could be 0 if no stale inventory)

# Health check (always)
curl -s "$BASE/api/health-check"
# Expected: {"ok":true}
```

---

## SUMMARY OF HIGHEST-RISK ITEMS

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| 1 | FindingsAPI still called by active cron | HIGH | LOW (crons disabled in code) | Audit grep confirms |
| 2 | Unauthenticated write endpoints (end/relist) | MEDIUM | LOW (URL not public) | Add auth or IP whitelist |
| 3 | Two Playwright instances OOMing Railway | MEDIUM | LOW (15hr gap between crons) | Monitor Sunday logs |
| 4 | StaleInventory double-reduce via manual+cron overlap | MEDIUM | LOW (different days) | Add async-lock to manual endpoint |
| 5 | PN normalization mismatch between PriceCheck cache write and attack list cache read | MEDIUM | MEDIUM | Verify both use same format |
| 6 | Item.price shown as current somewhere we missed | LOW | MEDIUM | grep audit confirms |
| 7 | LifecycleService loading all YourSale into memory | LOW | LOW (9.5K rows OK, watch growth) | Future: move partType detection to SQL |
| 8 | instant_research_cache key doesn't include engine | MEDIUM | LOW (verified in 3a/3b) | Cache key audit confirms |

---

*Run all verification commands in order. Report any failures. Do not fix — report only. Architect reviews results before any changes.*
