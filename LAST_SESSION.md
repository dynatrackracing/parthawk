# LAST SESSION — 2026-04-08

## Newest pill renders zero cards diagnosis — 2026-04-08
- NOT A BUG — expected behavior when no new vehicles arrived today
- Scraper ran at 2:00 AM ET (06:00 UTC) on April 8, found 0 new vehicles across all 4 core yards (all dupes of existing inventory)
- Latest createdAt in Raleigh is 2026-04-07T13:10:23 — yesterday
- getDaysFromNewest() correctly computes: today (April 8) - createdAt (April 7) = 1 day
- Newest pill filters for getDaysFromNewest(v) === 0 (line 577/585) — no vehicle has createdAt from today → 0 results
- The 3d pill DOES show these vehicles (1 day old ≤ 3) — not a code regression, just no fresh inventory
- Header shows "1093 vehicles · 380 flagged" because that counts ALL active Raleigh vehicles regardless of pill
- createdAt IS sent to frontend (AttackListService.js line 1623) — no missing field issue
- VAG PN fix did NOT cause this — the fix only touches stripRevisionSuffix/normalizePartNumber, not date handling

## Hybrid/PHEV/EV detection + badges — 2026-04-08
- LocalVinDecoder: new classifyPowertrain() with layered detection (fuelType → model name → trim), returns {isHybrid, isPHEV, isElectric}
- parseEngineType() now returns 'Plug-in Hybrid' distinct from 'Hybrid' and 'Electric'
- Mild 48V hybrids (eTorque, EQ Boost) classified as Gas — parts share with gas variants
- vin_cache: added is_hybrid/is_phev/is_electric/fuel_type columns (migration 20260408000001)
- AttackListService.scoreVehicle(): ELECTRIC +25%, PHEV +20%, HYBRID +15% boosts (stacks multiplicatively with other attributes)
- attack-list.html: EV badge (electric blue border), PHEV (bright cyan border), HYBRID (cyan border)
- Badge render order reworked to strict priority sort: ELECTRIC→PHEV→PERFORMANCE→HYBRID→DIESEL→4WD+MT→PREMIUM→MANUAL→4WD→CHECK_MT→CVT→TRIM
- 11 test cases passing (Prius=HYBRID, RAV4 Prime=PHEV, Tesla=EV, C-MAX=HYBRID, Volt=PHEV, eTorque=Gas)
- Files: LocalVinDecoder.js, AttackListService.js, attack-list.html, migration, backfill-hybrid-flags.js (new)

## Hybrid/EV detection audit — 2026-04-08
- parseEngineType() in LocalVinDecoder returns Gas/Diesel/Hybrid/Electric/Flex Fuel but does NOT distinguish PHEV from Hybrid
- vin_cache schema has NO fuel_type, engine_type, is_hybrid, is_phev, is_electric columns — fuelType is computed in memory, never persisted
- yard_vehicle.engine_type distribution: Gas=8837, null=921, Diesel=52, Electric=9, Hybrid=0
- ZERO vehicles tagged as Hybrid despite 11 Prius in active inventory — all show engine_type='Gas'. Root cause: scrape-local.js decode path (NHTSA API) doesn't call LocalVinDecoder's parseEngineType, and the old NHTSA decode logic doesn't parse hybrid correctly
- The 9 Electric vehicles (Tesla, Leaf, Volt, C-MAX) ARE tagged because NHTSA fuel type string is "electric" (not "hybrid electric")
- Chevy Volt tagged as Electric (correct — series hybrid is essentially EV)
- Ford C-MAX tagged as Electric (WRONG — C-MAX Hybrid is a parallel hybrid, not EV; C-MAX Energi would be PHEV)
- AttackListService.scoreVehicle() has NO hybrid/electric attribute boosts. Only diesel (+15%), performance (+20%), premium (+10%), 4WD, manual
- Badge renderer (attack-list.html:701-718) has no hybrid/EV badges. Badges are unsorted — rendered in code order (trimBadge, CULT, DIESEL, 4WD/AWD, MANUAL/CHECK_MT/CVT)
- Detection needs to be added to vin_cache schema, LocalVinDecoder, and AttackListService scoring + frontend badges

## Permanent fix: date_added doctrine — 2026-04-08
- Doctrine: date_added (LKQ set date) is canonical for all display, filter, sort, score, rarity. createdAt is forensic-only.
- New module: service/utils/dateHelpers.js — getSetDateET(), daysSinceSetET(), setDateLabel(), withinSetWindowET(), hoursSinceLastScrape(). All math runs in America/New_York.
- Fixed DATE type TZ trap: date_added is a Postgres DATE (no TZ), parsed as-is without UTC→ET drift.
- Pill windows are LKQ-set-date relative ("Newest" = set today ET, not "scraped today").
- Server ships daysSinceSet + setDateLabel per vehicle — frontend never parses dates.
- Stale-scrape banner: yellow ⚠ when yard's MAX(createdAt) > 18h ago. Flags: Bessler's 227h, Bluegrass 228h, Raceway 226h, Huntsville never.
- AttackListService.scoreVehicle() fresh-arrival boost uses daysSinceSetET.
- FlywayService.calculateDaysInYard() replaced with daysSinceSetET.
- Frontend: getDaysFromNewest()/getNewestDate()/parseLocalDate() deleted → getDaysSinceSet() reads server field.
- Backfill: 1791 rows with NULL date_added filled from createdAt::date (Bessler's 745, Raceway 430, Bluegrass 350, Bessler's Louisville 266).
- Files: dateHelpers.js (new), AttackListService.js, FlywayService.js, attack-list.html, backfill-date-added-from-createdat.js (new)

