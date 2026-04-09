# DARKHAWK CHANGELOG

Reverse chronological. Every deploy gets one entry. Claude Code appends to this after every session.

---

## Commit 1 Fix #2: Trust priceSource=sold for ValueSource — 2026-04-09
- Sales-path parts are partNumber:null by design. Trust legacy priceSource='sold' instead of parallel YourSale lookup.

---

## Commit 1 Fix: YourSale PN Normalization — 2026-04-09
- Raw manufacturerPartNumber had spaces/dashes; YourSale.partNumberBase is Clean Pipe normalized. Lookup now normalizes first.

---

## Attack List Redesign Commit 1: YourSale-Driven Value + Sort — 2026-04-09
- Vehicle sort by max YourSale 90d price (non-excluded parts only). market_demand_cache decorative. Excluded parts $0.

---

## Deploy B REDO: Scout-Alert-First Sort Inside Expanded Parts — 2026-04-09
- Rolled back page-level tier sections. Parts in expanded view now sorted scout-alert-first with signal badges.

---

## Deploy B Part 2: Daily Feed Visual Sectioning — 2026-04-09
- Section headers (SCOUT ALERTS/SOLD/COMPETITOR INTEL) + per-card tier badges on attack-list.html. Deploy B complete.

---

## Deploy B Part 1: Attack List Tier Assignment — 2026-04-09
- Vehicles get tier field (SCOUT_ALERTS/SOLD/COMPETITOR_INTEL). Scout alerts hard bucket at score >= 60. Sort by tier then score.

---

## FIELD Nav: Centered + Flyway Desktop-Only — 2026-04-09
- FIELD row centered with 6 links on desktop, 5 on mobile (Flyway hidden via CSS at 768px breakpoint). Cache buster v=5.

---

## FIELD Nav: Remove Flyway + Fix Mobile Overflow — 2026-04-09
- FIELD row: 6 links to 5 (Flyway removed, still on /admin/home). justify-content: center to flex-start. Cache buster v=4.

---

## Vehicle-Centric Scout Alerts Frontend Rebuild — 2026-04-09
- One card per vehicle, collapsed by default, expand to see part groups
- Hard/soft dedup, per-row claim, summary tiles, pagination at vehicle level

---

## Vehicle-Centric Scout Alerts Backend Reshape — 2026-04-09
- /scout-alerts/list returns one entry per vehicle with nested parts array, hard/soft dedup, soldLifetime from SoldItem

---

## Competitor Scraper Repair — Data Fix + lastScrapedAt Discipline — 2026-04-08
- Two SoldItemSeller rows had bad names (typo + store slug instead of seller username);
  replaced via DELETE+INSERT with correct _ssn values.
- lastScrapedAt now only advances on successful (non-zero) scrapes across all three
  call paths; WARN log on zero-item returns provides silent-0 alerting.
- Added scripts/scrape-one-competitor.js for manual single-seller backfills.
- Files: SoldItemsManager.js, competitors.js, CompetitorDripRunner.js,
  scripts/scrape-one-competitor.js.

---

## Session Close 2026-04-08 -- 20+ commits across Scout Alerts
- Security lockdown (rule 42), intel source icons (rule 43), Deploy A scoring rewrite (rule 44), two UI cleanup passes, reasons render fix
- Scout Alerts now produces numeric 0-100 match scores with full reasons, calibrated against real fleet data via two dry-run HALT cycles
- Known gaps: transmission matching not yet in computeMatchScore, vehicle-centric page refactor still needed, Deploy B (attack list wiring) still needed
- Full details in LAST_SESSION.md 2026-04-08 section

---

## Intel Source Icons: Fire / Target / Repeat — 2026-04-08
- renderIntelIcon() helper in dh-parts.js, fire pulse CSS in dh-parts.css
- attack-list.html chip rendering uses emoji icons: Target=Mark, Fire=Quarry, Repeat=Stream, X=Over
- scout-alerts.html alerts show intent source icon next to each alert
- Expanded-view intel chips updated to match (MARK/QUARRY/STREAM labels with icons)
- No backend changes needed -- sources already separated in intelSources[] and scout_alerts.source
- CLAUDE_RULES rule 43 (intel source icons)
- Files: dh-parts.js, dh-parts.css, attack-list.html, scout-alerts.html, CLAUDE_RULES.md

---

## Disable All eBay Write Code Paths — Read-Only Carcass — 2026-04-08
- 5 POST routes under /stale-inventory return 410 Gone (revise-price, end-item, relist-item, bulk-end, run)
- Action buttons and handlers removed from stale-inventory.html
- StaleInventoryService Wed 3am cron commented out in index.js
- Read-only banner added to Carcass page
- CLAUDE_RULES rule 42 (eBay write policy) added
- Files: stale-inventory.js, stale-inventory.html, index.js, CLAUDE_RULES.md

---

## Deploy A: Scout Alert Scoring Rewrite — 2026-04-08
- Fixed default PART_TYPE_SENSITIVITY fallback ['engine'] to [] (92% false HIGH fix)
- Added decoded_cylinders column on yard_vehicle + backfill (88% coverage via vPIC)
- Added match_score (int 0-100) + match_reasons (jsonb) on scout_alerts
- Added decoderCapability.js: per-make signal reliability, named engine table, part type ceilings
- Rewritten computeMatchScore(): year hard gate, engine-sensitive baseline 55, cylinders/named/displacement paths, diesel/drivetrain/trim verification, per-make capability awareness
- Tuned: engine-sensitive baseline 55, attack list threshold 50
- Rescored 5,948 existing alerts, deleted 2 hard-gated
- Scout Alerts UI: numeric score badges (gold/green/yellow/orange/red), reasons display, sort by score
- Files: ScoutAlertService.js, PostScrapeService.js, decoderCapability.js, scout-alerts.js, scout-alerts.html, migration, 4 scripts

---

## Hybrid / PHEV / EV Detection + Badges — 2026-04-08
- VIN decoder distinguishes Gas / Hybrid / Plug-in Hybrid / Electric via layered detection
- Detection: corgi fuelType → model-name fallback (Prius, Leaf, Volt, Tesla, etc.) → trim fallback
- Mild 48V hybrids (eTorque, EQ Boost) classified as Gas — mechanical parts share with pure gas
- vin_cache: is_hybrid/is_phev/is_electric columns + fuel_type
- Score boosts: HYBRID +15%, PHEV +20%, ELECTRIC +25% — stacks multiplicatively
- Line 2 badges: HYBRID (cyan border), PHEV (bright cyan), EV (electric blue bold)
- Badge render order: strict score-priority sort — ELECTRIC→PHEV→PERFORMANCE→HYBRID→DIESEL→4WD+MT→PREMIUM→MANUAL→4WD→CHECK_MT→CVT→TRIM
- Files: LocalVinDecoder.js, AttackListService.js, attack-list.html, migration, backfill-hybrid-flags.js

---

