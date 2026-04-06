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