## Scraper date architecture audit — 2026-04-08

### 1. Scraper Inventory

| Scraper | File | date_added source | first_seen | last_seen | INSERT or UPSERT |
|---|---|---|---|---|---|
| scrape-local.js (LKQ core) | repo root | `<time datetime>` from LKQ HTML | SET (now) | SET (now) | INSERT only (dupes filtered during scrape) |
| LKQScraper.js | service/scrapers/ | `<time datetime>` from LKQ HTML | SET (now) | SET (now) | UPSERT (match by YMM) |
| PullAPartScraper.js | service/scrapers/ | API `dateYardOn` (date portion) | SET (now) | SET (now) | UPSERT |
| CarolinaPickNPullScraper.js | service/scrapers/ | MM/DD/YYYY HTML table | NOT SET | NOT SET | UPSERT |
| FossScraper.js | service/scrapers/ | NULL (not in HTML) | NOT SET | NOT SET | UPSERT |
| PickAPartVAScraper.js | service/scrapers/ | HTML table "date"/"arrival" col or NULL | NOT SET | NOT SET | UPSERT |
| UPullAndSaveScraper.js | service/scrapers/ | NULL (API missing) | NOT SET | NOT SET | UPSERT |
| ChesterfieldScraper.js | service/scrapers/ | NOT SET (field omitted) | NOT SET | NOT SET | UPSERT |

**Key finding:** Only LKQ and PullAPart scrapers set first_seen/last_seen. 5 of 7 scrapers leave first_seen/last_seen null.

### 2. Date Column Inventory (yard_vehicle)

| Column | Type | Who writes | Who reads |
|---|---|---|---|
| date_added | date | LKQ scrapers (from HTML), PullAPart (from API) | Display label "set Xd ago" (attack-list.html:761), scoring fresh-arrival boost (AttackListService:1467), FlywayService daysInYard (line 203) |
| first_seen | timestamptz | scrape-local.js, LKQScraper, PullAPart (all set to now on INSERT) | Not read anywhere in scoring/display. Only exists for forensics. |
| last_seen | timestamptz | All scrapers (on UPDATE), retention filter (AttackListService:1868) | Retention cutoff (7d, line 1854), lazy-load time range filter (line 1874) |
| createdAt | timestamptz (DEFAULT now) | Auto-set on INSERT by Knex/Postgres | Filter/age calc in attack-list.html (lines 383, 391 — getDaysFromNewest), scoring not used |
| updatedAt | timestamptz | All scrapers on INSERT and UPDATE | Not read in scoring/display |
| scraped_at | timestamptz (DEFAULT now) | All scrapers | Not read in scoring/display |
| vin_decoded_at | timestamptz | VIN decode process | Not read in scoring/display |

### 3. Consumer Table

| File:Line | Field | Classification | What it does |
|---|---|---|---|
| attack-list.html:383 | createdAt \|\| date_added | FILTER | getNewestDate() — finds most recent vehicle for age tier reference |
| attack-list.html:391 | createdAt \|\| date_added | FILTER | getDaysFromNewest() — days since vehicle first appeared (powers pill filter) |
| attack-list.html:577 | getDaysFromNewest(v) === 0 | FILTER | Newest pill — only vehicles created TODAY |
| attack-list.html:585 | getDaysFromNewest(v) <= pillDays | FILTER | 3d/7d/30d/60d pills — strict window |
| attack-list.html:761 | date_added \|\| createdAt | DISPLAY | "set Xd ago" label on vehicle card line 3 |
| attack-list.html:757 | getDaysFromNewest(v) === 0 | DISPLAY | NEW badge (green) |
| AttackListService.js:1467 | date_added \|\| createdAt | SCORING | Fresh arrival boost: ≤3d +10%, ≤7d +5%, ≤14d +2% |
| AttackListService.js:443 | date_added | FILTER | ORDER BY date_added DESC (single-yard query) |
| AttackListService.js:1861 | date_added | FILTER | ORDER BY date_added DESC (all-yards query) |
| AttackListService.js:1868 | last_seen | FILTER | 7-day retention cutoff |
| AttackListService.js:1874 | last_seen | FILTER | Lazy-load time range |
| FlywayService.js:203 | date_added | SCORING | calculateDaysInYard() for Flyway feed |
| FlywayService.js:129,237 | date_added | FILTER | ORDER BY date_added DESC, sort tiebreaker |
| ScoutAlertService.js (via generateAlerts) | date_added | DISPLAY | vehicle_set_date in scout_alert row |

### 4. Timezone Findings

