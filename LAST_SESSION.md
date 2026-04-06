# LAST SESSION — 2026-04-05

## Edit Part Numbers on Cache & Scour Stream Want List
- Added PATCH /cache/:id — update partNumber (re-normalized), partDescription, partType, make, model, year, notes on cache entries
- Added PATCH /restock-want-list/:id — update title, notes on want list entries
- Added PATCH /restock-want-list/by-title — update want list entry by title match (used by scout-alerts inline edit), also updates scout_alerts.source_title
- cache.html: part number and description are now inline-editable (tap to edit, save on blur/Enter, green flash on success). Empty fields show "+ add PN" / "+ add description" placeholders.
- restock-list.html (Scour Stream): want list title and notes are inline-editable in the WANT LIST tab
- scout-alerts.html: STREAM alert source_title is inline-editable — patches the underlying want list entry and syncs alert records

## Files touched
- service/services/CacheService.js — added updateEntry()
- service/routes/cache.js — added PATCH /:id
- service/routes/restock-want-list.js — added PATCH /:id, PATCH /by-title
- service/public/cache.html — inline edit CSS + JS for partNumber, partDescription
- service/public/restock-list.html — inline edit CSS + JS for title, notes
- service/public/scout-alerts.html — inline edit CSS + JS for STREAM source_title

## What's next — priority order
1. Verify Skip/Note buttons removed from attack list
2. Scout alert source badges on Daily Feed parts
3. Fix Hunters Perch → Mark link
4. Hawk Eye search functionality (enables Sky Watch workflow)
5. Hawk Eye + Flyway cache sync (same claimed-keys pattern)

## Open tech debt
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitorService Thu 4am reads frozen SoldItem
- LifecycleService loads all YourSale into memory (watch at 50K+)
- The Mark table empty (adoption gap — Hunters Perch link broken)
- instrumentclusterstore scraper: 0 items, needs debug-scrape diagnosis
- MarketPricingService still references PriceCheckServiceV2 as fallback (dead on Railway too?)

## 17:00 — Global Part Value Colors + Exclusion Filter
- Created dh-parts.js + dh-parts.css — shared 6-tier color system across all 6 field pages
- getPartTier(price), renderPriceBadge(price, prefix), isExcludedPart(title)
- Tiers: ELITE $500+ gold pulse, PREMIUM $350+ purple pulse, HIGH $250+ blue, SOLID $150+ green, BASE $100+ orange, LOW <$100 red
- Exclusions: complete engines/transmissions/body panels filtered; all modules/trim/glass/steering allowed
- Backend isExcludedPart() updated: removed transfer case + steering rack (sellable), added trunk lid/roof panel/bumper assembly
- Inline tierColor() kept on attack-list.html for vehicle score chip CSS (separate from part badges)

## 17:30 — Scout Alerts: Flyway Trip Filter
- ScoutAlertService yard_vehicle query now filters by trip status
- Core yards (is_core=true) always generate alerts
- Road trip yards only generate alerts when their flyway_trip status = 'active'

## 17:45 — Scout Alerts: Confidence Matching Overhaul
- scoreMatch() was checking if vehicle.engine EXISTS, not if it MATCHES — a 3.6L V6 got HIGH confidence for a HEMI part
- Added PART_TYPE_SENSITIVITY map: ECM/PCM/THROTTLE=engine, TCM=engine+drivetrain, ABS=drivetrain, AMP/RADIO/NAV=trim, BCM/TIPM/CLUSTER=universal
- Real engine verification: displacement extraction, named engine matching (HEMI vs Pentastar), cylinder count
- Real drivetrain verification: 4WD/AWD vs 2WD/FWD
- Trim verification: premium audio brands vs base trim
- Confidence now means: HIGH=verified match, MEDIUM=attribute unknown on vehicle, LOW=attribute mismatch
- confidenceReason field added to alerts
- Model conflict rejection: Cherokee≠Grand Cherokee, Caravan≠Grand Caravan, Transit≠Transit Connect
- isExcludedPart() applied to alert generation — no alerts for engines/transmissions/body panels
- SELECT expanded: +decoded_drivetrain, decoded_transmission, transmission_speeds, diesel, trim_tier, body_style

