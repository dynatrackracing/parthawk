# SNAPSHOT_SERVICES.md
Generated 2026-04-10

## Core Services

### AttackListService.js
- Purpose: Scores yard vehicles by pull value — matches yard vehicles against Auto+Item inventory, YourSale history, and YourListing stock
- Key methods: `buildInventoryIndex()`, `buildSalesIndex()`, `buildStockIndex()`, `buildPlatformIndex()`, `buildScoutAlertIndex()`, `findMatchedParts()`, `getAttackList()`, `getAllYardsAttackList()`, `scoreManualVehicles()`, `getModelVariants()`, `scoreVehicle()`
- **Constants:**
  - `PART_PRICE_FLOORS`: ABS=$150, ECU/ECM/TCM/BCM/TIPM/CLUSTER/RADIO/THROTTLE/AMP/AMPLIFIER/HVAC/NAV/CAMERA=$100. AIRBAG removed (now excluded).
  - `COMPOUND_MODEL_MAP`: F-250 Super Duty → [F-250, F250], Explorer Sport Trac → [Explorer], Grand Cherokee L → [Grand Cherokee], etc.
  - `PN_EXACT_YEAR_TYPES`: ECM, PCM, ECU, BCM, TIPM, ABS, TCM, TCU, FUSE, JUNCTION, AMP, RADIO, CLUSTER, THROTTLE, INSTRUMENT, SPEEDOMETER
  - `MAKE_ALSO_CHECK`: Ram ↔ Dodge
- **isExcludedPart():** Engines/internals (assembly, block, head, piston, crankshaft, flywheel, etc.), transmissions (assembly, complete, reman), body panels (fender, bumper, hood, door shell, quarter/rocker panel, bed side, trunk lid, roof panel), airbags/SRS (AIRBAG, AIR BAG, SRS MODULE/SENSOR/UNIT, SUPPLEMENTAL RESTRAINT). Clock springs NOT excluded.
- **extractPartSpecifics():** Detects performance trims (ST/RS/SS/SRT/Si/TRD/Nismo/Raptor/AMG/Shelby/Trail Boss/ZR2/S-Line/R-Line/GT), forced induction (EcoBoost/Twin Turbo/Turbocharged/Supercharged/TFSI/TSI/2.0T pattern), transmission (manual/automatic/DCT/CVT), diesel (Diesel/TDI/Duramax/Cummins/Power Stroke/EcoDiesel). Context-aware regex safety.
- **buildInventoryIndex():** Auto+AIC+Item join. Price chain: market_demand_cache → Item.price (REF) → no price. Pro-rebuild ECM exception: ECM/ECU/PCM from pro-rebuild treated as normal (included in totalValue). Index keyed by `make|model|year`.
- **buildSalesIndex():** YourSale keyed by `make|model` → `{ make, model, sales: [{ price, partType, yearStart, yearEnd, soldDate, title }] }`. 90-day window.
- **buildStockIndex():** byMakeModel: `make|model` → qty sum. byPartNumber: `basePn` → `{ total, fullPNs: Set }`. Per-listing Set dedup. resolveStock() returns `{ count, matchType: 'exact'|'base'|'none' }`.
- **buildScoutAlertIndex():** Batch loads unclaimed scout_alerts with match_score ≥ 50. Returns index keyed by `year|make|model|yardName` → `[{ id, source, title, value, partType, partNumber, matchScore, confidence }]`. Requires vehicle._yardName attached before scoreVehicle call.
- **Model matching:** `getModelVariants()` generates compound+dash/no-dash variants. Bidirectional fuzzy regex in findMatchedParts(), sales index, stock index. Protected pairs: Grand Cherokee, Transit Connect, Grand Caravan.
- **scoreVehicle() signature (11 params):** `scoreVehicle(vehicle, inventoryIndex, salesIndex, stockIndex, platformIndex={}, stockPartNumbers={}, markIndex={byPN:Map,byTitle:Set}, intelIndex={wantPNs:Set,flagPNs:Set}, frequencyMap={}, soldKeys=new Set(), scoutAlertIndex={})`
- **scoreVehicle() — SA injection phases (NEW 2026-04-10):**
  - **Per-vehicle validation gates:** Before injection, _rawAlerts from scoutAlertIndex are filtered per vehicle: (1) Hybrid gate — title says `hybrid` → vehicle must have hybrid in trim/engine_type; (2) Electric gate — title says `electric`/`bev`/`ev` → vehicle must be EV; (3) Displacement gate — title has `N.NL` → vehicle decoded_engine must match within ±0.15L. Mismatched alerts are dropped silently.
  - **Phase 1 — MERGE:** Attach surviving alerts to existing filteredParts that share partType or partNumber (best match_score wins). If alert.value > part.price (and priceSource !== 'sold'), price is upgraded to alert value. Sets `scoutAlertMatch`, `scoutAlertScore`, `alertMatch` on part.
  - **Phase 2 — INJECT:** For alerts not merged in Phase 1, if partType not already covered in filteredParts, a synthetic chip is pushed with `isSynthetic:true`, `priceSource:'scout_alert'`, value from alert, `reason: 'Scout alert (score N) — source'`.