- **Postgres:** `Etc/UTC`. `NOW()` = `2026-04-08T12:34:51Z`, `CURRENT_DATE` = `2026-04-08` (UTC)
- **LKQ scraper (scrape-local.js):** Extracts `<time datetime="...">` which is typically ISO date like `2026-04-07`. Converted via `new Date(v.dateAdded)` — JavaScript parses date-only strings as UTC midnight, so `date_added = 2026-04-07T00:00:00Z` → stored as `2026-04-07` (DATE type, no time component).
- **Browser:** `getDaysFromNewest()` uses `new Date()` which is local timezone. `parseLocalDate()` (line 371-377) handles date-only strings by constructing local-timezone Date objects: `new Date(year, month-1, day)`. Timestamps (with T/Z) parsed via `new Date(isoString)` which honors the timezone.
- **Mismatch found:** `createdAt` is a TIMESTAMPTZ in UTC (e.g., `2026-04-07T13:10:23Z`). When parsed in browser via `new Date("2026-04-07T13:10:23Z")`, it becomes `2026-04-07T09:10:23-0400` in ET. `date_added` is a DATE (`2026-04-07`) parsed via `parseLocalDate()` as `2026-04-07 00:00 local`. These can differ by up to 1 day depending on timezone.

### 5. Divergence Report (Raleigh, last 14 days)

| LKQ set date | Vehicles | First scraped | Last scraped |
|---|---|---|---|
| 2026-04-08 | 1 | 2026-04-08 12:30 | 2026-04-08 12:30 |
| 2026-04-07 | 62 | 2026-04-07 13:10 | 2026-04-07 13:10 |
| 2026-04-03 | 34 | 2026-04-03 18:49 | 2026-04-03 18:49 |
| 2026-04-02 | 30 | 2026-04-03 18:49 | 2026-04-03 18:49 |
| 2026-04-01 | 30 | 2026-04-01 13:31 | 2026-04-01 13:31 |
| 2026-03-31 | 38 | 2026-04-01 02:50 | 2026-04-01 02:50 |
| 2026-03-30 | 39 | 2026-03-31 06:00 | 2026-03-31 06:00 |

**Pattern:** date_added (LKQ set date) typically leads createdAt (when we scraped) by ~12-24 hours. LKQ sets vehicles overnight; our scraper picks them up the next day. This 1-day lag is why Newest (createdAt-based) shows fewer results than date_added would — a vehicle "set today" by LKQ is "scraped tomorrow" by us.

### 6. Date Priority Conflict

**The frontend and backend use OPPOSITE date priority:**
- **Frontend filter** (getDaysFromNewest): `v.createdAt || v.date_added` — createdAt FIRST (from commit 27ba6d2)
- **Frontend display** (timeAgo label): `v.date_added || v.createdAt` — date_added FIRST (for puller-facing "set Xd ago")
- **Backend scoring** (fresh arrival boost): `vehicle.date_added || vehicle.createdAt` — date_added FIRST
- **Backend sort**: `ORDER BY date_added DESC`

This means:
- A vehicle set by LKQ on April 7, scraped by us on April 8 at noon:
  - **Filter says:** 0 days old (createdAt = today) → shows under Newest ✓
  - **Display says:** "set 1d ago" (date_added = April 7)
  - **Score says:** 1 day old (date_added = April 7) → gets +5% boost instead of +10%

The filter/display split is intentional. The scoring discrepancy (using date_added not createdAt) may cause slightly lower fresh-arrival boosts for vehicles we scraped late.

### 7. History

| Commit | Date | Change |
|---|---|---|
| a2dda78 | ~Apr 4 | Daily Feed: data-driven Newest filter, relative age tiers |
| 6dacc58 | ~Apr 4 | attack list date grouping uses createdAt instead of date_added |
| c4230b0 | Apr 7 | Fix: age relative to today, not relative to newest vehicle |
| 88a3461 | Apr 7 | Fix: strict pill window, drop rest fallback |
| 27ba6d2 | Apr 7 | Fix: use createdAt for getDaysFromNewest, display still uses date_added |

### 8. Open Questions

1. **Should scoring use createdAt too?** Currently scoring fresh-arrival boost (AttackListService:1467) uses `date_added || createdAt`. If we want consistency with the filter, it should be `createdAt || date_added`. But date_added may be more "correct" for how long the part has been available to pull.
2. **5 of 7 non-LKQ scrapers don't set first_seen/last_seen.** This means retention cutoff (7d last_seen filter) may not work correctly for those yards — vehicles that were never confirmed as "still there" would have null last_seen.
3. **FlywayService uses date_added exclusively** for daysInYard and sorting. If a Flyway yard has null date_added (Foss, Chesterfield, UPullAndSave), `calculateDaysInYard()` returns 0 and sort falls through.
4. **Timezone edge case:** A vehicle set by LKQ at 11 PM ET on April 7 (UTC April 8 03:00) would have `date_added = 2026-04-07` (DATE type, no time). If scraped at 2 AM ET on April 8, `createdAt = 2026-04-08T06:00Z`. The browser in ET would see createdAt as April 8 local → Newest shows it. But if user is in PT, createdAt in PT is April 7 23:00 → Newest does NOT show it. This timezone sensitivity is inherent in the `new Date()` comparison.