## 18:00 — Scout Alerts: is_core Yard Flag
- Added is_core boolean column to yard table (migration)
- Set true for 4 LKQ NC yards only: Raleigh, Durham, Greensboro, East NC
- Foss and Young's set to is_core=false (not actively scraped)
- FL LKQ yards (Tampa/Largo/Clearwater) correctly treated as road trip yards now
- FlywayService.getCoreYardIds() reads from DB instead of hardcoded array
- ScoutAlertService WHERE: yard.is_core = true OR yard on active trip

## 18:15 — Cache + Scour Stream Inline Edit
- PATCH /cache/:id — partial update on cache entries (partNumber re-normalized, partDescription, partType, make, model, year, notes)
- PATCH /restock-want-list/:id — partial update on want list entries (title, notes)
- PATCH /restock-want-list/by-title — update by title match + syncs scout_alert.source_title
- cache.html: tap PN or description to edit inline, "+ add PN" placeholder for empty fields, green flash on save
- restock-list.html: tap title or notes to edit inline on WANT LIST tab
- scout-alerts.html: STREAM alert titles tap-to-edit, saves to both want list and alert source_title

## 19:00 — Ford partNumberBase Fix + Stock Index Dedup
- FIXED: extractPartNumbers() Ford regex patterns now capture full 3-segment PNs (7L3A-12A650-GJH)
- FIXED: computeBase() uses normalizePartNumber() from partMatcher.js for canonical base (keeps Ford prefix)
- FIXED: normalizePartNumber FORD_SUFFIX regex handles 3-char suffixes (GJH, not just BD)
- FIXED: buildStockIndex() deduplicates per listing via Set — qty added once per unique PN
- Backfill: 9,490 rows updated across YourListing (1,835), YourSale (7,398), SoldItem (257)
- Result: Ford ECM 7L3A12A650 stock = 5 (was 241). Each Ford model now has distinct base PN.

## 19:30 — Stock match type flag (verify PN)
- buildStockIndex() now tracks full raw PNs per base key alongside count
- resolveStock() determines exact vs base match type per part lookup
- Parts with stockMatchType='base' show "X in stock ⚠ verify PN" in orange
- Exact matches show clean "X in stock" as before
- Chrysler/Toyota PNs = exact (unique per part). Ford base PNs may include suffix variants.

## 20:00 — Model matching bidirectional + compound normalize
- DIAGNOSED: "Explorer Sport Trac" → Auto table has "Explorer" only. "F-250 Super Duty" → Auto has "F-250" only.
- findMatchedParts fuzzy match was one-directional: vehicle regex tested against inventory, not vice versa
- Added COMPOUND_MODEL_MAP: maps compound models to base variants ("F-250 Super Duty" → ["F-250 Super Duty","F-250","F250"])
- Added getModelVariants(): returns ordered list of model names to try, plus dash/no-dash variants
- Bidirectional fuzzy in 3 places: findMatchedParts, sales index lookup, stock index lookup
- Protected pairs maintained: Grand Cherokee, Transit Connect, Grand Caravan never collapse

## 20:30 — Fix: Reject concatenated year ranges as part numbers
- extractPartNumbers() 8-digit regex was capturing "20012003", "20112014" etc. as PNs
- Added rejection: /^(19|20)\d{2}(19|20)\d{2}$/ after isSkipWord check
- Cleanup script: service/scripts/cleanup-year-range-pns.js — NULLs bad partNumberBase values
- Run on prod: node service/scripts/cleanup-year-range-pns.js