## Date Doctrine: LKQ date_added is Canon — 2026-04-08
- LKQ's published set date (date_added) is now the single source of truth for all display, filter, sort, scoring across DarkHawk
- createdAt is forensic-only — never read by user-facing paths
- New module: service/utils/dateHelpers.js — all date math in America/New_York
- Pill semantics: "Newest" = LKQ set today ET. Server ships daysSinceSet + setDateLabel per vehicle.
- Stale-scrape banner: yellow ⚠ when yard last scraped >18h ago
- Backfill: 1791 NULL date_added rows filled from createdAt::date
- Files: dateHelpers.js (new), AttackListService.js, FlywayService.js, attack-list.html, backfill script

---

## VAG Part Number Suffix Preservation — 2026-04-08
- VAG (VW/Audi/Skoda/Seat/Porsche) PNs match `[0-9][A-Z][0-9]\d{6}[A-Z]{0,3}` — suffix letters are variant identity, not revisions
- VAG guard added to stripRevisionSuffix() and normalizePartNumber() — returns unchanged before any stripper runs
- Backfilled 453 rows across YourListing/YourSale/SoldItem with corrected partNumberBase
- Fixes 1K0 614 517 DT showing 28 in stock when actual is 1-3 (11 distinct variants now split)
- Files: partIntelligence.js, partMatcher.js, backfill-vag-pn-base.js (new)

---

## Quarry Display Fixes — Per-Tier Cap + FOUND from Cache — 2026-04-07
- Per-tier 100-row cap replaces global pageSize=100 pagination (all 3 tiers now render at 30d+)
- FOUND tile wired to the_cache instead of bone_pile scout_alerts; period-aware, PN-keyed
- Files: restockReport.js, restock.html

---

## Attack List QUARRY Badge Rename — 2026-04-07
- Display-only label fix on attack list. ⚡ PERCH → ⚡ QUARRY. Lightning bolt unchanged.

---

## Scour Stream Want List Search — 2026-04-07
- Added sticky search input to the Want List tab on /admin/restock-list
- Client-side filter on title, notes, matched yard vehicle titles, and similar-PN debug info
- 150ms debounce, "Showing X of Y" count, pagination resets on search. Frontend-only.

---

## Mark Structured Vehicle Fields + Editable Mark List — 2026-04-07
- Architectural fix for Scout Alert wrong-year matches
- the_mark now stores year_start/year_end/make/model as columns, populated at insert time from title parsing
- Marks with no determinable year flagged needs_review and excluded from alerts until manually corrected
- Matcher rewritten to read from columns; year is now a hard gate, not a conditional skip
- Mark list UI has inline-editable vehicle fields; needs_review marks sort to top with yellow badge
- Files: migration, markVehicleExtractor.js (new), ScoutAlertService.js, competitors.js, opportunities.js, the-mark.html

---

## Competitor Drip Bump: 4x→6x/day, 1→2 Sellers/Run — 2026-04-07
- Cron every 4h (0,4,8,12,16,20 UTC), 2 sellers per run = 12 scrapes/day
- Full 12-seller rotation drops from ~72h to ~24h
- Sequential scraping with 30-60s inter-seller delay, independent error handling
- Files: index.js, CompetitorDripRunner.js

---

## Fix Manual Competitor Scrape categoryId 6030→0 — 2026-04-07
- POST /competitors/:name/scrape still had '6030' — missed in earlier drip runner fix. Now '0'.

---

## 2-Digit Year Parser Platform Fix — 2026-04-07
- Created service/utils/yearParser.js — canonical year parser with 8 pattern tiers
- Enhanced 2-digit year support: space-separated pairs/triples, slash ranges, standalone mid-title with contextual make-following rule
- Consolidated 4 independent parsers down to 1 canonical implementation (3 now delegate)
- Fixes scout alerts, find-in-yard, attack list scoring, and stock filter false matches on 2-digit year titles
- 19 test cases passing including critical false-positive guards (PN digits, model numbers, dimensions)
- Files: yearParser.js (new), partIntelligence.js, partMatcher.js, AttackListService.js, restock-want-list.js, attack-list.js

---

## Remove Pause from Scheduled .bat Files — 2026-04-07
- Removed `pause` from run-price-refresh.bat, run-fitment-scrape.bat, run-scrape.bat
- These run unattended via Windows Task Scheduler; `pause` blocked task completion
- Manual-run .bat files (restock-generate, validate-trims, yard-market-sniper) left unchanged
- run-importapart-drip.bat already had no pause; run-apify-your-inventory.bat does not exist

---

## Local Path Migration: C:\Users\atenr → C:\DarkHawk — 2026-04-07
- 13 files updated: .bat scripts, .js hardcoded paths, .js usage comments
- Zero remaining references to old user path in repo
- Files: 7 .bat, backfill-sales.js, import-all-data.js, 4 .js comment blocks

---

## Blocked Comps Dual Block Type — 2026-04-07
- COMP block: by Item.id, surgical, for priceSource='item_reference' chips
- SOLD block: by (partType, year, make, model), for priceSource='sold' chips
- Both filter on Daily Feed AND Flyway via scoreVehicle() with soldKeys parameter
- Hidden page /admin/blocked-comps with All/Comp/Sold tabs, search, restore
- Migration: block_type + part_type/year/make/model + partial unique indexes
- Raw SQL for INSERT...ON CONFLICT WHERE...DO NOTHING (Knex builder broken for partial indexes)
- Cache invalidation clears all part-matching caches on block/unblock
- Files: BlockedCompsService.js, AttackListService.js, FlywayService.js, blocked-comps.js, blocked-comps.html, attack-list.html, dh-nav.js, migration

---

## Fix blocked_comps onConflict — Raw SQL for Partial Index — 2026-04-07
- (Subsumed by consolidated entry above)

---

## Fix scoreVehicle SyntaxError — await in Non-Async Function — 2026-04-07
- scoreVehicle() is sync but sold block filter used inline await → SyntaxError → 6 hours of failed deploys
- soldKeys now loaded once per request in async callers, passed as parameter
- Files: AttackListService.js, FlywayService.js

---

## Fix Blocked Comps Migration — DROP CONSTRAINT not DROP INDEX — 2026-04-07
- Migration 20260407100000 failed silently on every boot: tried DROP INDEX on a Knex-created CONSTRAINT
- Fixed to ALTER TABLE DROP CONSTRAINT. Ran manually on prod. 19 comp blocks now filtering.
- Root cause of all blocked_comps failures today: getBlockedSet() threw → catch returned empty sets → zero filtering
- Files: 20260407100000_add_sold_block_type.js

---

## Fix Sold Block Restore — Clear All Part-Matching Caches — 2026-04-07
- invalidateInventoryCache() now clears sales + stock caches alongside inventory
- Sold block restore is now instant (was 10-min stale)
- Files: AttackListService.js

---