## VAG PN collision diagnosis — 2026-04-08
- BUG: Attack list shows "28 in stock" for VW Passat ABS 1K0 614 517 DT. We don't have 28 — we have ~17 DIFFERENT VW ABS pumps with distinct suffix codes (DT, EB, BD, AE, DJ, CT, CD, BJ, EJ, DL, ED, DB, BG) all collapsed to base `1K0614517`.
- ROOT CAUSE CONFIRMED: `stripRevisionSuffix()` in partIntelligence.js line 87-90 catches VAG PNs via the generic catch-all: `if (pn.length >= 10 && /[A-Z]{1,2}$/.test(pn))` → strips trailing 1-2 alpha. This treats VW/Audi suffix codes (DT, EB, AE — which identify hydraulic/programming variants) as revision suffixes (like Chrysler AA/AB).
- The comment on line 86 even says "Also catches: 5C6035456A (VW) where last A is a revision" — but VW suffixes are NOT revisions, they're variant identifiers.
- `normalizePartNumber()` in partMatcher.js does NOT strip VW suffixes when they have dashes (1K0-614-517-DT → kept as-is). But Clean Pipe stores dashless `1K0614517DT`, which hits `stripRevisionSuffix()` → `1K0614517`.
- Production data: 17 active listings, 41 YourSale records, 3 SoldItem records all collapsed to `partNumberBase = '1K0614517'`.
- Q4 scope: 19 distinct VAG base PNs with multiple distinct titles — this is a catalog-wide issue, not just the one ABS pump.
- Files involved: partIntelligence.js (stripRevisionSuffix, computeBase), partMatcher.js (normalizePartNumber, GENERIC_SUFFIX), AttackListService.js (buildStockIndex uses both).
- FIX APPLIED: VAG pattern guard `^[0-9][A-Z][0-9]\d{6}[A-Z]{0,3}$` added to top of stripRevisionSuffix() and normalizePartNumber(). Returns input unchanged for VAG PNs.
- Backfill: 453 rows updated (124 YourListing, 322 YourSale, 7 SoldItem). 1K0614517 now splits into 11 distinct variant bases.
- Ford/Chrysler regression clean — assertions passed.

## Tech debt noted: TradingAPI write methods are dead code — 2026-04-08
- TradingAPI.js still contains reviseItem, endItem, relistItem method definitions with no callers anywhere in the codebase (verified via grep in previous session same day).
- Current state is safe: no triggers, no exposed routes, no crons. But the methods sitting in the file is a rediscovery risk — a future session could accidentally rewire them into a new feature thinking they are still wired.
- Low-priority cleanup options (pick one when ready):
  (a) Delete the method bodies outright
  (b) Wrap each in: throw new Error('eBay writes permanently disabled — see CLAUDE_RULES rule 42')
  Option (b) is preferred because it fails loud at line 1 of any accidental call instead of silently erroring downstream.
- StaleInventoryService.js has the same issue — inline ReviseItem call lives in the file but no cron or route triggers it anymore. Same cleanup options apply.
- Not today's work. Filed for future session.

## Disable eBay writes + read-only Carcass — 2026-04-08
- Removed 5 POST routes (run/revise/end/relist/bulk-end) → 410 Gone stubs
- Stripped action buttons (revise -10%/-20%, End, Relist, bulk end, Run Auto, checkboxes) from stale-inventory.html
- Disabled StaleInventoryService Wed 3am cron in index.js (commented out)
- Added read-only banner on Carcass page: "⚠ Read-only view. Inventory management happens outside this tool."
- Added CLAUDE_RULES rule 42 (eBay write policy)
- Grep classification: stale-inventory.js routes (a-modified), StaleInventoryService.js methods (b-internal, no callers), TradingAPI.js definitions (c-flagged, no callers)
- Unexpected callers found: NONE

## Session discipline regen — 2026-04-08
- Regenerated SNAPSHOT_LIBS.md, SNAPSHOT_SERVICES.md, SNAPSHOT_FRONTEND.md, SNAPSHOT_ROUTES.md, SNAPSHOT_SCRAPERS.md
- Updated CLAUDE_RULES.md with rules 38 (date doctrine), 39 (hybrid/EV boosts), 40 (VAG PN guard), 41 (short model-name match)
- Session deploys covered: 51f7004 (VAG PN), 98aeb15 (date doctrine), 2ee3b54 (hybrid/EV), e5b7ae4 (BMW false positive)
- Open followups:
  * Bessler/Bluegrass/Raceway scrapers don't capture LKQ-equivalent set dates — future rows drift until fixed
  * Generation-aware vehicle rarity (vehicle_frequency conflates gen boundaries — trim CSV needed)

# LAST SESSION — 2026-04-07

## Quarry display fixes — per-tier cap + FOUND from Cache — 2026-04-07
- BUG 1 FIX: Replaced global pageSize=100 pagination with per-tier 100-row cap. Each tier (RESTOCK NOW, STRONG BUY, CONSIDER) now independently sorted and capped. Summary tiles unchanged (still show full counts).
- BUG 2 FIX: FOUND tile now reads from the_cache (actual Attack List claims) instead of bone_pile scout_alerts. Period-aware (uses currentDays). Matches by part_number instead of broken 40-char title prefix dedupe.
- Removed old /restock/found-items endpoint call from frontend — FOUND data now returned inline from /restock/report
- foundMap keyed by part_number (uppercase) for reliable matching to Quarry items

## Attack list QUARRY badge rename — 2026-04-07
- Renamed ⚡ PERCH badge to ⚡ QUARRY on attack list part detail (display only)
- Leftover label from when Quarry was briefly called Perch before rebrand
- Frontend string change only — no logic, no data, no other files touched

## Scour Stream Want List search — 2026-04-07
- Added sticky search input to Want List tab on /admin/restock-list
- 150ms debounce, client-side filter, "Showing X of Y" count
- Searches: title + notes + matchedTitles + matchDebug
- Pattern copied from the-mark.html lines 72-120
- Frontend-only change, no backend touched
- Overstock tab unchanged