## 21:00 — Attack list trim/engine/trans mismatch filtering
- Added extractPartSpecifics(title) — detects performance trims (ST, SRT, Raptor, AMG, etc.), forced induction (EcoBoost, Turbo, TSI), transmission (MT/AT/DCT/CVT), diesel
- After VIN filter pass, compares specifics against vehicle.decoded_trim, vehicle.engine, vehicle.decoded_transmission, vehicle.diesel
- Mismatched parts flagged specMismatch=true, excluded from totalValue (same as belowFloor)
- Frontend: collapsed "X parts don't match this vehicle" section with orange mismatch reason text
- Example: 2014 Ford Focus SE 2.0L → ST Turbo parts now show "Part requires EcoBoost engine" or "Part is for ST trim" in mismatch section
- Careful regex: ST avoids false positive on STEERING/START/STOCK; GT only flags when paired with specific makes; MT only when near TRANS/CLUTCH/SHIFT

## 21:30 — Clean Pipe gaps: missing models, part types, dual-make titles
- MODEL_PATTERNS: Added Express, Savana, Econoline, Transit, Sprinter, Astro, Safari, Venture, Uplander, Montana, Terraza, Metris, ProMaster, NV200, Explorer Sport Trac, tonnage variants
- detectPartType(): Added ROLLOVER_SENSOR, YAW_SENSOR, OCCUPANT_SENSOR, SEAT_MODULE, DOOR_MODULE, WIPER_MODULE, BLEND_DOOR, TRAILER_MODULE, LANE_ASSIST, ADAPTIVE_CRUISE
- Backfill: 7,769 rows updated — YourListing 1,835 (409 models, 374 types, 1,431 PNs), YourSale 5,821, SoldItem 113
- Rollover sensor fixed: PN=25845266 (was 20082015), Type=ROLLOVER_SENSOR (was OTHER), Model=Express (was null)
- YourSale OTHER count dropped from ~7,600 candidates to 1,595 remaining

## 22:00 — VinDecodeService write gap + vin_cache transmission storage
- VinDecodeService.decodeAllUndecoded() now writes decoded_engine, decoded_drivetrain, decoded_transmission to yard_vehicle
- LocalVinDecoder: vin_cache INSERT now includes transmission_style from corgi transHint
- Migration: transmission_style + transmission_speeds columns added to vin_cache
- AttackListService.scoreVehicle() return now includes decoded_drivetrain (was missing — broke 4WD/AWD badges)
- Backfill script processes 3,243 vehicles missing decoded_transmission, fills from vin_cache or re-decodes
- Impact: 4WD/AWD badges will show on ~6,946 vehicles (was ~3,390 from scraper only)

## 21:00 — VinDecodeService Write Gap Fixed
- VinDecodeService now writes decoded_engine, decoded_drivetrain, decoded_transmission to yard_vehicle
- vin_cache schema: added transmission_style, transmission_speeds columns
- LocalVinDecoder stores transHint in vin_cache on write
- AttackListService scoreVehicle returns decoded_drivetrain to frontend
- Backfill on Railway: 885 drivetrains filled, 6,223 VINs re-decoded
- TRANSMISSION STILL BROKEN: corgi returns null transHint for ALL vehicles. 3,243 (28%) have no decoded_transmission. The 132 confirmed manuals + 156 CHECK_MT all came from old NHTSA API before Phase 9.

## OPEN — Transmission Detection in Local VIN Decoder
- corgi (@cardog/corgi) does not return transmission style or speeds
- The VDS engine_codes table has a transmission_hint column but it's empty for all entries
- Need to solve this inside the local decoder, not by falling back to NHTSA
- Options to investigate: seed transmission_hint in engine_codes from NHTSA Part 565 PDFs, EPA FuelEconomy.gov bulk data (has transmission type per engine config), or build a separate VDS transmission lookup table
- 3,243 vehicles need transmission data. 156 CHECK_MT could potentially be resolved.
- This is the #1 intelligence gap remaining in the VIN decoder.

