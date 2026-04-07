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