## Add SOLD Block Type + Wire Blocked Filter into Flyway — 2026-04-07
- SOLD block: blocks (partType, year, make, model) combo for sold-aggregated chips. Year-exact, no fuzzy.
- COMP block: existing, blocks single Item.id for item_reference chips.
- Both filters in scoreVehicle() → Flyway inherits automatically
- Hidden page: All/Comp/Sold tabs, blue COMP badge, orange SOLD badge
- Files: migration, BlockedCompsService.js, AttackListService.js, blocked-comps.js, blocked-comps.html, attack-list.html, CompetitorMonitorService.js, DeadInventoryService.js, CLAUDE_RULES.md

---

## Fix Blocked Comps — ebayId Column, Cache Invalidation, Title Backfill — 2026-04-07
- BlockedCompsService.block() fixed: ebayItemId→ebayId for Item snapshot query
- Inventory index cache invalidated immediately on block/unblock (was 10-min stale)
- Backfilled 2 existing rows with titles from Item table
- CLAUDE_RULES.md rule 34: Item.id vs ebayId column naming convention
- Files: BlockedCompsService.js, AttackListService.js, CLAUDE_RULES.md

---

## Wire Blocked Comps into All Aggregation Sites — 2026-04-07
- CompetitorMonitorService, DeadInventoryService, market drip (run-importapart-drip.js) now filter blocked items
- All Item table aggregation sites covered. SoldItem/CompetitorListing/market_demand_cache inherit via cache invalidation.
- Files: CompetitorMonitorService.js, DeadInventoryService.js, run-importapart-drip.js

---

## Blocked Comps System — 2026-04-07
- One-click block on expanded parts, with undo. Blocked items excluded from inventory index.
- BlockedCompsService: block/unblock/list/getBlockedSet (60s cache), cache invalidation on block
- /admin/blocked-comps page with search + restore + pagination
- CLAUDE_RULES.md rule 33: all Item queries must filter through blocked_comps
- Files: migration, BlockedCompsService.js, blocked-comps.js, blocked-comps.html, AttackListService.js, attack-list.html, dh-nav.js, index.js, CLAUDE_RULES.md

---

## Fix: Newest Tab Empty — Use createdAt for Age Calc — 2026-04-07
- date_added (LKQ set date) is stale on new arrivals — never equals today
- Age functions now use createdAt (scrape time) as primary, date_added fallback
- Display labels still show LKQ set date for pullers
- Files: attack-list.html

---

## Fix: Attack List Pill Filter — Strict Window — 2026-04-07
- Pills now show ONLY vehicles within the selected window (was highlight+rest stacked)
- "Newest" = only today's vehicles, "3d" = only ≤3 days, etc. No older sections below.
- "All" tab unchanged — still shows full age-tier breakdown
- Files: attack-list.html

---

## Fix: Attack List Date Filter — Relative-to-Today — 2026-04-07
- getDaysFromNewest() was comparing against newest vehicle in dataset, not today
- If scraper was 4 days stale, "Newest" showed 4-day-old vehicles as day 0
- Fixed to compare against today's date. All pill filters now show real calendar age.
- Files: attack-list.html

---

## The Mark — Search Bar + Find in Yard — 2026-04-06
- Sticky search bar: debounced 150ms client-side filter across all mark fields
- Find-in-yard button on each mark card (same endpoint as Scour Stream)
- Inline yard results with YMM, yard name, row, set date
- Files: the-mark.html

---

## Emerging Rewrite — Hot Parts Signal — 2026-04-06
- Old NEW/ACCEL criteria was trivially true (1,078/1,085 items = 99.4% overlap with gap-intel)
- New: 3+ sales by 2+ distinct sellers in 60-day window. Currently 13 genuine multi-seller validated results.
- Applied Clean Pipe partNumberBase fix to emerging's buildMatchSets (missed in previous deploy)
- Frontend: updated subtitle, badges, score display for new response shape
- Files: competitors.js, hunters-perch.html

---

## Four-Bug Cascade Fix — Hidden + Gap-Intel — 2026-04-06
- **hidden_parts insert**: POST /hidden/add threw 500 on every call — Knex `.onConflict(raw)` double-paren SQL. Replaced with raw INSERT. Zero rows had ever been inserted.
- **the-mark hideMark()**: Fire-and-forget → now awaits /hidden/add response, reverts card on failure instead of deleting mark blindly
- **extractPartNumber() year-range false positive**: Year ranges like `2007-2011` matched as PNs before the real PN. Added year-range rejection + global regex to iterate all matches per pattern.
- **gap-intel buildMatchSets()**: Was re-extracting PNs from titles (broken for year-range titles). Now uses Clean Pipe `partNumberBase` column directly, title extraction as fallback only.
- **Result**: 44510-30270 (18 sales) no longer appears as a false "gap". Hide button on The Mark and Hunters Perch now actually inserts into hidden_parts.
- Files: hidden.js, the-mark.html, competitors.js

---

## Fix Hide Button + HIDDEN Tab on Hunters Perch — 2026-04-06
- hideByIdx() uses structured partNumber from _intelData (was unreliable title regex)
- HIDDEN tab: lazy-loaded list of hidden parts, unhide button, count badge
- Backend hidden filtering already working in gap-intel + emerging
- Files: hunters-perch.html

---

## Fix Mark Persistence — Marked Items Reappearing — 2026-04-06
- Gap-intel groups by partNumberBase but marks store normalizedTitle — key types never matched
- Added markedPNs Set, filter checks both title AND PN keys
- Emerging section had NO mark filter — added
- Files: competitors.js

---

## Market Drip Priority Queue Restructure — 2026-04-06
- isExcludedPart() filter removes engines/transmissions/body panels/airbags from queue
- $100 price floor skips sub-$100 parts (~36% of queue was wasted)
- 10-tier priority: price descending ($500+→$100+), PN-first within each tier
- Keyword search for no-PN parts: smart-query-builder + relevance-scorer (min 3 relevant results)
- Files: run-importapart-drip.js, CLAUDE_RULES.md

---

## Fix Hunters Perch Mark + Hide Buttons — 2026-04-06
- JSON.stringify(sellers) in onclick attributes broke HTML parsing (unescaped double quotes)
- Replaced with data-attribute lookup: window._intelData stores item data, buttons reference by index
- Both Mark (★ gold) and Hide (✕ red) now functional on all gap-intel + emerging cards
- Files: hunters-perch.html

---

## Mark + Hidden System Repair — 2026-04-06
- hidden_parts table: global part blacklist with PN+make+model+source
- /hidden routes (add/delete/list/keys) for CRUD
- Hidden filtering in gap-intel + emerging backends
- Hunters Perch: dismiss → hideIntel (red fade to /hidden/add)
- The Mark: HIDE button (mark → hidden), hidden management section with unhide
- AttackListService: hidden PNs removed from all intel sets (no chips on Daily Feed)
- Files: migration, hidden.js, competitors.js, index.js, ALS, hunters-perch.html, the-mark.html

