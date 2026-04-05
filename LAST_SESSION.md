# LAST SESSION — 2026-04-05

## Sniper Overhaul
- Diagnosed: PriceCheckServiceV2 (axios+cheerio) completely blocked by eBay "Pardon Our Interruption" challenge page. HTTP 200 but 13K chars of captcha HTML, zero search results.
- Replaced dead cheerio scraper with Playwright+stealth (same config as working market drip)
- Filtered to NC pull yards only (Raleigh, Durham, Greensboro) — was scraping all 7 yards including FL
- Changed from 7-day rolling window to newest vehicles only (first_seen >= 24h, --hours flag for override)
- Dry run: 192 new vehicles → 1,073 PNs → 804 after sanitize → 731 need scraping → top 50 queued

## Attack List Price Floors
- PART_PRICE_FLOORS in AttackListService: ABS=$150, ECM/BCM/TCM/TIPM/CLUSTER/RADIO/THROTTLE/AMP=$100
- Mechanical parts (mirrors, visors, console lids) have no floor
- Below-floor parts excluded from vehicle score, shown greyed out (opacity 0.4) in collapsed "X parts below price floor" section
- Above-floor parts unchanged — GREAT/GOOD/FAIR/POOR badges work as before

## QUARRY Fix
- Frontend field name mismatch after backend rewrite: green/yellow/orange → critical/low/watch
- Row fields: sold7d→timesSold, activeStock→inStock, action→urgency
- Summary cards now show real numbers

## Cache ↔ Attack List Sync (3 iterations)
- Iteration 1: Pull button swaps to checkmark, greys out row. But didn't persist on reload — matching key was unreliable (partType|MAKE|MODEL fallback)
- Iteration 2: Proper architecture — GET /cache/claimed-keys endpoint returns normalized PNs + cache IDs. Frontend normalizePN() mirrors backend suffix stripping (Ford/Toyota/Honda/Chrysler). Two-key matching: PN primary, itemId fallback for no-PN parts (sunroof glass, mirrors). Backend dedup prevents duplicate claims.
- Iteration 3: Added item_id column to the_cache table for parts without part numbers. Migration + CacheService.claim() accepts itemId + dedup by itemId when no PN.
- Skip and Note buttons removal requested (confirm in next session)

## Scout Alerts Cache Sync
- Scout alerts now use same /cache/claimed-keys system as Daily Feed
- Three matching strategies: alert ID, normalized PN, itemId
- Cross-tool flow works: pull from Daily Feed → Scout Alerts shows checkmark, and vice versa
- Unclaim syncs both cache entry and scout_alert claimed field

## Architecture Confirmed
- Backend wiring for scout alert sources already complete:
  - THE MARK → ScoutAlertService reads the_mark ✅
  - THE QUARRY → quarrySync() pushes to restock_want_list → Scout Alerts reads it ✅
  - SCOUR STREAM → Scout Alerts reads restock_want_list ✅
  - Phoenix stays standalone ✅
- Hunters Perch → Mark link: NOT WORKING (fix pending)
- Sky Watch: needs Hawk Eye search to be functional first

## What's next — priority order
1. Verify Skip/Note buttons removed from attack list
2. Scout alert source badges on Daily Feed parts (🎯 MARK, 🔄 RESTOCK, etc.)
3. Fix Hunters Perch → Mark link
4. Hawk Eye search functionality (enables Sky Watch workflow)
5. Hawk Eye + Flyway cache sync (same claimed-keys pattern)
6. Let market drip keep filling cache (targeting 3,000+ PNs)
7. Stale inventory automation — validate pricing accuracy first

## Open tech debt
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitorService Thu 4am reads frozen SoldItem
- LifecycleService loads all YourSale into memory (watch at 50K+)
- The Mark table empty (adoption gap — Hunters Perch link broken)
- instrumentclusterstore scraper: 0 items, needs debug-scrape diagnosis
- MarketPricingService still references PriceCheckServiceV2 as fallback (dead on Railway too?)