## SESSION SUMMARY — 2026-04-05
Deploys this session (13 total):
1. Global part value colors + exclusion filter (dh-parts.js/css)
2. Price resolution fix (removed CONSERVATIVE_SELL_ESTIMATES, BASE tier yellow→orange)
3. Scout Alerts flyway trip filter
4. Scout Alerts confidence matching overhaul (part-type sensitivity)
5. Scout Alerts is_core yard flag (4 LKQ NC yards only)
6. Cache + Scour Stream inline edit (PATCH endpoints)
7. Ford partNumberBase fix (keeps vehicle prefix) + stock index dedup
8. Stock match type flag (verify PN warning)
9. Model matching bidirectional fuzzy + compound normalize
10. Clean Pipe gaps (20+ models, 11 part types, dual-make titles, 7,769 row backfill)
11. Attack list trim/engine/trans mismatch filtering
12. Year range PN cleanup
13. VinDecodeService write gap + decoded_drivetrain in attack list response

## 23:00 — Phase 10: EPA Transmission Resolver
- Migration: vin_decoder.epa_transmission table (36,035 rows) + vin_cache columns (trans_sub_type, trans_source)
- Import script: service/scripts/import-epa-transmission.js — reads CSV, bulk inserts
- resolveTransmission() in LocalVinDecoder.js — 3-tier resolution:
  - TIER 1 (epa_definitive): Only one trans type in EPA for year+make+model → use it
  - TIER 2 (epa_check_mt): Both offered + model on 22-entry CHECK_MT_MODELS list → CHECK_MT
  - TIER 3 (epa_default_auto): Both offered + not on CHECK_MT list → Automatic
  - Performance trim override: ST/Si/Type R/SRT/SS/RS/Nismo/TRD/Sport/GT → CHECK_MT
- Wired into decode() pipeline as step 4.5 (after engine codes, before vin_cache write)
- vin_cache INSERT now stores transmission_style, transmission_speeds, trans_sub_type, trans_source
- Cached path returns transHint, transSpeeds, transSubType, transSource
- decodeBatchLocal() passes through transSpeeds
- epaModelMatches() handles: GM tonnage codes (K15→1500), dash stripping, Ram brand split, suffix stripping (Classic/Limited/Eco)
- Backfill script: service/scripts/backfill-epa-transmission.js — deletes vin_cache with null trans, re-decodes yard_vehicles
- CLAUDE_RULES.md rule 27 updated with full CHECK_MT model list + performance trim override
- Run order: (1) deploy, (2) import EPA CSV, (3) run backfill

## 23:30 — vPIC Database Restore + Trim Fallback (Phase 10b)
- Restored NHTSA vPIC standalone PostgreSQL database to vpic schema (1.6M Pattern rows, spvindecode stored procedure)
- Added vpicTrimFallback() to LocalVinDecoder — step 3.5 in decode pipeline (after VDS, before EPA)
- Fills trim for all makes that VDS does not cover (Nissan, Toyota, Lexus, BMW, Mercedes, Hyundai/Kia, etc.)
- EPA step 4.5 updated: also runs when transHint came from vPIC so CHECK_MT logic still wins
- Backfill: 2,152 vehicles got trim, 10 got transmission (0 errors)
- Top resolved: Chevrolet 435, Toyota 322, Nissan 299, Dodge 153, BMW 126, Hyundai 124, GMC 120, Ford 107
- Before: Nissan 1.1%, BMW 10.6%, Toyota 29.8%. After: Nissan 30.8%, BMW 81.5%, Toyota 75.8%, Chevrolet 95.9%, GMC 100%
- vPIC SQL file in .gitignore (not committed). DB size: ~1.4GB after restore.
- restore-vpic.js: streaming SQL loader with COPY FROM stdin + dollar-quoting support