---

## Flyway Intel Integration — 2026-04-06
- Day trip = full attack list (all vehicles, all intel chips, all scoring)
- Road trip = LEGENDARY + RARE + MARK only (COMMON/SATURATED filtered out)
- FlywayService loads full intelIndex + frequencyMap, passes to scoreVehicle()
- Part chips: 6 max with noveltyTier + intelSource + belowFloor filter
- Files: FlywayService.js

---

## Intel Sources Wired into Attack List — 2026-04-06
- Enhanced intel index: quarryPNs, streamPNs, overstockPNs separated (was single wantPNs set)
- Per-source vehicle score boosts: MARK +15%, QUARRY +10%, STREAM +5% (multiplicative, stacking)
- Part chips: ★gold MARK, ★green QUARRY, ★blue STREAM, ✕red OVERSTOCK
- Expanded view: matching intel badges with source labels
- intel_match_count on vehicle response, ★N indicator on collapsed cards
- Files: AttackListService.js, attack-list.html

---

## Fix Overstock Stock Counting + Overstock→Want List Auto-Transition — 2026-04-06
- countStockedForEntry(): Clean Pipe partNumberBase+make+model (was title ILIKE with false PN matches)
- 4Runner BCM: 13→0, Ranger Fuse Box: 21→correct count
- OverstockCheckService: auto-creates want list entry when stock drops to 0
- Lifecycle: OVERSTOCK→stock=0→WANT LIST (auto)→SCOUT ALERTS→CACHE→eBay
- Files: restock-want-list.js, OverstockCheckService.js

---

## QUARRY: Remove 200 Cap, High-Value CRITICAL Upgrade, Timeframe Sort, Pagination — 2026-04-06
- Removed items.slice(0, 200) hard cap — returns all qualifying items with pagination
- High-value zero-stock parts auto-upgrade to CRITICAL (avgPrice≥$200+sold≥1, or totalRevenue≥$500)
- Timeframe-aware sort: 7d=velocity, 30d=revenue, 60d/90d=ratio
- Pagination: page/pageSize params, Prev/Next controls, full tier counts in summary
- Files: restockReport.js, restock.html

---

## Scour Stream Overhaul — 2026-04-06
- Watchlist tab removed, want list is default
- Want list add: PN + Description + Make + Model + Notes (structured fields)
- Migration: part_number, make, model columns on restock_want_list
- Overstock scanners: scan-duplicates (partNumberBase groups) + scan-high-qty (qty>1, last 30d)
- Files: restock-list.html, restock-want-list.js, migration

---

## Fix: vehicle_frequency Epoch Zero Corruption — 2026-04-06
- 174/895 rows had first_tracked_at=1970-01-01 from old LKQ scraper NULL first_seen dates
- Backfill now uses earliest valid date (first_seen or createdAt, > 2020-01-01 guard)
- Daily cron guards against epoch zero in avg_days recalculation
- Min-data guard in AttackListService: <30d data caps at UNCOMMON, 30-60d caps at RARE, 60+ full tiers
- Re-backfilled: 0 epoch zero, Titan SATURATED (was LEGENDARY), Explorer SATURATED (was LEGENDARY)
- Files: backfill-vehicle-frequency-gen.js, index.js, AttackListService.js

---

## Generation-Aware Rarity + Trim-Driven Badge Overrides — 2026-04-06
- vehicle_frequency generation-aware: gen_start/gen_end from trim_tier_reference, decade fallback
- Trim overrides: PERFORMANCE→LEGENDARY, PREMIUM→RARE, 4WD+MT→RARE, DIESEL→RARE (floor only, never lower)
- Generation-specific frequency lookup, rarityReason field for badge detail
- Backfill: 895 rows from 4,641 year combos. Camry split into 2012-2017 + 2018-2024.
- Files: migration, backfill, AttackListService.js, index.js, attack-list.html, CLAUDE_RULES.md

---

## Vehicle Card 4-Line Layout — 2026-04-06
- Collapsed cards: headline (score+YMM+rarity) / attributes (trim+diesel+4WD+MT) / location (row+color+age+NEW) / parts (colored chips with novelty dots)
- Score uncapped display (120+ = gold pulse), attribute boost as cyan ↑XX%
- 6 rarity badge tiers with existing pulse animations, right-aligned with detail text
- Part novelty: cyan dot = NOVEL, green dot = RESTOCK. Chips increased to 6 max.
- Files: attack-list.html, attack-list.js

---

## Rarity Thresholds + Score Uncap + Vehicle Limit Removed — 2026-04-06
- Rarity: long-term thresholds (LEGENDARY 180+d through SATURATED <7d)
- Score uncapped — can exceed 100 with attribute/rarity/novelty boosts
- Vehicle limits removed (was 200/500 backend, 500 frontend cap → unlimited)
- Part noveltyBoost exposed in response
- Files: AttackListService.js, attack-list.html, CLAUDE_RULES.md

---

## Persistent Vehicle Rarity + Sort Overhaul — 2026-04-06
- vehicle_frequency table with lifetime avg_days_between tracking (1,057 rows backfilled)
- 6-tier rarity: LEGENDARY/RARE/UNCOMMON/NORMAL/COMMON/SATURATED with pulsing gold/purple badges
- Replaced ephemeral active-count rarity with persistent frequency-based scoring
- Daily cron at 6:30 AM UTC, badge on vehicle cards with tooltip
- Files: migration, backfill, AttackListService.js, attack-list.html, index.js, CLAUDE_RULES.md

---

## Revenue-Optimized Scoring: Rarity + Novelty + Sort — 2026-04-06
- Vehicle rarity from active yard_vehicle count (RARE/UNCOMMON/NORMAL/COMMON/SATURATED)
- Part novelty tiers (NOVEL/RESTOCK/STOCKED) with scoring boosts
- Vehicle sort: est_value DESC (total yield wins over single-part chasers)
- Part sort: price DESC (grab the money first)
- Frontend badges: RARE/UNCOMMON on vehicles, NEW/RESTOCK on parts
- Files: AttackListService.js, attack-list.html, CLAUDE_RULES.md

---

## Airbag Exclusion + Vehicle Attribute Boosts + ECM Visibility — 2026-04-06
- Airbags/SRS added to isExcludedPart() backend+frontend, removed from PART_PRICE_FLOORS
- Vehicle scoring boosts: PERFORMANCE +20%, DIESEL +15%, 4WD+MT +12%, PREMIUM +10%, MANUAL +8%, 4WD +5%
- Pro-rebuild ECM/ECU/PCM display as normal scored parts (1,298 items, bypass rebuild grouping)
- CLAUDE_RULES rules 19+20 updated
- Files: AttackListService.js, dh-parts.js, attack-list.html, CLAUDE_RULES.md

---

