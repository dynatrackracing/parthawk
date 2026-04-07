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
