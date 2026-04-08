# LAST SESSION — 2026-04-08

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