- **Scoring pipeline (scoreVehicle):**
  1. Part novelty: NOVEL (0 stock + 0 sales) +20%, RESTOCK (0 stock + sold) +10%, STOCKED 0%. Applied to _scoringValue (not display price).
  2. totalValue = sum of _scoringValue for above-floor, non-mismatch parts
  3. Score from value tiers: $1000+ → 90-100, $800 → 80+, $600 → 70+, $400 → 60+, $250 → 50+, $150 → 40+, >0 → 20+, 0 → 5
  4. Bonuses: extra parts (+3/part, max +15), 2+ sales (+5), on Mark (+15)
  5. Stock penalty: 1=-5%, 2=-15%, 3=-30%, 4=-50%, 5+=-70%
  6. Fresh arrival (via daysSinceSetET from dateHelpers, LKQ set date in ET): ≤3d +10%, ≤7d +5%, ≤14d +2%
  7. COGS yard factor: ±5%
  8. Attribute boosts (stacks multiplicatively): ELECTRIC +25%, PHEV +20%, PERFORMANCE +20%, HYBRID +15%, DIESEL +15%, 4WD+MT +12%, PREMIUM +10%, MANUAL +8%, 4WD +5%. Hybrid/PHEV/EV detected via classifyPowertrain() from LocalVinDecoder.
  9. Rarity from vehicle_frequency: LEGENDARY (180+d or 1 sighting) +30%, RARE (90+d) +20%, UNCOMMON (45+d) +10%, NORMAL (15+d) 0%, COMMON (7+d) -5%, SATURATED (<7d) -15%
  10. **Score UNCAPPED** — can exceed 100 with boosts
- **Intel index:** `buildIntelIndex()` loads 4 PN sets: quarryPNs (auto_generated want list), streamPNs (manual want list), overstockPNs (overstock_group_item), flagPNs (restock_flag). Mark targets from separate markIndex. Per-part `intelSources` array: ['mark', 'quarry', 'stream', 'restock', 'overstock', 'flag', 'sold']. Overstock parts get `overstockWarning: true`. `intel_match_count` on vehicle response.
- **Intel scoring boosts:** MARK ×1.15 (+15%), QUARRY ×1.10 (+10%), STREAM/RESTOCK ×1.05 (+5%). Applied per matching part, multipliers compound. Overstock parts excluded from totalValue.
- **YourSale-driven value (2026-04-09):** `getYourSalePriceMap(partNumberBases)` batch-loads 90-day avg/max/count per PN from YourSale. Vehicle value fields: `maxYourSalePart` (highest YourSale avg across non-excluded parts) and `yourSaleEstValue` (sum). Parts with `priceSource='sold'` are trusted directly (legacy resolver already resolved YourSale data); parts with `priceSource='item_reference'` contribute $0. market_demand_cache is decorative only. `isExcludedPart()` exported as static method.
- **Platform expansion gate (2026-04-09):** `siblingKeyPartTypes` map tracks which candidateKeys came from platform siblings. Sales from siblings only contribute if their partType is in the sibling group's `partTypes` whitelist from `platform_shared_part` table. Default when no whitelist: skip expansion. VW MQB group deleted 2026-04-09.
- **Sort (2026-04-09):** Vehicles by maxYourSalePart DESC, yourSaleEstValue DESC tiebreaker, est_value DESC final tiebreaker. Active first. Market_demand_cache and Item.price REF do NOT affect sort.
- **No vehicle limit** — full yard inventory served. Frontend VEHICLE_CAPS raised to 5000.
- **Response fields:** score (uncapped), rarityTier/Color/Pulses/Reason/AvgDays/TotalSeen/Boost, attributeBoost/boostReasons (includes HYBRID/PHEV/ELECTRIC), daysSinceSet (int, server-computed in ET), setDateLabel (string), intel_match_count, est_value, max_part_value, maxYourSalePart, yourSaleEstValue, parts with noveltyTier/noveltyBoost/intelSources/overstockWarning/stockMatchType/specMismatch/mismatchReason/belowFloor/yourSalePrice/yourSaleCount/valueSource/displayPrice/isExcluded/scoutAlertMatch/scoutAlertScore/alertMatch/isSynthetic. Yard-level: lastScrapedHoursAgo, isStale (>18h).
- **Blocked comps:** COMP filter in buildInventoryIndex() via compIds from BlockedCompsService.getBlockedSet(). SOLD filter in scoreVehicle() via soldKeys parameter (loaded once per request in async callers). scoreVehicle is SYNC — do NOT add await inside it.