## 01:00 — Airbag Exclusion + Vehicle Attribute Boosts + Pro-Rebuild ECM Visibility
- Airbags/SRS excluded from attack list + scout alerts (clock springs still sellable)
- Scoring audit: vehicles sort by max_part_value DESC then est_value DESC. Parts sort by sold_90d DESC.
- No existing attribute boosts found — fresh implementation
- Vehicle attribute boosts: PERFORMANCE +20%, DIESEL +15%, 4WD+MT +12%, PREMIUM +10%, MANUAL +8%, 4WD +5%
- Applied as multiplier on score after stock/fresh/COGS. attributeBoost + boostReasons passed to frontend.
- Frontend: cyan "↑XX%" below score badge
- ECM visibility confirmed: isExcludedPart() does NOT catch ECM/ECU/PCM titles (engine exclusion requires ASSEMBLY/BLOCK/COMPLETE — not CONTROL/MODULE)
- Pro-rebuild ECM fix: 1,298 pro-rebuild ECM items now bypass rebuild grouping, display as normal scored parts with full pricing
- AIRBAG removed from PART_PRICE_FLOORS
- CLAUDE_RULES rules 19+20 updated
- Files: AttackListService.js, dh-parts.js, attack-list.html, CLAUDE_RULES.md

## 02:00 — Revenue-Optimized Scoring: Rarity + Novelty + Sort Overhaul
- Vehicle rarity index: active yard_vehicle count per make+model, 5 tiers (RARE +25% through SATURATED -10%)
- Distribution: 698 distinct combos, median 3 appearances. Top: Altima 311, F-150 308, Camry 242
- Part novelty: NOVEL (zero stock+sales) +20%, RESTOCK (sold before, zero stock) +10%, STOCKED no boost (scoring value only, not display price)
- Sort overhaul: vehicles by est_value DESC (was max_part_value DESC), parts by price DESC (was sold_90d DESC)
- Frontend: red RARE badge, yellow UNCOMMON badge on vehicles. Cyan NEW badge, green RESTOCK badge on parts.
- CLAUDE_RULES rules 21b, 21c, 21d added
- Files: AttackListService.js, attack-list.html, CLAUDE_RULES.md

## 03:00 — Revenue-Optimized Scoring: Persistent Rarity + Sort Overhaul
- vehicle_frequency table: persistent make+model rarity tracking, avg_days_between metric
- Backfill from all yard_vehicle history: 1,057 rows (315 LEGENDARY single-sighting)
- 6-tier rarity: LEGENDARY gold pulse +30%, RARE purple pulse +20%, UNCOMMON blue +10%, NORMAL green 0%, COMMON orange -5%, SATURATED red -15%
- Replaced ephemeral active-count rarityMap with persistent vehicle_frequency lookup
- Daily cron at 6:30 AM UTC updates from new arrivals via UPSERT
- Frontend: rarity badges with tier colors + pulsing for LEGENDARY/RARE, tooltip shows avg days + total seen
- CLAUDE_RULES rule 21b updated with persistent rarity system
- Files: migration, backfill script, AttackListService.js, attack-list.html, index.js, CLAUDE_RULES.md

## 04:00 — Backend: Rarity Thresholds + Score Uncap + Vehicle Limit Removed
- Rarity thresholds corrected to long-term values: LEGENDARY 180+d, RARE 90+d, UNCOMMON 45+d, NORMAL 15+d, COMMON 7+d, SATURATED <7d
- Most vehicles show LEGENDARY with 19d of data — correct, will self-calibrate as daily scrapes accumulate
- Score uncapped: Math.min(100, score) removed. Boosted vehicles can score 127, 145, etc.
- Vehicle limits removed: getAttackList .limit(200) gone, getAllYardsAttackList .limit(500) gone
- Frontend VEHICLE_CAPS raised: all=5000 (was 500), other filters proportionally raised
- Part noveltyBoost field exposed in response (20/10/0) alongside existing noveltyTier
- ALL filter already correct (pillDays=999, groups by age, no date restriction)
- Files: AttackListService.js, attack-list.html, CLAUDE_RULES.md