## Phase 10b: vPIC Trim+Transmission Fallback — 2026-04-06
- Restored NHTSA vPIC standalone PostgreSQL database to vpic schema (1.6M patterns)
- LocalVinDecoder step 3.5: vpicTrimFallback() — fills trim+transmission from vPIC pattern matching
- Fixes trim regression from Phase 9: Nissan 1.1%→30.8%, BMW 10.6%→81.5%, Toyota 29.8%→75.8%, Chevy 58.2%→95.9%, GMC 50.4%→100%
- Backfill: 2,152 vehicles got trim (0 errors)

---

## Phase 10: EPA Transmission Resolver — 2026-04-05
- vin_decoder.epa_transmission table: 36,035 EPA FuelEconomy.gov records (year/make/model/trans_type/speeds)
- resolveTransmission() 3-tier: epa_definitive (single type), epa_check_mt (22 models), epa_default_auto (both offered, default auto)
- 22 CHECK_MT models: Corvette, Camaro, Mustang, Challenger, WRX, BRZ, FR-S, 350Z, 370Z, MX-5, Miata, Genesis Coupe, Veloster, GTI, GTO, Solstice, Sky, Lancer, FJ Cruiser, Tacoma, Frontier, Ranger, Wrangler
- Performance trim override: ST/Si/Type R/SRT/SS/RS/Nismo/TRD/Sport/GT → CHECK_MT
- Wired into decode() step 4.5, vin_cache stores all EPA fields, cached path returns them
- Files: LocalVinDecoder.js, migration, import script, backfill script, CLAUDE_RULES.md

---

## VinDecodeService Write Gap + vin_cache Transmission — 2026-04-05
- VinDecodeService writes decoded_engine/drivetrain/transmission to yard_vehicle
- vin_cache stores transmission_style from corgi transHint
- AttackListService.scoreVehicle() passes decoded_drivetrain to frontend (fixes 4WD/AWD badges)
- Backfill: 3,243 vehicles missing decoded_transmission processed

---

## Clean Pipe Gaps: Missing Models, Part Types, Dual-Make — 2026-04-05
- MODEL_PATTERNS: +Express, Savana, Econoline, Transit, Sprinter, Astro, Safari, NV200, ProMaster, Explorer Sport Trac
- detectPartType(): +ROLLOVER_SENSOR, YAW_SENSOR, OCCUPANT_SENSOR, SEAT/DOOR/WIPER_MODULE, BLEND_DOOR, TRAILER_MODULE
- Backfill: 7,769 rows fixed (409 models, 374+ types, 5,740+ PNs across 3 tables)

---

## Attack List: Trim/Engine/Trans Mismatch Filtering — 2026-04-05
- extractPartSpecifics(title) detects: performance trims (ST/SRT/Raptor/AMG/etc.), forced induction (EcoBoost/Turbo/TSI), transmission type, diesel
- Compares part title specifics against vehicle VIN data (decoded_trim, engine, decoded_transmission, diesel)
- Mismatched parts excluded from totalValue, shown in collapsed "X parts don't match this vehicle" section
- Frontend: orange mismatch reason text, greyed out at opacity 0.4
- Files: AttackListService.js, attack-list.html

---

## Fix: Reject Concatenated Year Ranges as Part Numbers — 2026-04-05
- extractPartNumbers() 8-digit regex captured "20012003" etc. as PNs from stripped year ranges
- Added /^(19|20)\d{2}(19|20)\d{2}$/ rejection after isSkipWord check
- Cleanup script NULLs bad partNumberBase across YourListing, YourSale, SoldItem
- Files: partIntelligence.js, cleanup-year-range-pns.js (new)

---

## Bidirectional Model Matching + Compound Models — 2026-04-05
- COMPOUND_MODEL_MAP: F-250 Super Duty→F-250, Explorer Sport Trac→Explorer, etc.
- getModelVariants() tries compound, base, and dash/no-dash variants
- Bidirectional fuzzy in findMatchedParts, sales index, stock index
- Protected: Grand Cherokee, Transit Connect, Grand Caravan never collapse

---

## Stock Match Type Flag (verify PN) — 2026-04-05
- buildStockIndex tracks full raw PNs per base key for exact vs base match detection
- Parts with base-only PN match show "X in stock ⚠ verify PN" in orange
- Exact PN matches show clean stock count as before

---

## Ford partNumberBase Fix + Stock Index Dedup — 2026-04-05
- Ford PNs now keep vehicle prefix (7L3A12A650 not 12A650) — fixes 241→5 stock inflation
- Stock index deduplicates per listing via Set — prevents triple-counting
- normalizePartNumber handles 3-char Ford suffixes (GJH)
- Backfill: 9,490 rows updated across 3 tables

---

## Cache + Scour Stream Inline Edit — 2026-04-05
- PATCH /cache/:id, PATCH /restock-want-list/:id, PATCH /restock-want-list/by-title
- cache.html, restock-list.html, scout-alerts.html: tap-to-edit inline with green flash save

---

## Scout Alerts: is_core Yard Flag — 2026-04-05
- is_core boolean on yard table, set true for 4 LKQ NC yards only
- Foss/Young's/FL LKQ correctly non-core, FlywayService.getCoreYardIds() reads DB

---

## Scout Alerts: Confidence Matching Overhaul — 2026-04-05
- Part-type sensitivity: engine/drivetrain/trim verification per part type
- Real value comparison replaces existence checking
- Model conflict rejection, isExcludedPart() on alert generation

---

## Scout Alerts: Flyway Trip Filter — 2026-04-05
- Yard vehicle query filters by is_core OR active flyway trip
- Road trip yards no longer generate alerts after trip completion

---

## Global Part Value Colors + Exclusion Filter — 2026-04-05
- dh-parts.js/css: shared 6-tier system + isExcludedPart() across all 6 field pages
- Replaces inline badge CSS/JS on attack-list, adds badges to scout-alerts/cache/vin-scanner/gate/flyway

---

## Inline Edit: Cache Part Numbers + Scour Stream Want List — 2026-04-05
- PATCH /cache/:id — update partNumber (re-normalized via normalizePartNumber), partDescription, partType, make, model, year, notes
- PATCH /restock-want-list/:id — update title, notes on want list entries
- PATCH /restock-want-list/by-title — update by title match + sync scout_alerts.source_title
- cache.html: inline edit on part number and description (tap to edit, blur/Enter to save, green flash feedback)
- restock-list.html: inline edit on want list title and notes in WANT LIST tab
- scout-alerts.html: inline edit on STREAM alert source_title (patches want list + alert records)
- Files: CacheService.js, cache.js, restock-want-list.js, cache.html, restock-list.html, scout-alerts.html

---

## Scout Alerts is_core Yard Flag — 2026-04-05
- Added is_core boolean to yard table, set true for 7 NC local yards
- ScoutAlertService: WHERE yard.is_core = true OR active trip (replaces broken trip-absence inference)
- FlywayService.getCoreYardIds(): reads is_core flag instead of hardcoded name list
- FL LKQ yards no longer incorrectly protected from vehicle cleanup

