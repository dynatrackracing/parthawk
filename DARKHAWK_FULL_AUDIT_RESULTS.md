# DARKHAWK FULL SYSTEM AUDIT

**Date:** 2026-03-31
**Auditor:** Claude Code (automated code + live endpoint analysis)
**Scope:** Every frontend page, route, service, cron job, data flow, and database spot check

---

## TABLE OF CONTENTS

1. [Frontend Pages](#step-1--frontend-pages-audit)
2. [Route Handlers](#step-2--route-handlers-audit)
3. [Services](#step-3--services-audit)
4. [Cron / Scheduled Tasks](#step-4--cron--scheduled-tasks-audit)
5. [Data Flow Traces](#step-5--data-flow-audit)
6. [Database Spot Check](#step-6--database-spot-check)
7. [Dead Code Identification](#step-7--dead-code-identification)
8. [Summary](#summary)

---

## STEP 1 — FRONTEND PAGES AUDIT

### Navigation Structure (dh-nav.js)

**FIELD row** (5 pages): Daily Feed, Scout Alerts, Hawk Eye, Nest Protector, The Flyway
**INTEL row** (10 pages): Scour Stream, The Quarry, Sky Watch, Hunters Perch, The Mark, Velocity, Instincts, Prey-Cycle, Carcass (hidden), Phoenix

---

### DAILY FEED — attack-list.html
- **Nav location:** FIELD → `feed` → `/admin/pull`
- **API calls:**
  - `GET /attack-list` (optional `?since=` ISO date)
  - `GET /attack-list/vehicle/{id}/parts`
  - `POST /attack-list/log-pull`
  - `POST /attack-list/manual`
  - `GET /part-location/{partType}/{make}/{model}/{year}?trim=`
  - `POST /part-location/confirm`
  - `POST /part-location/flag-wrong`
  - `POST /yards/scrape/lkq`
  - `GET /yards/scrape/status`
  - `POST /yards/scrape/{yardId}`
  - `POST /vin/decode-photo`
  - `POST /vin/scan`
- **UI features:** Yard-tabbed scored vehicle list. Date filter (today/3d/7d/30d/60d/all). Expandable vehicles with part-level detail, market data, price freshness, dead inventory warnings, trim parts validation, platform siblings, rebuild reference, part location research. Inline VIN scanner. Manual set list paste.
- **User actions:** Tab by yard, filter by date, expand vehicles, scrape yards, paste manual set list, scan VIN, mark parts pulled, skip parts, add notes, confirm/flag part locations.
- **Issues:**
  - `btn-pull`, `btn-skip`, `btn-note` CSS is `display:none` — action buttons are hidden and never shown. Pull/skip/note feature appears dead/disabled.
  - `pd-actions` class also `display:none` — entire part-level action bar invisible.
  - ~1250 lines — very large monolithic file.

---

### SCOUT ALERTS — scout-alerts.html
- **Nav location:** FIELD → `alerts` → `/admin/scout-alerts`
- **API calls:**
  - `GET /scout-alerts/list?page=&yard=&days=&hideClaimed=`
  - `POST /scout-alerts/claim`
  - `POST /scout-alerts/refresh`
- **UI features:** Alert cards grouped by yard. Summary bar (Quarry/Perch/Just Sold/Yards counts). Time filter pills. Yard tabs. Pagination. Claim checkbox.
- **User actions:** Filter by yard, filter by time, toggle "hide pulled", claim/unclaim, refresh alerts.
- **Issues:** No error handling on `claimAlert` — only catches network errors, not HTTP status.

---

### HAWK EYE — vin-scanner.html
- **Nav location:** FIELD → `vin` → `/admin/vin`
- **API calls:**
  - `POST /vin/scan`
  - `POST /vin/decode-photo`
  - `GET /api/instant-research?vehicle=&drivetrain=`
  - `GET /vin/history?limit=10`
- **UI features:** VIN input with decode. Camera capture with OCR. Parts intelligence table with pull recommendations. Estimated haul value. Rebuild reference. Sales history. Standalone vehicle research by name. Scan history.
- **User actions:** Enter VIN, take photo for OCR, decode VIN, run instant research, research arbitrary vehicle, view scan history.
- **Issues:** In `processVinPhoto`, second `ctx.drawImage(img, ...)` attempted after `img.src = ''` in fallback path — will fail.

---

### NEST PROTECTOR — gate.html
- **Nav location:** FIELD → `gate` → `/admin/gate`
- **API calls:**
  - `GET /cogs/yards`
  - `GET /cogs/yard-profile/{id}`
- **UI features:** Yard selector. COGS calculator with hero summary card. Per-part market value and COGS inputs. Color-coded progress bar. Breakdown card.
- **User actions:** Select yard, add/remove parts, edit COGS per part.
- **Issues:** No error handling on fetch. Custom yard creates $0 defaults.

---

### THE FLYWAY — flyway.html
- **Nav location:** FIELD → `flyway` → `/admin/flyway`
- **API calls:**
  - `GET /flyway/trips` (optional `?status=`)
  - `POST /flyway/trips`
  - `PATCH /flyway/trips/{id}`
  - `DELETE /flyway/trips/{id}`
  - `GET /flyway/available-yards`
  - `POST /flyway/trips/{id}/yards`
  - `DELETE /flyway/trips/{id}/yards/{yardId}`
  - `GET /flyway/trips/{id}/attack-list`
  - `POST /flyway/trips/{id}/scrape`
  - `GET /flyway/trips/{id}/scrape-status`
  - `POST /flyway/trips/{id}/reinstate`
  - `GET /flyway/vehicle/{id}/parts`
- **UI features:** Three-view layout (Plan/Active/History). Trip creation with day/road-trip toggle. Yard selector with distance tiers. Active trip with yard tabs, vehicle scoring, part expansion. Trip history with reinstate.
- **User actions:** Create/edit/complete/reinstate trips. Select yards. Scrape. Expand vehicles. Sort/filter.
- **Issues:** ~1050 lines. `api()` helper never checks `res.ok`. Duplicated `cleanModel()`/`LKQ_CODES` with attack-list.html.

---

### SCOUR STREAM — restock-list.html
- **Nav location:** INTEL → `scour` → `/admin/restock-list`
- **API calls:**
  - `GET /restock-want-list/watchlist`
  - `POST /restock-want-list/watchlist/add`
  - `POST /restock-want-list/watchlist/remove`
  - `GET /restock-want-list/items?manual_only=true`
  - `POST /restock-want-list/add`
  - `POST /restock-want-list/delete`
  - `POST /restock-want-list/pull`
  - `POST /restock-want-list/find-in-yard`
  - `GET /restock-want-list/just-sold`
- **UI features:** Two-tab: WATCHLIST (PN tracking with stock/market data) and WANT LIST (manual entries with confidence tiers). Just Sold section. Yard search.
- **User actions:** Add/remove watchlist, add/delete want list, mark pulled, find in yard.
- **Issues:** `load()` fires unconditionally on page load even when watchlist tab is active.

---

### THE QUARRY — restock.html
- **Nav location:** INTEL → `quarry` → `/admin/restock`
- **API calls:**
  - `GET /restock/report?days={n}`
  - `GET /restock/found-items`
- **UI features:** Restock report with green/yellow/orange tiers. Summary stats. Period selector. Found items with FOUND banner.
- **User actions:** Switch period, toggle "hide found".
- **Issues:** None significant.

---

### SKY WATCH — opportunities.html
- **Nav location:** INTEL → `sky` → `/admin/opportunities`
- **API calls:**
  - `GET /opportunities?sort={sort}`
  - `POST /opportunities/dismiss`
  - `POST /opportunities/undismiss`
  - `GET /opportunities/dismissed`
- **UI features:** Scored opportunity cards with market data. Sort buttons. Expandable score breakdown. Dismiss/restore.
- **User actions:** Sort, expand, dismiss, restore.
- **Issues:** Server sort param only used on initial load; subsequent sorts are client-side only.

---

### HUNTERS PERCH — hunters-perch.html
- **Nav location:** INTEL → `perch` → `/admin/hunters-perch`
- **API calls:**
  - `GET /competitors/sellers`
  - `GET /competitors/{name}/best-sellers?days=90`
  - `POST /competitors/{name}/scrape`
  - `DELETE /competitors/{name}`
  - `GET /competitors/gap-intel?days=90&limit=30&seller=`
  - `GET /competitors/emerging?days=90&limit=30&seller=`
  - `POST /competitors/mark`
  - `POST /competitors/dismiss`
  - `POST /competitors/auto-scrape`
- **UI features:** Gap intel. Emerging parts. Competitor seller list with expandable best-sellers. Seller filter. eBay links.
- **User actions:** Add/remove/scrape sellers. Mark items. Dismiss intel. Filter by seller.
- **Issues:**
  - Scrape polling `setInterval` never cleared on navigation.
  - `esc()` function uses fragile `replace(/'/g, "\\'")` in onclick — XSS risk.

---

### THE MARK — the-mark.html
- **Nav location:** INTEL → `mark` → `/admin/the-mark`
- **API calls:** None (iframe-only page)
- **UI features:** Full-page iframe embedding `https://listcleaner.dynatrackracingnc.workers.dev`.
- **Issues:** Entirely external dependency. No fallback if Worker is down.

---

### VELOCITY — velocity.html
- **Nav location:** INTEL → `velocity` → `/admin/velocity`
- **API calls:**
  - `GET /demand-analysis/health`
  - `GET /demand-analysis/public/velocity?days={n}`
  - `GET /demand-analysis/public/sell-through?days={n}`
  - `GET /demand-analysis/public/top-performers?limit=25&days={n}`
- **UI features:** Health score. Sell-through percentage. Listing count. Sales metrics. Weekly bar chart. Top performers table.
- **User actions:** Switch time period.
- **Issues:** `setPeriod()` uses implicit `event` global — non-standard.

---

### INSTINCTS — instincts.html
- **Nav location:** INTEL → `instincts` → `/admin/instincts`
- **API calls:**
  - `GET /intelligence/learnings`
  - `GET /return-intelligence/summary`
  - `GET /return-intelligence/by-part-type`
  - `GET /return-intelligence/monthly-trend`
  - `GET /return-intelligence/by-make`
  - `GET /return-intelligence/repeat-returners`
  - `GET /return-intelligence/inad`
  - `GET /return-intelligence/high-value-alerts`
  - `GET /return-intelligence/problem-parts`
- **UI features:** Dead inventory patterns. Full Return Intelligence dashboard with charts.
- **Issues:** 9 parallel API calls on load. Chart.js from CDN. No caching.

---

### PREY-CYCLE — prey-cycle.html
- **Nav location:** INTEL → `prey-cycle` → `/admin/prey-cycle`
- **API calls:**
  - `GET /intelligence/lifecycle?days={n}`
  - `GET /intelligence/seasonal`
- **UI features:** Part lifecycle (revenue, sales, avg days to sell, decay, return rate). Seasonal (monthly chart, peak/slow, DoW, quarterly).
- **Issues:** `showTab()`/`loadLifecycle()` use implicit `event` global.

---

### CARCASS — stale-inventory.html
- **Nav location:** INTEL → `carcass` → `/admin/carcass` (HIDDEN via CSS `display:none !important`)
- **API calls:**
  - `GET /stale-inventory/candidates`
  - `GET /stale-inventory/actions?limit=50`
  - `POST /stale-inventory/revise-price`
  - `POST /stale-inventory/end-item`
  - `POST /stale-inventory/relist-item`
  - `POST /stale-inventory/bulk-end`
  - `POST /stale-inventory/run`
- **UI features:** Stale listing candidates with recommendations. History tab. Bulk end.
- **Issues:** Hidden from nav but functional at direct URL.

---

### PHOENIX — phoenix.html
- **Nav location:** INTEL → `phoenix` → `/admin/phoenix`
- **API calls:**
  - `GET /phoenix/sellers`
  - `POST /phoenix/sellers`
  - `DELETE /phoenix/sellers/{name}`
  - `POST /phoenix/sellers/{name}/scrape`
  - `GET /phoenix/stats?days=&limit=&seller=`
  - `GET /phoenix?days=&limit=&seller=`
- **UI features:** Rebuild candidate intelligence. Stats cards. Seller management. Phoenix score (PRIME/SOLID/WATCH/LOW).
- **Issues:** Stats section catches errors silently.

---

### Non-Nav Pages

| File | Purpose | Status |
|------|---------|--------|
| `import.html` | eBay CSV import tool | Working standalone |
| `listing-tool.html` | Listing generator v1 | **SECURITY: Anthropic API key exposed client-side** |
| `listing-tool-v2.html` | Listing generator v2 | **SECURITY: Same API key exposure** |
| `test.html` | Debug page | Diagnostic only |
| `alerts.html` | Old placeholder | **DEAD** — superseded by scout-alerts.html |
| `competitors.html` | Old placeholder | **DEAD** — superseded by hunters-perch.html |
| `sales.html` | Old placeholder | **DEAD** — superseded by restock.html |

---

## STEP 2 — ROUTE HANDLERS AUDIT

### competitors.js — mounted at /competitors
- **Endpoints:**
  - `POST /competitors/scan` — CompetitorMonitorService.scan()
  - `GET /competitors/alerts` — CompetitorMonitorService.getAlerts()
  - `POST /competitors/alerts/:id/dismiss` — dismiss alert
  - `GET /competitors/gap-intel` — parts competitors sell that we never sold/stocked (reads SoldItem, YourSale, YourListing, Item, dismissed_intel)
  - `GET /competitors/emerging` — new/accelerating competitor parts
  - `POST /competitors/cleanup` — purge old SoldItem records
  - `POST /competitors/auto-scrape` — scrape all enabled sellers
  - `POST /competitors/dismiss` — dismiss gap-intel item (writes dismissed_intel)
  - `POST /competitors/mark` — add to the_mark
  - `GET /competitors/marks` — active marks enriched with yard/inventory/sold status
  - `DELETE /competitors/mark/:id` — remove from the_mark
  - `PATCH /competitors/mark/:id` — update notes
  - `POST /competitors/mark/graduate` — auto-graduate marks you've sold
  - `GET /competitors/mark/check-vehicle` — check make/model against active marks
  - `POST /competitors/seed-defaults` — add default sellers
  - `DELETE /competitors/:sellerId` — remove seller + data
  - `POST /competitors/:sellerId/scrape` — trigger scrape
  - `GET /competitors/:sellerId/best-sellers` — best sellers report
  - `GET /competitors/sellers` — list tracked sellers
- **Auth:** NONE on any endpoint
- **Issues:**
  - **CRITICAL BUG: `matchesAny()` is called on lines 639, 640, 936 but NEVER DEFINED anywhere in the codebase.** `GET /competitors/marks` and `graduateMarks()` will throw `ReferenceError` at runtime.
  - No auth on destructive endpoints (cleanup deletes data, delete removes sellers).
  - Inline cron job at bottom of file (Sunday 8pm competitor scrape).

---

### scout-alerts.js — mounted at /scout-alerts
- **Endpoints:**
  - `GET /scout-alerts/list` — paginated alerts with yard/time filters
  - `POST /scout-alerts/claim` — claim/unclaim (syncs with restock_want_list)
  - `POST /scout-alerts/refresh` — regenerate alerts
- **Auth:** NONE
- **Issues:** Dead code in baseQuery construction (overwritten by applyFilters).

---

### attack-list.js — mounted at /attack-list
- **Endpoints:**
  - `GET /attack-list/` — full attack list across all yards
  - `GET /attack-list/vehicle/:id/parts` — parts for single vehicle
  - `GET /attack-list/yard/:yardId` — attack list for specific yard
  - `GET /attack-list/summary` — quick yard opportunity summary
  - `POST /attack-list/log-pull` — log a part pull
  - `POST /attack-list/visit-feedback` — log yard visit feedback
  - `GET /attack-list/last-visit/:yardId` — most recent visit feedback
  - `POST /attack-list/manual` — parse raw text + score vehicles
- **Auth:** NONE
- **Issues:** `/manual` does N+1 NHTSA API calls per VIN.

---

### instant-research.js — mounted at /api/instant-research
- **Endpoints:**
  - `GET /api/instant-research/` — database-only vehicle research
  - `GET /api/instant-research/quick` — alias
  - `GET /api/instant-research/years` — distinct years
  - `GET /api/instant-research/makes` — distinct makes
  - `GET /api/instant-research/models` — distinct models
  - `GET /api/instant-research/engines` — distinct engines
- **Auth:** NONE
- **Issues:** `/quick` uses non-standard `router.handle(req, res)` pattern.

---

### vin.js — mounted at /vin
- **Endpoints:**
  - `POST /vin/decode-photo` — Claude Vision OCR → NHTSA decode
  - `POST /vin/scan` — full VIN decode with parts intelligence + AI research
  - `GET /vin/history` — recent scan history
- **Auth:** NONE
- **External APIs:** Anthropic Claude (Vision + Sonnet), NHTSA
- **Issues:** `/decode-photo` is a cost vector (Claude API) without auth. `/scan` is ~400 lines in one handler.

---

### opportunities.js — mounted at /opportunities
- **Endpoints:**
  - `GET /opportunities/` — scored opportunity list
  - `POST /opportunities/dismiss`
  - `POST /opportunities/undismiss`
  - `GET /opportunities/dismissed`
- **Auth:** NONE

---

### restock-want-list.js — mounted at /restock-want-list
- **Endpoints:**
  - `GET /restock-want-list/debug/:id`
  - `GET /restock-want-list/items` — active want list with stock counts
  - `GET /restock-want-list/just-sold` — perch items sold in last 3 days
  - `POST /restock-want-list/pull` — toggle pulled status
  - `POST /restock-want-list/find-in-yard`
  - `POST /restock-want-list/add`
  - `POST /restock-want-list/delete`
  - `GET /restock-want-list/watchlist`
  - `POST /restock-want-list/watchlist/add`
  - `POST /restock-want-list/watchlist/remove`
  - `POST /restock-want-list/watchlist/update`
- **Auth:** NONE
- **Issues:** Runtime DDL (`CREATE TABLE IF NOT EXISTS` for watchlist). N+1 queries on `/items`.

---

### restockReport.js — mounted at /restock
- **Endpoints:**
  - `GET /restock/report` — scored restock recommendations
  - `GET /restock/found-items` — claimed scout alerts for quarry items
- **Auth:** NONE
- **Issues:** Exposes `err.stack` in error responses. ~160 lines of inline scoring logic.

---

### yards.js — mounted at /yards
- **Endpoints:**
  - `GET /yards/ping`, `GET /yards/`, `GET /yards/:id/vehicles`
  - `POST /yards/scrape/lkq`, `GET /yards/scrape/status`, `POST /yards/scrape/:id`
  - `GET /yards/status`, `POST /yards/:id/feedback`
- **Auth:** NONE
- **Scrapers:** LKQ, Foss, PullAPart, CarolinaPNP, UPullAndSave, Chesterfield, PickAPartVA
- **Issues:** Anyone can trigger resource-intensive browser scrapes. In-memory scrape status not per-yard.

---

### stale-inventory.js — mounted at /stale-inventory
- **Endpoints:**
  - `POST /stale-inventory/run` — trigger automation
  - `GET /stale-inventory/actions`, `GET /stale-inventory/candidates`
  - `POST /stale-inventory/revise-price` — **LIVE eBay price change**
  - `POST /stale-inventory/end-item` — **LIVE eBay listing end**
  - `POST /stale-inventory/relist-item` — **LIVE eBay relist**
  - `POST /stale-inventory/bulk-end` — **LIVE eBay bulk end**
  - Returns endpoints: `POST /returns`, `GET /returns/pending`, `POST /returns/:id/relisted`, `POST /returns/:id/scrapped`
  - Restock endpoints: `POST /restock/scan`, `GET /restock/flags`, `POST /restock/:id/acknowledge`
- **Auth:** NONE
- **Issues:** **CRITICAL: eBay-mutating endpoints (revise-price, end-item, relist-item, bulk-end) are unauthenticated.** Anyone can modify real eBay listings.

---

### listing-tool.js — mounted at /api/listing-tool
- **Endpoints:**
  - `GET /api/listing-tool/ebay-lookup` — scrape eBay listing
  - `GET /api/listing-tool/parts-lookup` — fitment lookup
  - `POST /api/listing-tool/save-fitment` — write fitment
  - `GET /api/listing-tool/intelligence` — aggregated intelligence
  - `POST /api/listing-tool/save-listing-intel` — persist fitment/programming
- **Auth:** NONE
- **Issues:** Runtime DDL. Duplicated upsert SQL.

---

### flyway.js — mounted at /flyway
- **Endpoints:** Full CRUD for trips/yards, attack-list, vehicle parts, scrape trigger/status, active-yards, available-yards
- **Auth:** NONE
- **Issues:** Vehicle parts handler is ~80 lines duplicated from attack-list.js.

---

### phoenix.js — mounted at /phoenix
- **Endpoints:** Main list, stats, seller CRUD, seller scrape
- **Auth:** NONE

---

### sync.js — mounted at /sync
- **Auth:** MIXED — older endpoints use authMiddleware+isAdmin; newer ones are OPEN
- **Issues:**
  - **CRITICAL: `POST /sync/configure-ebay` is open.** Anyone can set eBay API credentials via `process.env`.
  - **CRITICAL: `POST /sync/trigger` is open.** Anyone can trigger full eBay data sync.
  - **CRITICAL: Import endpoints (`import-items`, `import-sales`, `import-listings`) are open.** Unauthenticated bulk writes to core tables.

---

### ebay-messaging.js — mounted at /ebay-messaging
- **Endpoints:** status, history, templates, poll, process, test-send
- **Auth:** NONE
- **Issues:** **CRITICAL: `POST /test-send` sends real eBay messages to buyers without auth.**

---

### Other Routes (abbreviated)

| Route | Mount | Auth | Notes |
|-------|-------|------|-------|
| items.js | /items | ✅ authMiddleware | Route ordering bug: `/lookup/search` shadowed by `/:id` |
| cron.js | /cron | ✅ authMiddleware+isAdmin | **BUG: Never sends response — hangs** |
| autos.js | /autos | ✅ authMiddleware | Clean |
| user.js | /users | ✅ mostly | **BUG: `DELETE ':/id'` typo — unreachable** |
| filters.js | /filters | ✅ authMiddleware | Clean |
| intelligence.js | /intelligence | Mixed | Newer endpoints open |
| market-research.js | /market-research | ✅ authMiddleware | Clean |
| pricing.js | /pricing | ✅ authMiddleware | Clean |
| demand-analysis.js | /demand-analysis | Mixed | Public DarkHawk endpoints open |
| price-check.js | /price-check | ❌ NONE | Uses `express.Router()` instead of promise router |
| cogs.js | /cogs | ❌ NONE | |
| partsLookup.js | /api/parts | ❌ NONE | |
| parts.js | /api/parts | ❌ NONE | Route conflict with partsLookup.js on `/lookup` |
| fitment.js | /api/fitment | ❌ NONE | Wide-open CORS (`*`) |
| part-location.js | /part-location | ❌ NONE | Claude API cost vector |
| trim-intelligence.js | /trim-intelligence | ❌ NONE | Claude API cost vector |
| return-intelligence.js | /return-intelligence | ❌ NONE | |
| private.js | /private | Mixed | **BUG: `/cache/flush` never sends response** |

---

## STEP 3 — SERVICES AUDIT

### AttackListService.js
- **Purpose:** Scores junkyard vehicles by pull value using inventory matching, sales history, stock levels, and trim tier multipliers.
- **Reads:** `Auto`, `AutoItemCompatibility`, `Item`, `YourSale`, `YourListing`, `the_mark`, `market_demand_cache`
- **Writes:** None (read-only scoring)
- **External APIs:** None
- **Key logic:** Builds in-memory indexes (inventory by make|model|year, sales by make|model, stock by make|model and PN). Scores per part: recency-weighted sale prices, stock levels, trim tier multiplier, platform siblings. 10-minute TTL on index caches. Excludes complete engines/transmissions/body panels/transfer cases.
- **Issues:** `_validationCache` declared but never used. `platformIndex` passed as `{}` from `getAttackList()` — no platform match in single-yard mode.

### ScoutAlertService.js
- **Purpose:** Matches restock want-list items and recent sold parts against active yard vehicles to generate pull alerts.
- **Reads:** `yard_vehicle` (join `yard`), `restock_want_list`, `YourSale`, `Auto`
- **Writes:** `scout_alerts` (truncate + insert), `scout_alerts_meta`
- **Key logic:** Two sources: "Scour Stream" (manual want list) and "Bone Pile" (YourSale last 60d, >= $50). Make must match, model word-boundary match, strict year-range.
- **Issues:** `truncate()` with no transaction — crash mid-insert loses all alerts.

### CompetitorMonitorService.js
- **Purpose:** Compares own active listings against competitor items/market data to generate pricing alerts.
- **Reads:** `YourListing`, `Item`, `market_demand_cache`, `competitor_alert`
- **Writes:** `competitor_alert`
- **Key logic:** Flags own listings < 75% of market avg as "underpriced". Flags competitors < 70% of our price as "competitor_undercut". 7-day dedup window.

### OpportunityService.js (Sky Watch)
- **Purpose:** Surfaces parts with strong eBay demand that we've never sold and don't stock.
- **Reads:** `market_demand_cache`, `YourListing`, `YourSale`, `dismissed_opportunity`
- **Writes:** None
- **Key logic:** Scores: demand 40%, price 30%, velocity+scarcity 30%. Excludes complete engines/transmissions/body panels. Sold-before exclusion uses 0.8 word overlap. Floor: median >= $300 = min score 75.
- **Issues:** N+1 query pattern for non-PN cache entries.

### InstantResearchService.js (Hawk Eye)
- **Purpose:** Given year/make/model/engine, finds all compatible parts via Auto+AIC+Item, enriches with demand/stock/market/mark data. 24h cache.
- **Reads:** `Auto`, `AutoItemCompatibility`, `Item`, `YourSale`, `YourListing`, `market_demand_cache`, `the_mark`, `instant_research_cache`
- **Writes:** `instant_research_cache`
- **Issues:** N+1 queries per part for YourSale matching.

### MarketPricingService.js
- **Purpose:** Batch market pricing engine — deduplicates parts by PN, checks cache, scrapes eBay sold comps for uncached, stores in `market_demand_cache`.
- **Reads/Writes:** `market_demand_cache`
- **External APIs:** eBay sold listings (via PriceCheckServiceV2, fallback V1 Playwright)
- **Issues:** 90-day cache TTL (2160 hours) is very long. Circular dependency with AttackListService (both lazy-require each other).

### PriceCheckService.js (V1 — Playwright)
- **Purpose:** Scrapes eBay sold listings using persistent Playwright/Chromium browser.
- **Reads/Writes:** `PriceCheck`, `market_demand_cache`, `PriceSnapshot`
- **Issues:** Heavy for Railway (OOM risk). Persistent browser singleton with no cleanup. Fragile CSS selectors.

### PriceCheckServiceV2.js (V2 — axios+cheerio)
- **Purpose:** Lightweight V1 replacement — HTTP requests + HTML parsing instead of Chromium.
- **Reads:** None (stateless)
- **Issues:** Fragile CSS selectors. JSON regex fallback could match non-listing data.

### StaleInventoryService.js
- **Purpose:** Automated tiered price reductions on stale eBay listings via Trading API.
- **Reads:** `YourListing`, `stale_inventory_action`, `market_demand_cache`, `YourSale`
- **Writes:** `YourListing`, `stale_inventory_action`
- **External APIs:** eBay Trading API `ReviseItem`
- **Key logic:** Standard: -10% at 60d → -30% at 270d. Programmed: -5% at 90d → -15% at 270d. Floor $9.99. No comps = hold.
- **Issues:** No XML escaping on Trading API token.

### DeadInventoryService.js
- **Purpose:** Identifies stale listings and logs unsellable items to `dead_inventory`.
- **Reads:** `YourListing`, `SoldItem`, `Item`, `YourSale`, `market_demand_cache`, `dead_inventory`
- **Writes:** `dead_inventory`
- **Issues:** `getMarketDemandData()` and `getCompetitorData()` methods exist but are never called — dead code. `scanAndLog` scans `Item` table (competitor data) not `YourListing` — likely semantic mismatch.

### RestockService.js
- **Purpose:** Identifies parts needing restocking based on sales velocity vs stock.
- **Reads:** `YourSale`, `YourListing`, `restock_flag`
- **Writes:** `restock_flag`
- **Key logic:** Rule: sold >= 2x active stock in 90d triggers flag.
- **Issues:** None significant.

### FlywayService.js
- **Purpose:** Road trip CRUD, filtered attack lists for trip yards, post-trip cleanup.
- **Reads:** `flyway_trip`, `flyway_trip_yard`, `yard`, `yard_vehicle`, `the_mark`
- **Writes:** `flyway_trip`, `flyway_trip_yard`, `yard_vehicle`
- **Issues:** `getCoreYardIds` has hardcoded yard names — will break silently if names change.

### PhoenixService.js
- **Purpose:** Analyzes rebuild competitor catalogs, cross-refs with sold data and market demand to identify profitable rebuild parts.
- **Reads:** `SoldItemSeller`, `Item`, `AutoItemCompatibility`, `Auto`, `SoldItem`, `market_demand_cache`
- **Writes:** `SoldItemSeller`
- **Issues:** Seller name mapping is hardcoded and not extensible.

### LearningsService.js
- **Purpose:** Aggregates patterns from dead inventory, returns, and stale price reductions.
- **Reads:** `dead_inventory`, `Item`, `AutoItemCompatibility`, `Auto`, `return_intake`, `stale_inventory_action`, `YourSale`
- **Issues:** **BUG: `getStaleOutcomes` filters by `action_type = 'REDUCE_PRICE'` but StaleInventoryService writes `action_type = 'price_reduction'` — stale outcomes will always return 0 results.**

### Other Services (abbreviated)

| Service | Purpose | Status |
|---------|---------|--------|
| COGSService.js | Gate negotiation COGS calculator | Working |
| TrimTierService.js | Trim tier lookup with fuzzy matching | Working well |
| TrimIntelligenceService.js | AI trim research via Claude web search | Working, no cache TTL |
| VinDecodeService.js | VIN decode with NHTSA caching | Redundant — PostScrapeService uses batch API |
| AutoService.js | Auto table CRUD + eBay Taxonomy | Working |
| ItemLookupService.js | Item table CRUD + search | Hardcoded price > $80 filter |
| FitmentIntelligenceService.js | Fitment negation analysis | Working |
| ListingIntelligenceService.js | Listing tool enrichment | Working |
| LifecycleService.js | Part lifecycle analytics | Working |
| DemandAnalysisService.js | Sales velocity/sell-through | Working |
| PricingService.js | Pricing recommendations | Working |
| PricePredictionService.js | ML-style price predictions | Working |
| PartLocationService.js | Part location via Claude AI | Working |
| ReturnIntelligenceService.js | Return analytics | Working |
| ReturnIntakeService.js | Return intake queue | Working |
| PostScrapeService.js | Universal post-scrape pipeline | Working |
| EbayMessagingService.js | Automated buyer messaging | Working |
| PartNumberService.js | PN normalization | Likely dead — duplicates lib/partNumberUtils |
| WhatToPullService.js | Pull recommendations | Legacy — superseded by OpportunityService |

---

## STEP 4 — CRON / SCHEDULED TASKS AUDIT

### Active Crons

| Name | Schedule | Handler | Status |
|------|----------|---------|--------|
| YourData Sync | `0 1,7,13,19 * * *` (every 6h) + startup stale check | YourDataManager.syncAll() | ✅ ACTIVE |
| Weekly Price Check | `0 2 * * 0` (Sun 2am) | PriceCheckCronRunner.work() | ✅ ACTIVE |
| Stale Inventory | `0 3 * * 3` (Wed 3am) | StaleInventoryService.runAutomation() | ✅ ACTIVE |
| Dead Inventory | `0 4 * * 1` (Mon 4am) | DeadInventoryService.scanAndLog() | ✅ ACTIVE |
| Restock Scan | `0 4 * * 2` (Tue 4am) | RestockService.scanAndFlag() | ✅ ACTIVE |
| Competitor Monitor | `0 4 * * 4` (Thu 4am) | CompetitorMonitorService.scan() | ✅ ACTIVE |
| Flyway Scrape | `0 6 * * *` (daily 6am) | FlywayScrapeRunner.work() | ✅ ACTIVE |
| eBay Messaging Poll | `*/15 * * * *` (every 15min) | EbayMessagingService.pollNewOrders() | ✅ ACTIVE |
| eBay Messaging Process | `*/2 * * * *` (every 2min) | EbayMessagingService.processQueue() | ✅ ACTIVE |
| Scout Alerts | 10s after boot + post-scrape | ScoutAlertService.generateAlerts() | ✅ ACTIVE |
| Competitor Scrape | `0 20 * * 0` (Sun 8pm) | competitors.js inline cron | ✅ ACTIVE |

### Disabled Crons

| Name | Schedule | Reason |
|------|----------|--------|
| eBay Seller Processing | `0 6 * * *` | Finding API dead since Feb 2025 |
| Market Demand Cache | `0 3 * * *` | Finding API dead since Feb 2025 |

### External Scripts

| Script | Schedule | Purpose |
|--------|----------|---------|
| scrape-local.js | External cron | Scrapes 7 LKQ yards via curl + Flyway LKQ yards |
| run-importapart-drip.js | External 3x/day | Fills market_demand_cache gaps (34 parts/run) |

---

## STEP 5 — DATA FLOW AUDIT

### Flow A: Competitor Scrape → Hunters Perch

```
POST /competitors/:sellerId/scrape
  → SoldItemsManager.scrapeCompetitor() [Playwright, scrapes eBay sold items]
  → writes to SoldItem table

GET /competitors/gap-intel
  → reads SoldItem (last N days, >= $100, excluding our sellers)
  → groups by normalized title
  → checks against YourSale, YourListing, Item (our stock)
  → checks dismissed_intel for exclusions
  → returns parts competitors sell that we never have
```

**Key finding:** Gap-intel does NOT read `the_mark`. Marking an item does NOT remove it from gap-intel results. Only dismissing (`POST /competitors/dismiss`) removes it.

### Flow B: Mark → Downstream Consumers

```
POST /competitors/mark → writes to the_mark table

Consumers that READ the_mark:
  ✅ AttackListService — +15 score boost for marked parts
  ✅ InstantResearchService — flags parts as isMarked
  ✅ FlywayService — score boost for Flyway planning

Do NOT read the_mark:
  ❌ ScoutAlertService
  ❌ restock-want-list (Scour Stream)
  ❌ restockReport (Quarry)
  ❌ OpportunityService (Sky Watch)
  ❌ gap-intel query
```

**Graduate:** `POST /competitors/mark/graduate` checks active marks against YourSale titles (0.8 word overlap). If matched, sets `active=false`, `graduatedReason='Sold - entered normal restock cycle'`. **BUT: `matchesAny()` is undefined — this function will crash at runtime.**

### Flow C: VIN Scan → Research

```
Camera photo → POST /vin/decode-photo [Claude Vision OCR]
Manual entry → POST /vin/scan
  → vin_cache check → NHTSA API decode → cache result
  → YourSale history, YourListing stock, Auto+AIC+Item market ref
  → Newer vehicles (2017+): Claude AI research → ai_vehicle_research cache
  → Logs to vin_scan_log
  → Returns parts intelligence with verdicts (PULL/WATCH/SKIP)

"Research Vehicle" button → GET /api/instant-research?vehicle=YEAR+MAKE+MODEL
  → InstantResearchService.researchVehicle()
  → instant_research_cache (24h TTL)
  → Full Auto+AIC+Item join, enriched with demand/stock/market/mark data
```

### Flow D: Scout Alerts Generation

```
ScoutAlertService.generateAlerts() [on boot + after every scrape]
  Sources:
    1. restock_want_list (manual, active=true)
    2. YourSale (last 60d, >= $50)
  
  For each source part × each yard_vehicle:
    - Make MUST match
    - Model word-boundary match
    - Year MUST be in range
    → writes to scout_alerts (truncate + insert)
  
  Does NOT read the_mark
```

### Flow E: Scour Stream vs Quarry

| | Scour Stream (restock-want-list) | The Quarry (restock/report) |
|---|---|---|
| **Source** | Manually curated want-list | Automated from YourSale data |
| **What** | "I want to stock this" | "You sold this, do you have more?" |
| **Table** | restock_want_list | YourSale + YourListing |
| **Reads the_mark?** | No | No |
| **Scoring** | Stock count (OUT/LOW/STOCKED) | Price/stock/demand/recency composite |

### Flow F: Sky Watch / Opportunities

```
GET /opportunities → OpportunityService.findOpportunities()
  → market_demand_cache (all entries with ebay_avg_price > 0)
  → excludes: items in YourListing (already stocked)
  → excludes: items in YourSale (already sold = belongs in Quarry)
  → excludes: dismissed_opportunity
  → scores by demand/price/velocity/scarcity
  
  Does NOT read the_mark
  Does NOT read instant_research_cache
  Independent system
```

---

## STEP 6 — DATABASE SPOT CHECK (Live)

All endpoints tested against `https://parthawk-production.up.railway.app` on 2026-03-31.

| Endpoint | Status | Result |
|----------|--------|--------|
| `GET /api/health-check` | 200 ✅ | Server up, env: production |
| `GET /competitors/marks` | 200 ✅ | **0 marks** — the_mark table is empty |
| `GET /competitors/sellers` | 200 ✅ | **8 sellers** tracked (gb-autoparts-inc, importapart, instrumentclusterstore, longspeakparts, modulemadness, prorebuild, recycleer, sonofabuzzard). prorebuild flagged "Never scraped" |
| `GET /scout-alerts/list` | 200 ✅ | **68 alerts** across 14 yards, all unclaimed |
| `GET /restock-want-list/items` | 200 ✅ | **408 items** with match confidence tiers |
| `GET /restock-want-list/watchlist` | 200 ✅ | **3 items** (Ford E-series ABS Pumps), zero stock |
| `GET /opportunities?sort=score` | 200 ✅ | **7 opportunities** (ECM, cluster, TCM, etc.) |
| `GET /competitors/gap-intel?days=90&limit=10` | 200 ✅ | **10 returned** (432 total gaps available) |
| `GET /stale-inventory/candidates` | 200 ✅ | **100 candidates**, all "deep_discount" recommendation |

---

## STEP 7 — DEAD CODE IDENTIFICATION

### Dead Files

| File | Reason |
|------|--------|
| `service/ebay/FindingsAPI.js` | eBay Finding API dead since Feb 2025 |
| `service/managers/SellerItemManager.js` | Only consumer (CronWorkRunner) is disabled |
| `service/lib/MarketDemandCronRunner.js` | Uses dead Finding API |
| `service/public/alerts.html` | Superseded by scout-alerts.html |
| `service/public/competitors.html` | Superseded by hunters-perch.html |
| `service/public/sales.html` | Superseded by restock.html |

### Orphaned Models (never imported)

| Model | Notes |
|-------|-------|
| `EbayMessage.js` | EbayMessagingService uses raw knex instead |
| `EbayMessageQueue.js` | Same |
| `EbayMessageTemplate.js` | Same |
| `TrimValueValidation.js` | Not imported anywhere |

### Likely Dead Services

| Service | Notes |
|---------|-------|
| `PartNumberService.js` | Duplicates `lib/partNumberUtils` which is used everywhere else |
| `WhatToPullService.js` | Legacy — uses `SoldItem.compatibility` JSONB (unusual), superseded by OpportunityService |

### Dead Environment Variables

| Variable | Notes |
|----------|-------|
| `FINDINGS_APP_NAME` | Only used by dead FindingsAPI/MarketDemandCronRunner |
| `RUN_JOB_NOW` | Commented out |

### Dead Code Within Active Files

| Location | Issue |
|----------|-------|
| `DeadInventoryService.getMarketDemandData()` | Method exists but never called |
| `DeadInventoryService.getCompetitorData()` | Method exists but never called |
| `AttackListService._validationCache` | Declared but never used |
| `scout-alerts.js` baseQuery (line 22-45) | Built but overwritten by applyFilters |

---

## SUMMARY

### Working Well (no changes needed)
- **Daily Feed** (attack-list.html + AttackListService) — core scoring engine is solid
- **The Flyway** (flyway.html + FlywayService) — trip planning and road trip scoring working
- **Nest Protector** (gate.html + COGSService) — COGS calculator functional
- **The Quarry** (restock.html + restockReport) — sales-driven restock recommendations working
- **Velocity** (velocity.html + DemandAnalysisService) — analytics dashboard working
- **Prey-Cycle** (prey-cycle.html + LifecycleService) — lifecycle analytics working
- **Phoenix** (phoenix.html + PhoenixService) — rebuild intelligence working
- **TrimTierService** — well-designed fuzzy matching, used throughout
- **PostScrapeService** — universal enrichment pipeline, clean architecture
- **EbayMessagingService** — queue-based messaging with proper retry logic
- **YourData Sync cron** — eBay order/listing sync working every 6h
- **scrape-local.js** — LKQ yard scraping pipeline functional

### Working But Needs Fixes
- **Hunters Perch** — gap-intel and competitor scraping work, but `matchesAny()` bug will crash `/competitors/marks` and `graduateMarks()`
- **Scout Alerts** — generating 68 alerts, but truncate-without-transaction risks data loss on crash
- **Scour Stream** — 408 items with N+1 query pattern (performance concern at scale)
- **Sky Watch** — returning 7 opportunities, but N+1 queries in OpportunityService
- **Hawk Eye** — VIN scan works but `/scan` handler is 400 lines, photo OCR has image re-use bug
- **Instincts** — 9 parallel API calls on load, Learnings stale outcomes always empty (action_type mismatch)
- **Carcass** — functional but hidden from nav via CSS; 100 candidates all showing "deep_discount"
- **Stale Inventory automation** — working cron, but no XML escaping on eBay API token

### Broken (needs repair)
- **`matchesAny()` undefined** — `GET /competitors/marks` and `graduateMarks()` throw ReferenceError. The Mark enrichment and auto-graduate are non-functional.
- **`LearningsService.getStaleOutcomes`** — filters by `'REDUCE_PRICE'` but service writes `'price_reduction'` — always returns 0 results
- **`GET /cron/`** — never sends response, hangs indefinitely
- **`GET /private/cache/flush`** — never sends response, creates global variable
- **`DELETE /users/:id`** — typo `':/id'` means route never matches
- **`GET /items/lookup/search`** — shadowed by `GET /items/:id` (Express matches `:id` = "lookup")
- **Pull/Skip/Note buttons** in Daily Feed — CSS `display:none` with no JS to show them

### Dead Code (can be removed or repurposed)
- `FindingsAPI.js`, `SellerItemManager.js`, `MarketDemandCronRunner.js` — eBay Finding API dead
- `alerts.html`, `competitors.html`, `sales.html` — old placeholder pages
- `PartNumberService.js` — duplicates `lib/partNumberUtils`
- `WhatToPullService.js` — superseded by OpportunityService
- `EbayMessage.js`, `EbayMessageQueue.js`, `EbayMessageTemplate.js`, `TrimValueValidation.js` — orphaned models
- `DeadInventoryService.getMarketDemandData()`/`getCompetitorData()` — never called
- `FINDINGS_APP_NAME` env var references

### Missing Connections (wiring needed)
- **the_mark → ScoutAlertService:** Marked parts should generate yard alerts, but ScoutAlertService doesn't read the_mark. Only restock_want_list and YourSale are used as want sources.
- **the_mark → Scour Stream:** Marking a part in Hunters Perch doesn't add it to the Scour Stream want list. User must manually add it.
- **the_mark → Sky Watch:** Sky Watch doesn't know about marks. A marked part should either be excluded (already tracked) or boosted.
- **the_mark → gap-intel:** Marking a part doesn't remove it from gap-intel results. It keeps appearing until dismissed separately.
- **InstantResearch → Sky Watch:** Research results don't feed into opportunities. Discovered parts during VIN research are lost.
- **Carcass nav link:** Page is functional but hidden in CSS. Should be either shown or explicitly removed.

### Security Concerns
- **28 of 33 route files have unauthenticated endpoints.** The DarkHawk admin pages are open to anyone who knows the URL.
- **eBay-mutating endpoints are open:** `stale-inventory` (revise/end/relist), `ebay-messaging/test-send`, `sync/configure-ebay` can modify live eBay data without auth.
- **Anthropic API cost exposure:** `vin/decode-photo`, `vin/scan`, `part-location`, `trim-intelligence` trigger paid API calls without auth.
- **Client-side Anthropic API key:** `listing-tool.html` and `listing-tool-v2.html` make direct browser calls to `api.anthropic.com`.

### Key Questions for Owner
1. **Auth strategy:** Should DarkHawk endpoints get Firebase auth like the legacy PartHawk routes? Or is Railway's private networking sufficient?
2. **Pull/Skip/Note buttons:** Were these intentionally disabled in Daily Feed? If so, should the dead CSS/JS be cleaned up?
3. **Carcass page:** Should it be re-shown in the nav or is the Stale Inventory automation sufficient?
4. **the_mark integration:** Should marking a part in Hunters Perch auto-add it to the Scour Stream want list and/or Scout Alerts?
5. **Graduate bug:** The `matchesAny()` function is undefined — was this recently refactored? What should the matching logic be?
6. **Listing tool API key:** Should the Anthropic API calls be proxied through the backend to hide the key?
7. **prorebuild seller:** It's tracked but "never scraped" — should it be scraped or removed?