## 05:00 — Frontend: Vehicle Card 4-Line Layout Restructure
- Collapsed vehicle cards restructured into 4 clear lines:
  Line 1: Score badge (color-coded, gold pulse 120+) + YMM + engine + rarity badge (right-aligned)
  Line 2: Attribute badges (TRIM/DIESEL/4WD/MANUAL/CULT) — collapses when none apply
  Line 3: Location + freshness (Row · Color · Xd ago + NEW badge)
  Line 4: Part type chips colored by price tier with novelty dots (cyan=NOVEL, green=RESTOCK)
- Score color tiers: 120+ gold, 100+ bright green, 80+ green, 60+ yellow, 40+ orange, <40 red
- Rarity badge right-aligned on Line 1 with detail text below (~52d · 7 seen)
- Part chips: 6 max (was 4), noveltyTier passed in slim part_chips response
- Expanded view unchanged — parts load on demand, pull buttons work, cache sync works
- Files: attack-list.html, attack-list.js (route)

## 06:00 — Generation-Aware Rarity + Trim-Driven Badge Overrides
- vehicle_frequency now generation-aware: gen_start/gen_end columns from trim_tier_reference
- Backfill: 895 generation-aware rows (from 4,641 year combos). Camry split into 2012-2017 + 2018-2024.
- Frequency lookup: tries generation-specific key first, falls back to make|model
- Trim-driven rarity FLOOR overrides (raise only, never lower):
  PERFORMANCE trim → LEGENDARY floor (+30%)
  PREMIUM trim → RARE floor (+20%)
  4WD+MANUAL → RARE floor (+20%)
  DIESEL → RARE floor (+20%)
- rarityReason field: shows "PERFORMANCE trim" or "~52d avg" or "1 sighting"
- Daily cron updated: generation-aware grouping for new arrivals
- Frontend: rarity badge detail text shows rarityReason
- CLAUDE_RULES rule 21b updated with generation + override logic
- Files: migration, backfill script, AttackListService.js, index.js, attack-list.html, CLAUDE_RULES.md

## Fix: vehicle_frequency epoch zero corruption — 2026-04-06
- ROOT CAUSE: backfill-vehicle-frequency-gen.js used MIN(first_seen) from yard_vehicle, but 174 rows had first_seen=1970-01-01 (epoch zero from old LKQ scraper)
- This inflated avg_days_between (Titan: 428d, Explorer: 761d) causing false LEGENDARY ratings for common vehicles
- FIX 1: Backfill query now uses CASE to pick earliest valid date (first_seen or createdAt, but only if > 2020-01-01)
- FIX 2: Daily cron (6:30 AM) guards against epoch zero in avg_days recalculation
- FIX 3: AttackListService min-data guard — tracks days of observation window:
  - <30 days of data: cap at UNCOMMON (no RARE/LEGENDARY claims)
  - 30-60 days: cap at RARE
  - 60+ days: full tiers unlocked
  - Single-sighting vehicles (totalSeen=1) still get LEGENDARY regardless (genuinely rare)
- Re-backfilled: 895 rows, 0 epoch zero dates. Titan now SATURATED (avg 0.37d), Explorer SATURATED (avg 0.61d)
- Distribution: 61% SATURATED, 35% single-sighting (will be capped to UNCOMMON by min-data guard), 2% COMMON, 1% NORMAL

## 08:00 — Scour Stream Overhaul: Watchlist Removed, Want List Upgraded, Overstock Scanners
- Watchlist tab removed entirely from frontend (backend routes left for compat)
- Want list add form: Part Number + Description + Make + Model + Notes fields
- POST /add accepts structured fields, builds title for backward compat, stores part_number/make/model columns
- Migration: part_number, make, model columns added to restock_want_list
- Want list is now default tab on page load
- Overstock scan-duplicates: groups active YourListing by partNumberBase+make+model, shows count > 1
- Overstock scan-high-qty: active listings with qty > 1 listed in last 30 days
- Frontend: scan buttons + clear results, collapsible duplicate cards
- Files: restock-list.html, restock-want-list.js (route), migration