### BlockedCompsService.js
- Purpose: Manages blocked comp items — two block types (COMP by Item.id, SOLD by partType+year+make+model)
- Key methods: `block(itemId)`, `blockSold({partType, year, make, model})`, `unblock(itemId)`, `unblockSold({...})`, `unblockById(rowId)`, `list({search, type, limit, offset})`, `getBlockedSet()` → `{ compIds: Set, soldKeys: Set }`, `makeSoldKey(partType, year, make, model)`
- Cache: 60s in-memory TTL for getBlockedSet(). Invalidated on every block/unblock.
- On block: snapshots Item data (title/PN/category), invalidates matching market_demand_cache rows, clears all AttackListService part-matching caches.
- Partial unique indexes: `blocked_comps_unique_comp` on source_item_id, `blocked_comps_unique_sold` on (part_type, year, make, model). INSERT uses raw SQL (Knex builder broken for partial indexes).

### CacheService.js (The Cache)
- Purpose: Full lifecycle for claimed parts — yard claim through eBay listing
- Key methods: `claim()`, `updateEntry()`, `returnToAlerts()`, `deleteClaim()`, `manualResolve()`, `resolveFromListings()`, `getActiveClaims()`, `getClaimedKeys()`, `getHistory()`, `getStats()`, `checkCacheStock()`
- Sources: daily_feed, scout_alert, hawk_eye, flyway, manual
- Statuses: claimed → listed / returned / deleted
- **claim():** Accepts itemId (no-PN parts). Dedup by normalized PN or itemId. Normalizes partNumber via normalizePartNumber().
- **updateEntry():** Partial update — partNumber (re-normalized), partDescription, partType, make, model, year, notes.
- **getClaimedKeys():** Returns three maps: claimedPNs (normalizedPN → cacheId), claimedItemIds (itemId → cacheId), claimedAlertIds (alertId → cacheId).
- Auto-resolve: resolveFromListings() matches cache entries against YourListing by PN or make+model+partType (listing created AFTER claim). Runs after every sync (4x/day).

### COGSService.js
- Purpose: True COGS = parts cost + gate fee (no tax, no mileage). Target 30%, ceiling 35%.
- Key methods: `getYardProfile()`, `calculateGateMax()`, `calculateSession()`

### FlywayService.js
- Purpose: Multi-yard trip planning CRUD — trips, yard routing, trip-specific attack lists
- Key methods: `getTrips()`, `createTrip()`, `getFlywayAttackList()`, `cleanupExpiredTripVehicles()`, `getCoreYardIds()`
- getCoreYardIds() reads `is_core` flag from yard table (4 LKQ NC yards)
- **Blocked comps:** Inherits both COMP and SOLD filters via AttackListService.scoreVehicle() — loads soldKeys once before the scoring loop, passes as parameter
- cleanupExpiredTripVehicles() deactivates vehicles 24h after trip completion, protects core yards + active trip yards
- **getFlywayAttackList():** Builds full intelIndex + frequencyMap (same as Daily Feed). Road trip filter: only LEGENDARY + RARE + MARK vehicles. Day trip: no filter (identical to Daily Feed). Part chips: 6 max with noveltyTier + intelSource.