---

## Scout Alerts Confidence Matching Rewrite — 2026-04-05
- scoreMatch() now verifies engine/drivetrain/trim MATCH, not just existence
- PART_TYPE_SENSITIVITY: engine-sensitive (ECM/PCM), drivetrain-sensitive (ABS), trim-sensitive (AMP/RADIO), universal (BCM/TIPM/etc.)
- Engine: displacement + cylinder + named engine comparison (mismatch = LOW, unknown = MEDIUM)
- Model conflicts: Cherokee ≠ Grand Cherokee, Transit ≠ Transit Connect, Wrangler ≠ Gladiator
- isExcludedPart() filters excluded parts before alert generation
- SELECT adds decoded_drivetrain, decoded_transmission, diesel, trim_tier, body_style

---

## Scout Alerts Trip Filtering — 2026-04-05
- generateAlerts() yard_vehicle query now filters by trip status
- Core yards (not in flyway_trip_yard) always generate alerts
- Flyway yards only generate alerts when their trip is active
- Vehicles from completed/expired trips excluded immediately (no 24h wait)

---

## Global Part Value Colors + Exclusion Filter — 2026-04-05
- Created dh-parts.js + dh-parts.css: shared 6-tier color system (getPartTier, renderPriceBadge, isExcludedPart)
- Wired into all 6 field pages: attack-list, scout-alerts, cache, vin-scanner, gate, flyway
- Global exclusion: engines, transmissions, body panels filtered; modules/trim/glass/steering allowed
- Backend isExcludedPart() updated: removed transfer case + steering rack (sellable), added trunk lid/roof panel

---