## QUARRY Overhaul — Remove Cap, Fix Urgency, Timeframe Sorting, Pagination — 2026-04-06
- Removed items.slice(0, 200) hard cap — all qualifying items returned
- Added pagination: page/pageSize query params (default page=1, pageSize=100), frontend Prev/Next controls
- High-value zero-stock upgrade to CRITICAL: avgPrice >= $200 + sold >= 1, or totalRevenue >= $500
- Timeframe-aware sort: 7d = velocity, 30d = revenue, 60d/90d = ratio
- Summary counts now reflect ALL items, not just current page
- Frontend labels confirmed correct: CRITICAL=RESTOCK NOW, LOW=STRONG BUY, WATCH=CONSIDER
- quarrySync() also uses updated getUrgency with totalRevenue param

## 09:00 — Fix Overstock Stock Counting + Overstock→Want List Auto-Transition
- countStockedForEntry() rewritten: uses partNumberBase column (not title ILIKE), scoped by make/model
  Before: 4Runner BCM=13 (caught all 4Runner listings via model name as PN), Ranger Fuse Box=21 (bare 14B476 cross-model)
  After: 4Runner BCM=0 (correct), Ranger Fuse Box=only Ranger matches
- Requires 8+ char PNs to avoid model names (4RUNNER, TRANSIT) being treated as part numbers
- Uses entry stored part_number/make/model from Scour Stream upgrade
- OverstockCheckService auto-transition: when stock drops from >0 to 0, auto-creates want list entry
  Scout Alerts picks up new want list entries on next refresh
  Lifecycle: OVERSTOCK → stock=0 → WANT LIST (auto) → SCOUT ALERTS → CACHE → eBay
- Files: restock-want-list.js, OverstockCheckService.js

## Intel Sources Wired into Attack List — 2026-04-06
- Enhanced intel index: quarryPNs (auto_generated want list), streamPNs (manual want list), overstockPNs (from overstock_group_item), markPNs (existing), flagPNs (existing)
- Uses part_number column from restock_want_list when available (more reliable than title extraction)
- Per-source vehicle score boosts (multiplicative, stacking): MARK +15%, QUARRY +10%, STREAM +5%
- Overstock parts tagged with overstockWarning=true, sorted to end of chip list
- intel_match_count added to vehicle response
- Frontend chips: ★ gold star for MARK, ★ green star for QUARRY, ★ blue star for STREAM, ✕ red for OVERSTOCK
- Expanded view badges: gold ★ MARK, green ★ RESTOCK, blue ★ WANT, red ✕ OVER, green SOLD, orange ⚡ FLAG
- ★N indicator on collapsed card shows intel-backed part count
- chip-gold CSS class added

## 10:00 — Flyway Intel Integration: Day Trip = Full Feed, Road Trip = Elite Only
- getFlywayAttackList() now builds full intel index (MARK/QUARRY/STREAM/OVERSTOCK) + frequencyMap
- scoreVehicle() receives all indexes — vehicles get rarity tiers, intel chips, attribute boosts
- Road trip filter: only LEGENDARY + RARE + MARK vehicles pass (COMMON/SATURATED filtered out)
- Day trip: no filter, identical to Daily Feed
- Part chips: 6 max (was 4), includes noveltyTier + intelSource, filters belowFloor
- Files: FlywayService.js

## 11:00 — Flyway Card Layout Match
- renderVehicleCard() rewritten to match attack-list 4-line layout
- Score badge: inline color + pulse at 120+
- Rarity: only UNCOMMON/RARE/LEGENDARY shown, inline after engine
- Price right-aligned on Line 1
- Attribute badges on Line 2 (trim/4WD/manual/diesel/cult)
- Green NEW badge, novelty dots on part chips
- Files: flyway.html