## Intelligence Services

### PhoenixService.js
- Purpose: Rebuild seller intelligence — groups competitor catalog by partNumberBase, matches against SoldItem velocity, enriches with market_demand_cache
- Scoring: velocity (35pts), revenue (25pts), price sweet spot (20pts), market demand (20pts)

### ScoutAlertService.js
- Purpose: Generates yard-vehicle alerts by matching want-list parts, sold history, and marks against active yard inventory
- Key methods: `generateAlerts()` (concurrency-guarded), `scoreMatch()`, `scoreMarkMatch()`, `getMarkVehicle()`, `hasModelConflict()`, `computeMatchScore()`
- **Vehicle query (2026-04-10):** Selects `decoded_cylinders` and `engine_type` in addition to existing decoded fields. These feed Phase 4 (cylinder check) and Phase 6b (hybrid/EV powertrain) of computeMatchScore().
- **Mark matching (2026-04-07 rewrite):** `getMarkVehicle(mark)` reads structured columns (year_start, year_end, make, model) from the_mark row instead of parsing title at match time. Engine still extracted from title. `needs_review` marks excluded from alert generation (filtered in the_mark query).
- **Year is a HARD GATE in scoreMarkMatch():** No structured year on mark → no match. No vehicle year → no match. Out of range → no match. No more silent fallthrough when year is null.
- **Yard filtering:** Only is_core yards + yards on active Flyway trips
- **Part-type-sensitive confidence:** PART_TYPE_SENSITIVITY map — ECM/PCM/THROTTLE=engine, ABS=drivetrain, AMP/RADIO/NAV=trim, BCM/TIPM/CLUSTER=universal
- **computeMatchScore() — 8 phases (2026-04-10):**
  - Baseline: ENGINE_SENSITIVE_TYPES (ECM/PCM/ECU/TCM/TCU/THROTTLE) start at 55, all others at 50
  - Phase 3 (Year proximity): PN_EXACT_YEAR_TYPES only — exact year +10, tight range +5, broad range (4+yr) -5
  - Phase 4 (Engine path): engine-sensitive types only — cylinder check (match +25/-50), named engine check (match +30/make mismatch -60/disp mismatch -30), displacement check (match +25/-50). Uses `decoded_cylinders` for vehicle cylinder count.
  - Phase 5 (Diesel path): title diesel marker → diesel match +35, gas vehicle -80, unknown -20
  - Phase 6 (Drivetrain path): ABS/drivetrain-sensitive types — base +10, drivetrain match +25/-50
  - **Phase 6b (Hybrid/EV powertrain — NEW 2026-04-10):** Fires for ALL part types. Detects `electric/ev/bev`, `phev/plug-in hybrid`, or `hybrid` in want title. Reads `engine_type` field from vehicle (ELECTRIC/BEV/PLUG-IN HYBRID/PHEV/HYBRID). Falls back to classifyPowertrain(). Match +25, hybrid-on-gas -60, EV-on-non-EV -60, PHEV-on-gas -60.
  - **Phase 6c (Displacement — all part types — NEW 2026-04-10):** Fires for non-engine-sensitive types only (engine types already ran displacement in Phase 4). If want title has a displacement and vehicle has decoded_engine displacement, match within ±0.15L → +15; mismatch → -50. Catches intake manifolds, valve covers, turbos, etc.
  - Phase 7 (Trim path): trim-sensitive types only — premium audio brand vs vehicle trim_tier (PREMIUM +30, PERFORMANCE +25, BASE -40)
  - Phase 8 (Ceiling): part-type ceiling clamp; score clamped to 0–100 at end
- **Confidence:** HIGH ≥75, MEDIUM ≥55, LOW <55. Engine displacement + named engine + cylinder comparison. Drivetrain 4WD/2WD check. Trim premium audio vs base.
- **Model conflicts:** Cherokee≠Grand Cherokee, Transit≠Transit Connect, Wrangler≠Gladiator
- **Part exclusion:** isExcludedPart() filters before alert generation
- Atomic refresh: delete + re-insert in transaction, preserves claimed status