## Mark structured vehicle fields + editable Mark list — 2026-04-07
- Added year_start/year_end/make/model/needs_review columns to the_mark (migration 20260407000001)
- Created service/lib/markVehicleExtractor.js — best-effort extraction from title via yearParser + parseTitle
- Wired extractor into all 3 mark creation paths (Hunters Perch, Sky Watch single, Sky Watch bulk)
- Rewrote ScoutAlertService.parseMarkTitle → getMarkVehicle (reads structured columns, no title parsing at match time)
- Year is now a HARD GATE in scoreMarkMatch — no structured year = no match (no more silent fallthrough)
- needs_review marks excluded from alert generation entirely (filtered in the_mark query)
- Backfilled all 20 existing marks via migration — 3 flagged needs_review (titles with model-not-make after 2-digit year)
- PATCH /competitors/mark/:id extended to accept year_start, year_end, make, model, partType, partNumber
- the-mark.html: inline-editable year/make/model fields on every card, needs_review badge sorts to top with yellow highlight
- GET /competitors/mark/check-vehicle: now uses structured columns instead of title.includes(year)
- GET /competitors/marks: needs_review marks sort first

## Competitor drip bump: 4x→6x/day, 1→2 sellers/run — 2026-04-07
- Cron: 4 separate scheduleJob calls → loop over 6 schedules (0,4,8,12,16,20 UTC)
- CompetitorDripRunner.runDrip(): picks 2 sellers per run (LIMIT 2), sequential with 30-60s inter-seller delay
- Cooldown reduced from 6h to 3h (matches 4h cron interval)
- Each seller gets own try/catch + closeBrowser — one failure doesn't kill the other
- Net: 12 seller scrapes/day, full 12-seller rotation in ~24h (was ~72h)
- Rollback: revert cron array + LIMIT 1 in CompetitorDripRunner

## Fix manual competitor scrape categoryId 6030→0 — 2026-04-07
- competitors.js line 893: manual scrape handler (POST /competitors/:name/scrape) still had categoryId '6030', missed in earlier drip runner fix

## 2-Digit Year Parser Platform Fix — 2026-04-07
- Created service/utils/yearParser.js — canonical year parser for all title-to-year extraction
- parseYearRange() handles 8 patterns in priority order:
  1. 4-digit dash range ("2007-2011", "1994-97")
  2. 2-digit dash range ("07-11", "94-97")
  3. 4-digit space-separated ("2005 2006", "2005 2006 2007")
  4. 2-digit space-separated with 80-99/00-35 wrap ("97 98", "99 00 01")
  5. 2-digit slash range ("07/11")
  6. Single 4-digit year ("2014")
  7. 2-digit at start of string + make following ("94 Lexus...")
  8. 2-digit mid-title + make following ("REBUILT PROGRAMMED 94 LEXUS...")
- Contextual safety: standalone 2-digit years ONLY parse if followed by a known make name within 3 words
- False-positive guards: part numbers (89661-33340, F65B-14B205-BB), model numbers, dimensions all correctly return null
- Migrated 3 weaker parsers to delegate to yearParser.js:
  - partIntelligence.parseYearRange() → re-exports from yearParser.js
  - partMatcher.parseTitle() year block → calls yearParser
  - partMatcher.extractYearsFromTitle() → calls yearParser
  - AttackListService.extractYearRange() → calls piParseYearRange (which flows through yearParser)
  - restock-want-list.js extractYearsFromListingTitle() → calls yearParser
  - routes/attack-list.js inline parser → calls yearParser
- vehicleYearMatchesPart() / findMatchedParts() generational fallback / filterByYear() left intact (intentional)
- Bug 1 fixed: "REBUILT PROGRAMMED 94 LEXUS ES300" now parses to 1994, no longer matches 2002 in scout alerts
- Bug 2 fixed: "97 98 Ford F-150" now parses to 1997-1998, find-in-yard returns only those years
- 19 test cases passing including false-positive guards

# LAST SESSION — 2026-04-06