## Open items carried forward
- The Mark table empty (Hunters Perch → Mark link broken, no marks flowing)
- instrumentclusterstore scraper: 0 items, needs debug-scrape
- Scout Alerts role shift: now office monitoring dashboard, not puller-facing
- Nissan trim coverage still low (30.8%) — vPIC doesn't return Trim for many Nissan models
- market_demand_cache needs more coverage — market drip filling ~600/day

## 12:00 — Mark + Hidden System Repair
- Mark flow confirmed working: POST /competitors/mark correctly inserts into the_mark (table was empty because unused, not broken)
- Created hidden_parts table (global blacklist): part_number_base + make + model + source
- /hidden routes: POST /add, DELETE /:id, GET /list, GET /keys
- Hidden filtering wired into gap-intel + emerging backends (competitors.js)
- Hunters Perch: dismiss buttons → hideIntel() with red fade (sends to /hidden/add)
- The Mark: HIDE button added (moves mark → hidden_parts, deletes from the_mark)
- Hidden parts management section on The Mark page (collapsible, unhide button)
- AttackListService: loads hidden_parts, removes hidden PNs from all intel sets
- Files: migration, hidden.js (route), competitors.js, index.js, AttackListService.js, hunters-perch.html, the-mark.html

## 13:00 — Fix Hunters Perch Mark + Hide Buttons
- Root cause: JSON.stringify(item.sellers) embedded ["seller1","seller2"] with unescaped double quotes inside onclick="..." attributes
- HTML parser corrupted by unescaped quotes — both Mark AND Hide buttons non-functional on every card
- Fix: data-attribute lookup pattern (window._intelData stores item data, buttons reference by index key)
- markByIdx()/hideByIdx() wrappers call existing markItem()/hideIntel()
- Mark button: gold ★. Hide button: red ✕ with dim border.
- Files: hunters-perch.html

## Market Drip Priority Queue Restructure — 2026-04-06
- isExcludedPart() filter: engines/transmissions/body panels/airbags removed from queue
- $100 price floor: sub-$100 parts skipped (was 36% of cache = wasted cycles)
- 10-tier priority queue: $500+ PN → $500+ KW → $350+ PN → ... → $100+ KW
- Within each tier: never-checked first, then oldest cache first
- Keyword search path for no-PN parts: smart-query-builder + relevance-scorer (min 3 relevant results)
- Keyword cache: key_type='keyword', cache_key = partType|make|model|years
- CLAUDE_RULES.md rule 29 updated to reflect keyword search path

## 14:00 — Fix Hunters Perch Mark Persistence (Items Reappearing)
- Mark WAS persisting (7 active marks in the_mark) — but items reappeared on reload
- Root cause: gap-intel groups by partNumberBase ("56040348") but marks stored normalizedTitle ("REBUILT PROGRAMMED 94 LEXUS ES300")
- Filter compared PN key against title — never matched, so marked items passed through
- Fix: load markedPNs Set from the_mark.partNumber, filter checks both markedTitles.has(key) AND markedPNs.has(partNumberBase)
- Also fixed emerging section: had NO mark filter at all — added markedTitles + markedPNs
- Files: competitors.js

## 15:00 — Fix Hunters Perch Hide Button + Add HIDDEN Tab
- hideByIdx() rewritten: uses structured partNumber from _intelData (was extracting PN from title with unreliable regex)
- Error logging + button text revert on failure
- Removed old hideIntel() function
- Added two-tab system: INTEL (default) / HIDDEN (with count badge)
- HIDDEN tab: lazy loads GET /hidden/list, shows PN + partType + source, Unhide button per item
- Hidden count badge loaded on page init
- Backend filtering confirmed working: loadHiddenSet() + isHidden() in gap-intel + emerging
- Files: hunters-perch.html