### CompetitorMonitorService.js
- Purpose: Advisory alerts — underpriced vs market, competitor dropout, competitor undercut

### FitmentIntelligenceService.js
- Purpose: Fitment negations via "subtraction"

### MarketPricingService.js
- Purpose: Batch market pricing for Daily Feed — dedupes by PN, checks market_demand_cache (90-day TTL)

### ListingIntelligenceService.js
- Purpose: Aggregates intelligence for a single listing

## Restock & Inventory

### restockReport.js (THE QUARRY) — `service/routes/restockReport.js`
- Purpose: Restock intelligence using Clean Pipe columns only
- Urgency tiers: CRITICAL (ratio≥4 or 0 stock+sold 3x+$100+), LOW (ratio≥2 or 0 stock), WATCH (ratio≥1)
- quarrySync(): auto-adds CRITICAL+LOW to restock_want_list. Called by YourDataManager after syncAll (4x/day)

### RestockService.js
- Purpose: Flags parts where sold ≥ 2x active stock in 90 days

### DeadInventoryService.js
- Purpose: Identifies stale listings needing action

### OverstockCheckService.js
- Purpose: Monitors overstock watch groups — triggers alerts when stock thresholds exceeded. Auto-creates want list entry when stock drops to 0 (overstock → want list lifecycle).

### StaleInventoryService.js
- Purpose: Automated price reductions via TradingAPI. 60d=-10% through 270d=-30%

## Data Sync & Import

### YourDataManager.js — `service/managers/YourDataManager.js`
- Purpose: Syncs YOUR eBay seller data (orders + listings) via SellerAPI
- Post-sync chain: (1) OverstockCheckService.checkAll(), (2) CacheService.resolveFromListings(), (3) quarrySync()
- Clean Pipe: calls extractStructuredFields(title) on every insert

### AutolumenImportService.js
- Purpose: CSV import for Autolumen (second eBay store)

### SoldItemsManager.js — `service/managers/SoldItemsManager.js`
- Purpose: Scrapes competitor sold items via Playwright, stores in SoldItem

## VIN & Vehicle Services

### PostScrapeService.js
- Purpose: Universal post-scrape enrichment — runs after ANY yard scraper completes
- Pipeline: (1) Batch VIN decode via LocalVinDecoder (50/call), (2) Trim tier matching, (3) Scout alerts (non-blocking)

### VinDecodeService.js
- Purpose: Single-VIN and batch decode with caching
- decodeAllUndecoded() writes decoded_engine, decoded_drivetrain, decoded_transmission, engine_type, body_style

### TrimTierService.js
- Purpose: Trim tier lookup — 3-tier cascade: trim_tier_reference (curated), trim_catalog (eBay Taxonomy), static config fallback

## Pricing Services

### PriceCheckServiceV2.js
- Purpose: eBay sold comp scraper — axios+cheerio. **Blocked on Railway by eBay captcha.**

### PriceCheckService.js (V1)
- Purpose: Original Playwright-based eBay price check

## Cron Schedule (UTC, from index.js)

| Runner | Schedule | What it does |
|---|---|---|
| YourDataManager.syncAll | `0 1,7,13,19 * * *` (4x/day) | eBay orders + listings sync |
| Vehicle frequency update | `30 6 * * *` (daily 6:30am) | Updates vehicle_frequency from new arrivals |
| FlywayScrapeRunner | `0 6 * * *` (daily 6am) | Scrapes non-LKQ yards |
| VIN decode (3am + 8:40am) | `0 3, 40 8 * * *` | Post-scrape VIN decode + trim tier |
| CompetitorDripRunner | `0 0,5,12,18 * * *` (4x/day) | Random seller scrape |
| PriceCheckCronRunner | `0 2 * * 0` (Sun 2am) | Weekly batch 35 listings |
| StaleInventoryService | `0 3 * * 3` (Wed 3am) | Weekly stale automation |
| DeadInventoryService | `0 4 * * 1` (Mon 4am) | Weekly dead scan |
| RestockService | `0 4 * * 2` (Tue 4am) | Weekly restock scan |
| CompetitorMonitorService | `0 4 * * 4` (Thu 4am) | Weekly competitor monitoring |
| EbayMessagingService | `*/15, */2 * * * *` | Poll + process messages |