## Price Resolution + Badge Tiers — 2026-04-05
- Removed CONSERVATIVE_SELL_ESTIMATES — price chain now: market_demand_cache → Item.price (REF prefix) → NO DATA
- 6-tier part badges: ELITE gold pulse ($500+), PREMIUM purple pulse ($350+), HIGH blue, SOLID green, BASE orange, LOW red
- Category chips + vehicle score use same 6-tier colors based on highest part value
- BASE tier yellow→orange (#FF8C00) for visual distinction from gold

---

## Scout Alerts Cache Sync — 2026-04-05
- Scout alerts now use /cache/claimed-keys for shared truth with Daily Feed
- Three matching strategies: alertId, normalized PN (cross-tool), itemId (no-PN parts)
- Claim/unclaim syncs both cache entry and scout_alert claimed field
- Cross-tool: pull from Daily Feed → shows checkmark on Scout Alerts page

---

## Cache itemId Fallback — 2026-04-05
- Added item_id column to the_cache table (migration)
- CacheService.claim() accepts and stores itemId
- Dedup by itemId when partNumber is empty (sunroof glass, mirrors, etc.)
- GET /cache/claimed-keys returns both claimedPNs and claimedItemIds maps
- Frontend getCachedId() checks PN first, falls back to itemId

---

## Cache ↔ Attack List Sync — 2026-04-05
- GET /cache/claimed-keys endpoint — lightweight, returns normalized PNs + cache IDs
- CacheService.claim() deduplicates by normalizePartNumber() (Ford/Toyota/Honda/Chrysler suffix stripping)
- Frontend normalizePN() mirrors backend normalization exactly
- Pull button toggles: Pull → checkmark (claimed), checkmark → Pull (unclaimed via DELETE /cache/:id)
- Persists across page reloads — reads cache state on every page init

---

## QUARRY Frontend Fix — 2026-04-05
- Summary cards: d.summary.green/yellow/orange → d.summary.critical/low/watch
- Row fields: sold7d→timesSold, activeStock→inStock, action→urgency
- TIER_CONFIG keys updated from color names to urgency names

---

## Attack List Price Floors — 2026-04-05
- PART_PRICE_FLOORS constant in AttackListService: ABS=$150, electronic modules=$100
- Mechanical parts have no floor
- Below-floor parts flagged belowFloor:true, excluded from vehicle totalValue
- Frontend: collapsed "X parts below price floor" section, greyed at opacity 0.4

---

## Sniper Overhaul — 2026-04-05
- Replaced dead PriceCheckServiceV2 (eBay blocks axios) with Playwright+stealth
- Filtered to NC pull yards only (Raleigh, Durham, Greensboro)
- Newest vehicles only (first_seen >= 24h default, --hours CLI flag)
- Dry run verified: 192 vehicles → 50 PNs queued by price descending

---

## The Mark Management Page + Want List Push — 2026-04-04
- the-mark.html rebuilt: shows active marks with source badges (SKY/PERCH), status (HUNTING/IN-YARD/LISTED/SOLD)
- 'Send to want list' pushes mark to Scour Stream (restock_want_list)
- 'Remove' deletes mark, item returns to source list automatically
- Manual text entry adds directly to want list
- Sky Watch + Hunters Perch mark buttons confirmed working (already existed)
- Gap-intel already excludes marked items (already existed)

---

## QUARRY Velocity Scoring + Want List Auto-Sync — 2026-04-04
- Velocity ratio: sold_count / in_stock, urgency tiers CRITICAL/LOW/WATCH/FINE
- CRITICAL + LOW auto-added to restock_want_list (518 entries on first run)
- POST /restock/quarry-sync for manual trigger
- Runs after YourDataManager.syncAll (4x/day via cron)
- Cleanup: deactivates quarry_auto entries when velocity drops below threshold
- Scout Alerts reads want list via Hunters Perch source (no changes needed)
- Verified: 126 CRITICAL, 512 LOW, 133 WATCH

---

## Market Drip Rewrite — 2026-04-04
- Expanded importapart drip to 3-bucket priority queue: active inventory (1,151) + sold-not-restocked (1,583) + importapart catalog (9,009) = 10,912 unique PNs
- Comp quality filter: regex excludes as-is/untested/for-parts/core before averaging
- DELAY_MS: 15000 → 3000, batch: 34 → 200, cycle: 72 days → 18 days
- source: importapart_drip → market_drip
- Cache keys normalized to Clean Pipe, key_type='pn' on all upserts
- Fixed dirty keys in market_demand_cache

---

## QUARRY: Pure SQL rewrite with Clean Pipe columns — 2026-04-04
- restockReport.js rewritten: pure SQL grouping by partNumberBase/extractedMake/extractedModel
- No runtime title parsing — all extraction done at write time via Clean Pipe
- Stock lookup: exact key (pn+make+model) then pn-only fallback, both from SQL aggregation
- Market enrichment from market_demand_cache by partNumberBase
- Verified: 100 results, 93 green tier, 1,632 sales analyzed

---

## Sniper: Batch Size 15→35, Priority Queue, Preview — 2026-04-04
- PriceCheckCronRunner batch size 15→35 (70 weeks full coverage vs 163)
- Queue priority: never-checked first, highest price first, oldest check last
- Single LEFT JOIN SQL replaces ORM two-query approach
- GET /pricing/sniper-preview for dry-run queue inspection
- 2,449 active listings, all never-checked

---

## Attack List Scoring Upgrades — 2026-04-04
- Stock penalty scaling: 5% (1 in stock) → 70% (5+ in stock) multiplicative reduction on score
- Fresh arrival bonus: +10% for ≤3 days, +5% for ≤7, +2% for ≤14 days
- COGS yard factor: cheap yards +5%, expensive -5% (uses entry_fee + tax_rate)
- All factors multiplicative, applied after additive scoring, capped 0-100
- Yard profiles loaded once per call (no per-vehicle queries)
- Verified: 0 NaN, healthy distribution across 1,500 vehicles

---

## [Clean Pipe E5] Phoenix PN Joins — 2026-04-04
- Phoenix SoldItem matching uses partNumberBase column for direct lookup (replaces title scanning)
- Standalone group creation uses extractedMake/partType columns
- pnBaseSet keys normalized to match Clean Pipe format
- Verified: 10 results with healthy scores (TIPM 80, CLUSTER 80, HVAC 68)

---

## [Clean Pipe E4] Competitor Intel Routes — 2026-04-04
- gap-intel, best-sellers, emerging routes now group SoldItems by partNumberBase (exact) with normalizeTitle fallback
- Added partNumberBase/partType to query SELECTs for all 3 routes
- gap-intel and emerging use Clean Pipe partNumberBase and partType in output
- Same scoring formulas, same API response shape, backward compatible

---

## 2026-04-04 — Active Inventory CSV Import + Zero Qty Fix
- **Active Inventory CSV import** on /admin/import — store selector, flexible column mapping, preview, upsert to YourListing
- 368 Autolumen listings imported — stock index now sees both stores (fixes Autolumen blind spot)
- **Zero quantity = Ended** — universal rule across API sync and CSV import paths
- CSV import deactivation pass — listings missing from file marked Ended
- One-time cleanup: 290 ghost Active listings with qty=0 deactivated

---

## [Clean Pipe E3] Sales Index Optimization — 2026-04-04
- buildSalesIndex() reads extractedMake, extractedModel, partType from YourSale columns first
- Falls back to title parsing only when columns are NULL
- Eliminates ~14,600 regex parses per attack list load (90-day sales window)
- Verified: 351 make/model combos, 1,616 sales indexed

---

## [Clean Pipe E2] Stock Index Optimization — 2026-04-04
- buildStockIndex() reads new columns first (partNumberBase, extractedMake, extractedModel)
- Falls back to title parsing only when columns are NULL
- Eliminates ~2,400 regex parses per attack list load
- Verified: 574 make/model combos, 4,322 PNs indexed

---

## [Clean Pipe E1] Sniper PN Cleanup — 2026-04-04
- sanitizePartNumberForSearch() and deduplicatePNQueue() added to partIntelligence.js
- Strips Ford ECU suffixes to searchable base (12A650, 14A067 patterns)
- Rejects junk PNs: model names, VIN fragments, concatenated keywords, short/long garbage
- Wired into run-yard-market-sniper.js — sanitizes + deduplicates queue before scraping
- Expected: dramatically improved sniper hit rate (was 1/50 due to junk PNs)

---

## [Clean Pipe Phase D] Cache Key Standardization — 2026-04-04
- market_demand_cache: added key_type column (pn/ymm), normalized all PN keys (stripped spaces/dashes/dots)
- 74 keys renamed, 0 duplicates found, 582 PN + 8 YMM total
- Updated MarketPricingService, PriceCheckService, MarketDemandCronRunner writers to normalize before insert
- Updated priceResolver.js reader to normalize lookup keys
- Cache keys now joinable with YourSale/YourListing/SoldItem partNumberBase columns

---

## [Clean Pipe Phase C] Wire Insert Paths — 2026-04-04
- Wired extractStructuredFields() into all insert/upsert paths
- YourDataManager: syncOrders (YourSale) + syncListings (YourListing)
- SoldItemsManager: competitor scrape inserts (SoldItem) — scrapeCompetitor + scrapeByKeywords
- AutolumenImportService: CSV import inserts (YourListing + YourSale) — all 3 import methods
- All new records automatically get partNumberBase, partType, extractedMake, extractedModel

---

## [Clean Pipe Phase B] Backfill Existing Records — 2026-04-04
- Backfilled partNumberBase, partType, extractedMake, extractedModel on all YourSale (14,603), YourListing (4,365), SoldItem (1,248) rows
- Script: service/scripts/backfill-clean-pipe.js (rerunnable, skips already-processed rows)
- partType='OTHER' used as processed sentinel for rows with no detectable part type
- Cross-table joins by partNumberBase now functional (verified: Ford ECM 623 sales / 77 competitor / 110 in stock)

---

## [Clean Pipe Phase A] Schema + Extraction Utility — 2026-04-04
- Added partNumberBase, partType, extractedMake, extractedModel to YourListing, YourSale, SoldItem
- 8 indexes for cross-table joins (partNumberBase, partType, extractedMake)
- extractStructuredFields() in partIntelligence.js: extracts PN base, part type, make, model from any title
- Make normalization map (47 entries) with title-case output matching corgi VIN decoder
- Model pattern list (200+ models) with multi-word priority (Grand Cherokee before Cherokee)
- detectPartType() added to partIntelligence.js (self-contained copy from AttackListService)
- Tested 11 titles: Grand Cherokee, Silverado 1500, BMW 5 Series, Datsun 280ZX all correct
- Columns exist on prod, all NULL — backfill (Phase B) and insert wiring (Phase C) coming next

---

## [Phase 9] Local VIN Decoder — 2026-04-03
- Installed @cardog/corgi for offline VIN decoding (eliminates all NHTSA API calls)
- Created vin_decoder schema with manufacturers, vds_trim_lookup, engine_codes, name_aliases tables
- Seeded GM, Chrysler, Honda, Ford trim and engine lookup data
- Built LocalVinDecoder singleton service (service/lib/LocalVinDecoder.js)
- Rewired 5 NHTSA callers: PostScrapeService, VinDecodeService, VIN routes, attack list
- Fixed tonnage series values leaking into trim field
- Fixed chassis codes (MCX20L) filtered by cleanDecodedTrim()
- Added engine fallback for null corgi engine data
- Added /vin/test-local/:vin diagnostic endpoint
- Pre-initializes decoder on app startup
- Tested 20 real VINs: 20/20 year/make/model, 20/20 drivetrain, 15/20 engine improved
- Full intelligence diagnostic run: attack list healthy, 5 tuning items identified
- **Added:** @cardog/corgi for offline VIN decoding (sub-15ms, zero network, ~20MB bundled SQLite)
- **Added:** vin_decoder schema with manufacturers, vds_trim_lookup, engine_codes, name_aliases tables
- **Added:** GM/Chrysler/Honda/Ford trim and engine code seed data
- **Added:** LocalVinDecoder singleton service (corgi + VDS enrichment pipeline)
- **Added:** /vin/test-local/:vin diagnostic endpoint
- **Changed:** PostScrapeService.decodeBatch() → local decode (was NHTSA batch API)
- **Changed:** VinDecodeService.decode() → local decode (was NHTSA single VIN API)
- **Changed:** /vin/decode-photo and /vin/scan routes → local decode
- **Changed:** attack-list manual VIN decode → local decode
- **Changed:** nixpacks.toml adds python3 + build-essential for better-sqlite3
- **Removed:** All NHTSA API calls (zero remain in codebase)
- **Removed:** NHTSA rate limit sleeps (200ms, 1000ms, 2000ms)
- **Files touched:** package.json, nixpacks.toml, migration (new), LocalVinDecoder.js (new), PostScrapeService.js, VinDecodeService.js, vin.js, attack-list.js, index.js
- **Affects:** All VIN decoding across DarkHawk — post-scrape, cron, VIN scanner, manual lists
- **Notes:** Decoder pre-inits on startup. VDS enrichment falls back gracefully if tables not yet migrated.

---

## [2026-04-01] Homepage section links + Autolumen uploads placement
- **Added:** home.html at /admin/home — DarkHawk homepage with categorized section links (Field/Intel/Inventory/Tools)
- **Moved:** Autolumen Sync card from gate.html to home.html (both Active Listings + Sales History uploads)
- **Changed:** gate.html stripped to Nest Protector only (stock check + COGS)
- **Changed:** DarkHawk logo in dh-nav.js links to /admin/home instead of /
- **Files touched:** home.html (new), gate.html, dh-nav.js, index.js
- **Notes:** Root / still serves React SPA (DynaTrack inventory). DarkHawk homepage is /admin/home.

---

## [2026-04-01] Fix: Cache check-stock matches Nest Protector accuracy
- **Fixed:** cache.html sent `part_number` param but both `/cogs/check-stock` and `/cache/check-stock` expect `pn`
- **Fixed:** cache.html parsed `/cogs/check-stock` response as `d.results` instead of `d.exact`/`d.variants`
- **Fixed:** cache.html parsed `/cache/check-stock` response as `d.results` instead of `d.cached`
- **Files touched:** cache.html
- **Notes:** Cache check-stock now produces identical results to Nest Protector for the same PN input

---

## [2026-04-01] The Cache Phase 7 Part 2 — Frontend + Puller Tool Wiring
- **Added:** cache.html — Active/History/Add Part tabs, mobile-first, manual entry by PN or YMM
- **Added:** Pull buttons on Daily Feed, Hawk Eye, Flyway expanded parts
- **Added:** THE CACHE nav link in dh-nav.js (between Scout Alerts and Hawk Eye)
- **Changed:** Daily Feed markPulled() → claimPart() via POST /cache/claim
- **Changed:** Scout Alerts claim handler → routes through /cache/claim (server marks alert claimed)
- **Changed:** Hawk Eye shows cachedParts notice and Pull buttons on scan results
- **Changed:** gate.html stock check shows "In The Cache" section for cached claims
- **Files touched:** cache.html (new), dh-nav.js, attack-list.html, scout-alerts.html, vin-scanner.html, flyway.html, gate.html, index.js
- **Affects:** All puller tools, stock checks, nav across all pages
- **Notes:** Source badges color-coded: daily_feed=red, scout_alert=orange, hawk_eye=teal, flyway=blue, manual=gray

---

## [2026-04-01] Fix: the_cache migration + CacheService.getStats()
- **Fixed:** Store column migration failed on prod because column already existed — made idempotent with `hasColumn` check
- **Fixed:** Cache migration blocked by store column migration failure — both now run with existence guards
- **Fixed:** `CacheService.getStats()` destructured `database.raw()` result incorrectly for pg driver — returns `{ rows }` not array
- **Removed:** Temporary diagnostic endpoints (`/api/migrate-status`, `/api/run-migrations`)
- **Files touched:** migrations/20260401300000, migrations/20260401400000, CacheService.js, index.js
- **Notes:** Migrations now recorded in knex_migrations (batch 51). All /cache endpoints verified working on production.

---

## [2026-04-01] The Cache Phase 7 Part 1 — Backend
- **Added:** `the_cache` table with UUID PK, vehicle/part/yard fields, status lifecycle (claimed→listed/returned/deleted)
- **Added:** CacheService — claim, return, delete, resolve, stats, checkCacheStock
- **Added:** /cache routes — active, history, stats, claim, return, delete, resolve, check-stock
- **Added:** Manual entry via source='manual' (by PN or by YMM+description)
- **Changed:** YourDataManager.syncAll now runs cache auto-resolution after listing sync (4x/day)
- **Changed:** /cogs/check-stock returns cachedClaims alongside YourListing results
- **Changed:** /vin/scan returns cachedParts for scanned vehicle
- **Files touched:** migration (new), CacheService.js (new), routes/cache.js (new), YourDataManager.js, cogs.js, vin.js, index.js
- **Affects:** Stock checks (Nest Protector + Hawk Eye), VIN scanner, all puller tools
- **Notes:** Scout alert cross-linking: claim marks alert claimed, return re-activates. Phase 7 Part 2 (frontend) not yet built.

---

## [2026-04-01] Autolumen Multi-Store Integration
- **Added:** `store` column on YourListing and YourSale (default: 'dynatrack')
- **Added:** AutolumenImportService — CSV import for active listings, orders, and transaction reports
- **Added:** /autolumen routes (import/listings, import/sales, import/transactions, stats)
- **Added:** Collapsible Autolumen Sync card on Nest Protector (gate.html)
- **Added:** DYNATRACK/AUTOLUMEN store badges on stock check results
- **Changed:** YourDataManager deactivation sweep scoped to store='dynatrack'
- **Changed:** StaleInventoryService scoped to store='dynatrack'
- **Changed:** check-stock API now returns `store` field on results
- **Files touched:** migration (new), AutolumenImportService.js (new), routes/autolumen.js (new), YourDataManager.js, cogs.js, gate.html, StaleInventoryService.js, index.js, package.json
- **Affects:** Stock checks, attack list scoring, restock flags, overstock watch, stale inventory automation
- **Notes:** All existing services automatically see both stores — no store filter in AttackListService. StaleInventoryService and YourDataManager are the only places scoped to dynatrack.

---

## [2026-04-01] Workflow Infrastructure
- **Added:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Purpose:** Prevent Claude Code sessions from overwriting each other's work
- **Files:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Notes:** Every future session reads these files first before touching code

---

<!-- TEMPLATE FOR NEW ENTRIES (copy and fill in at top of file):

## [YYYY-MM-DD] Short Description
- **Changed:** What was modified
- **Added:** What was created
- **Fixed:** What bugs were resolved
- **Files touched:** List every file modified
- **Affects:** What downstream features are impacted
- **Notes:** Anything the next session needs to know

-->