## Mark + Hidden System: Four-Bug Cascade
- hidden_parts insert: replaced broken Knex .onConflict(database.raw(...)) with raw INSERT statement (double-paren wrap was producing invalid SQL — every insert silently 500'd, table had 0 rows since creation)
- the-mark hideMark(): now awaits /hidden/add response, reverts card on failure instead of blindly deleting the mark
- extractPartNumber(): rejects year ranges (2007-2011, 07-11) before returning as PN — was matching year ranges as fake part numbers via pattern 1. Uses global regex to iterate ALL matches per pattern (not just first).
- buildMatchSets() in gap-intel: uses Clean Pipe partNumberBase column from YourSale/YourListing/Item directly, title extraction is fallback only for legacy rows
- 44510-30270 confirmed excluded: 18 sales now correctly trip the "we already sell this" filter

## Hunters Perch: Hide Button + HIDDEN Tab
- Diagnosis: hideIntel() used case-sensitive regex /[A-Z0-9]{5,}/ on titles instead of structured partNumber data
- Fix: hideByIdx() reads d.partNumber from window._intelData first, falls back to title extraction only if null
- HIDDEN tab added to Hunters Perch — INTEL (default) / HIDDEN with count badge
- HIDDEN tab lazy-loads /hidden/list, unhide button per item (DELETE /hidden/:id), decrements count badge

## Hunters Perch: Card Render Crash Fix
- Symptom: "Error: idx is not defined" — both gap-intel and emerging sections showed zero cards
- Root cause: forEach callbacks referenced idx in card HTML template but didn't declare it as the second parameter
- Fix: forEach(function(item)) → forEach(function(item, idx)) on both sections

## Hunters Perch: Mark Persistence Fix
- Diagnosis: marks WERE persisting to the_mark, but reappeared on reload
- Root cause: gap-intel filter compared partNumberBase keys against a markedTitles set (different key types — never matched)
- Fix: load both markedTitles AND markedPNs, filter checks both
- Same dual-key fix applied to emerging (had no mark filter at all before this)

## Competitor Scraper Category Filter
- Diagnosis: repairaboratorycom and other sellers returned 0 items despite scraping successfully
- Root cause: categoryId hardcoded to '6030' (Computer/Chip/Cruise Control only) — too narrow, missed items in broader auto parts subcategories
- Fix: changed to '0' (all categories) in manual scrape handler, CompetitorDripRunner, and DEFAULT_CATEGORY_ID

## Market Drip Priority Queue Restructure
- isExcludedPart() filter wired into queue building — engines, transmissions, body panels, airbags removed before they enter
- $100 price floor — sub-$100 parts skipped entirely (never appear on attack list anyway)
- 10-tier priority queue: $500+/350-499/250-349/150-249/100-149, PN-first within each tier, keyword fallback for no-PN parts
- Keyword search path uses smart-query-builder + relevance-scorer with min-3-relevant-results requirement
- Cache key for keyword results: partType|make|model|years with key_type='keyword'
- CLAUDE_RULES.md rule 29 updated to reflect new behavior

## Mark Page 60s Load Fix
- Diagnosis: GET /restock-want-list/items ran countStockedForEntry() per-row × 1,163 want list items = 58 seconds
- Root cause: The Mark page only needed titles for "IN WANT LIST" badge membership check, not stock counts
- Fix: added lightweight GET /restock-want-list/titles endpoint (no stock check, single SELECT, <100ms)
- Mark page now loads in <2 seconds

## Scout Alerts → Mark Integration Diagnostic
- Confirmed: ScoutAlertService.generateAlerts() reads from the_mark at line 223
- scoreMarkMatch() invoked via matchMarksAgainstVehicles() at line 225
- 6 PERCH alerts in scout_alerts (out of 8 active marks)
- 2 marks with 0 alerts (Dodge Stealth ECU, Buick Reatta ABS) — likely no matching vehicles in current yard inventory
- Marks DO generate scout alerts automatically — no want list demotion required
- Architectural concern resolved: the mark IS the signal

## Emerging Section Redefined
- Diagnosis: old NEW/ACCEL signal was trivially true — 1,078 of 1,085 items qualified (99.4% overlap with gap-intel)
- New criteria: sold 3+ times in 60 days by 2+ distinct sellers
- Result: 13 genuine multi-seller-validated hot parts vs 1,078 noise items
- Same Clean Pipe partNumberBase fix backfilled into emerging's buildMatchSets (was missed in gap-intel deploy)
- Frontend subtitle updated: "Sold 3+ times in 60 days by 2+ sellers — hot right now"
- Emerging score box shows sale count, badge shows seller count

## The Mark: Search + Find in Yard
- Sticky search bar at top, 150ms debounce, client-side filter against partNumber/title/partType/source/notes
- "Showing X of Y marks" count
- Find in Yard button per mark card (pin-drop icon, same as Scour Stream)
- Hits existing /restock-want-list/find-in-yard endpoint with mark title
- Shows matching yard vehicles inline (year/make/model/color/yard/row/age)

## Files touched this session
- service/routes/hidden.js — raw INSERT replacing broken onConflict
- service/routes/competitors.js — extractPartNumber year-range fix, buildMatchSets Clean Pipe, emerging rewrite, mark persistence filter
- service/public/the-mark.html — hideMark await, search bar, find-in-yard, faster load
- service/public/hunters-perch.html — HIDDEN tab, hideByIdx fix, idx fix, emerging frontend rewrite

## What's next — priority order
1. Verify all hide/mark flows end-to-end in production
2. Scout alert source badges on Daily Feed parts
3. Hawk Eye search functionality (enables Sky Watch workflow)
4. Hawk Eye + Flyway cache sync (same claimed-keys pattern)

## Open tech debt
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitorService Thu 4am reads frozen SoldItem
- LifecycleService loads all YourSale into memory (watch at 50K+)
- instrumentclusterstore scraper: 0 items, needs debug-scrape diagnosis
- Nissan trim coverage still low (30.8%) — vPIC doesn't return Trim for many Nissan models
- market_demand_cache needs more coverage — market drip filling ~600/day

## Fix: Attack list date filter — relative-to-newest → relative-to-today — 2026-04-07
- ROOT CAUSE: getDaysFromNewest() computed age relative to the newest vehicle in the dataset, not relative to today. If a yard's scraper hadn't run in 4 days, all vehicles showed as 0-3 days old (relative to the 4-day-old newest), when they were actually 4-7 days old from today.
- FIX: Changed getDaysFromNewest() to compare against today's date instead of newestDate. Removed newestDate parameter from all 14 call sites.
- "Newest" now shows vehicles added TODAY (0 days), "3d" shows vehicles ≤3 days old from today, etc.
- getNewestDate() and _currentNewestDate still exist (used elsewhere) but are no longer used for age calculation.

## Fix: Attack list pill filter — strict window, drop rest fallback — 2026-04-07
- ROOT CAUSE: pill handler built "highlighted" (within window) AND "rest" (outside window) arrays, then rendered BOTH stacked as sections. "Newest" showed "NEWEST ARRIVALS" + "1-3 DAYS" + "4-7 DAYS" etc. underneath — no actual filtering, just highlighting.
- FIX: else branch now renders ONLY highlighted vehicles. No rest sub-tiers. "All" tab unchanged (still shows full age breakdown).
- Result: Raleigh→Newest = empty (no vehicles today), Durham→Newest = 23 (today's scrape), 7d = only vehicles ≤7 days old.

## Fix: Newest tab empty — use createdAt for age calc, not date_added — 2026-04-07
- ROOT CAUSE: date_added is LKQ's "set" date (when LKQ placed the car). New vehicles are typically set "1d ago" by the time our overnight scraper sees them, so date_added is never today → getDaysFromNewest returns 1+ → Newest tab always empty.
- FIX: getNewestDate() and getDaysFromNewest() now use createdAt (row insert time = when WE scraped it) as primary, date_added as fallback. Display labels (timeAgo on line 761) still use date_added for puller-facing "set Xd ago" display.

## Blocked Comps System — 2026-04-07
- blocked_comps table: source_item_id (unique), title/PN/category snapshot, reason, blocked_at
- BlockedCompsService: block(), unblock(), list(), getBlockedSet() (60s TTL cache), recomputeAffectedCache()
- On block: snapshots Item data, invalidates matching market_demand_cache rows for immediate recompute
- AttackListService.buildInventoryIndex(): loads blockedSet, skips blocked items before they enter the match pool
- Routes: POST /blocked-comps/block, DELETE /blocked-comps/:itemId, GET /blocked-comps (search+pagination)
- Frontend attack-list.html: "Block" button on expanded parts, confirm via prompt, fade+undo pattern
- /admin/blocked-comps page: search, table with restore button, pagination
- Nav: "BLOCKED" link added to intel row in dh-nav.js
- CLAUDE_RULES.md rule 33: all Item/SoldItem/CompetitorListing queries must filter through blocked_comps

## Wire blocked comps into remaining aggregation sites — 2026-04-07
- CompetitorMonitorService.js: loads blockedSet, filters Item rows before building comp index
- DeadInventoryService.js: loads blockedSet, filters Item rows before dead inventory scan
- run-importapart-drip.js: SQL NOT IN blocked_comps on Item bucket 3 query
- Sites that DON'T need filtering: PhoenixService (SoldItem not Item), DemandAnalysis/PricePrediction (CompetitorListing not Item), priceResolver/MarketPricing/Stale (read market_demand_cache which inherits protection), restockReport (reads YourSale)

## Fix blocked comps — Item.id column, cache invalidation, backfill titles — 2026-04-07
- ROOT CAUSE: BlockedCompsService.block() used .orWhere('ebayItemId') but column is 'ebayId' — snapshot query silently failed, titles stored as null
- FIX 1: Changed to .orWhere('ebayId', idStr) in BlockedCompsService
- FIX 2: Added AttackListService.invalidateInventoryCache() static method. Called from block() and unblock() to bust the 10-minute inventory index cache immediately.
- FIX 3: Backfilled 2 existing blocked_comps rows with titles/PNs/categories from Item table
- FIX 4: Added CLAUDE_RULES.md rule 34 documenting Item.id vs ebayId column names
- NOTE: row.itemId in AttackListService is correct — it's aliased from Item.id via 'Item.id as itemId' in the JOIN query

## Dual Block Type (COMP + SOLD) + Flyway Wiring — 2026-04-07
- Migration: block_type, part_type, year, make, model columns on blocked_comps. Partial unique indexes per type.
- BlockedCompsService: blockSold(), unblockSold(), unblockById(), getBlockedSet() returns { compIds, soldKeys }
- COMP block: by Item.id (item_reference chips). SOLD block: by (partType, year, make, model) uppercase (sold chips).
- AttackListService: comp filter in buildInventoryIndex(), sold filter before PART NOVELTY in scoreVehicle()
- FlywayService: inherits both filters via shared scoreVehicle() call — no separate wiring needed
- CompetitorMonitorService, DeadInventoryService: updated to use { compIds } from new shape
- Routes: POST /block-sold, DELETE /by-id/:id (unified), kept existing comp routes
- Frontend: blockPart() handles both types via data-block-type attribute. Separate prompts per type.
- Hidden page: type tabs (All/Comp/Sold), COMP=blue badge, SOLD=orange badge, restore via /by-id/:id
- CLAUDE_RULES.md rule 33 updated with dual block type documentation

## Fix sold block restore — clear all part-matching caches — 2026-04-07
- invalidateInventoryCache() only cleared _inventoryIndexCache. Sold blocks filter against salesIndex, so restoring a sold block left parts hidden until 10-min TTL expired.
- Now clears _inventoryIndexCache, _salesIndexCache, _stockIndexCache. Validation cache intentionally excluded (unrelated).

## Re-applied sold block cache fix (dc8ca60) — 2026-04-07
- Reverted the revert. Original failure was transient Railway issue, not code.
- Deploy succeeded, /test returns 200 "haribol". Production healthy.
- invalidateInventoryCache() now clears all 3 caches (inventory + sales + stock) as intended.

## Migration 20260407100000 ran — root cause of all blocked_comps failures — 2026-04-07
- ROOT CAUSE: The dual-block-type migration failed silently on every boot because it tried DROP INDEX on a CONSTRAINT (Knex creates UNIQUE as constraints, not plain indexes). The error was caught by index.js line 792 and swallowed with "Migration failed — server will start anyway".
- getBlockedSet() then threw on every call (column block_type doesn't exist), caught returned empty sets, so zero filtering ever happened for any block type.
- FIX: Changed migration line 17 from DROP INDEX to ALTER TABLE DROP CONSTRAINT. Ran manually. Verified: 19 compIds now in blockedSet, columns present, sold blocks ready.
- Also added to CLAUDE_RULES.md: "getBlockedSet catch should log, not silently swallow"

## Fix scoreVehicle SyntaxError — await in non-async function — 2026-04-07
- ROOT CAUSE: scoreVehicle() is synchronous. The sold block filter at line 1418 used `await blockedComps.getBlockedSet()` inside it. Node refused to parse the file → SyntaxError on boot → every deploy for 6 hours crashed silently (previous container kept serving).
- FIX: Load soldKeys ONCE in each async caller (getAttackList, scoreManualVehicles, getAllYardsAttackList, FlywayService.getFlywayAttackList). Pass as trailing parameter to scoreVehicle. Inside scoreVehicle, synchronous Set.has() only.
- Also updated FlywayService to pass soldKeys through.

## Fix blocked_comps onConflict — raw SQL for partial index — 2026-04-07
- Knex .onConflict(database.raw('(col) WHERE ...')).ignore() puts WHERE inside conflict target parens → invalid Postgres SQL
- Replaced both block() and blockSold() with raw INSERT...ON CONFLICT WHERE...DO NOTHING
- Added CLAUDE_RULES.md rule: always use database.raw() for ON CONFLICT with partial unique indexes

## 2026-04-07 — Blocked Comps Dual Block Type (full afternoon arc)

Final state: COMP block (by Item.id) and SOLD block (by partType+year+make+model) both work end-to-end on Daily Feed and Flyway. Block, restore, and search all functional. Hidden page at /admin/blocked-comps.

Bugs hit and fixed today (in order):
1. Attack list pill filter rendered "highlighted + rest" stacked sections — pills only highlighted, never filtered. FIX: drop rest fallback, strict pill window.
2. Newest tab empty — getDaysFromNewest used date_added (LKQ set date) which lags. FIX: use createdAt as primary.
3. Block feature: blocked rows had null source_title because block() looked up Item by 'ebayItemId' instead of 'ebayId'. FIX: correct column name.
4. Block feature: Item.id vs row.itemId confirmed NOT a real issue — row.itemId is aliased from Item.id at line 514.
5. SOLD block type needed: sold-aggregation chips have no Item.id. Built dual block type: block_type column, partial unique indexes, separate routes+handlers.
6. Deploy crashed silently for 6 HOURS because scoreVehicle() is sync but sold filter used await inline → SyntaxError on parse → boot crash → previous container kept serving. FIX: pass soldKeys as parameter from async callers.
7. Migration failed silently: DROP INDEX on a Knex CONSTRAINT. Rerun manually with ALTER TABLE DROP CONSTRAINT.
8. Knex .onConflict(raw('(col) WHERE ...')).ignore() generates invalid SQL for partial indexes. FIX: raw INSERT...ON CONFLICT WHERE...DO NOTHING.
9. getBlockedSet() try/catch silently swallowed schema errors, hiding bug 7 for hours.

Lessons:
- Get Railway dashboard logs FIRST, stop guessing at runtime errors.
- Stale containers: successful deploy does not mean latest commit is running.
- Catch blocks that swallow boot/schema errors are toxic.
- Verify schema matches expectation after migration runs.

FOLLOW-UP (next session):
- Remove silent catch in getBlockedSet(), make it throw
- Audit boot-time migration runner — should crash on failure, not continue
- Mustang ABS chip leak (collapsed-card part_chips path)
- Flyway 401 audit

## Remove pause from scheduled .bat files — 2026-04-07
- Audited all 8 .bat files in repo root for `pause` command
- Removed `pause` from 3 scheduled files: run-price-refresh.bat, run-fitment-scrape.bat, run-scrape.bat
- run-importapart-drip.bat already had no pause
- run-apify-your-inventory.bat does not exist in repo
- Left `pause` in 3 manual-run files: run-restock-generate.bat, run-validate-trims.bat, run-yard-market-sniper.bat
- Why: `pause` blocks Task Scheduler from completing the task — window stays open waiting for keypress

## Local path migration: C:\Users\atenr → C:\DarkHawk — 2026-04-07
- Updated 13 files: 7 .bat scripts, 4 .js usage comments, 2 .js hardcoded paths
- All local scripts now use C:\DarkHawk\parthawk-deploy instead of C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
- backfill-sales.js CSV dir → C:\DarkHawk\csv-imports
- import-all-data.js data dir → C:\DarkHawk\parthawk-deploy\data
- All .bat files now use cd /d for cross-drive safety
- Verified: zero remaining references to "atenr" or "parthawk-complete" in the repo
