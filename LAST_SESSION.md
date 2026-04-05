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
