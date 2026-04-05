# SNAPSHOT_FRONTEND.md
Generated 2026-04-05

## Shared Components

### dh-nav.js
- Two-bar sticky nav: FIELD row (6 links, red active) + INTEL row (10 links, yellow active)
- Both rows centered (justify-content:center), Logout positioned absolute right
- Logo + "DARKHAWK" text links to /admin/home
- INTEL row hidden on mobile (max-width:768px), Carcass link hidden via CSS
- Usage: `<div id="dh-nav"></div><script src="/admin/dh-nav.js"></script><script>dhNav('feed')</script>`

**FIELD links:** feed, alerts, cache, vin, gate, flyway
**INTEL links:** scour, quarry, sky, perch, mark, velocity, instincts, prey-cycle, carcass, phoenix

### dh-parts.js + dh-parts.css (Part Value Utilities)
- **Loaded by:** all 6 field pages (attack-list, scout-alerts, cache, vin-scanner, gate, flyway)
- **CSS:** 6 tier classes (`.tier-elite` through `.tier-low`, `.tier-nodata`), `@keyframes pulse-gold`/`pulse-purple`, `.part-badge` base
- **JS functions:**
  - `getPartTier(price)` → `{ label, color, cssClass, pulses }` for 6 price tiers
  - `renderPriceBadge(price, prefix)` → HTML badge string with tier color
  - `isExcludedPart(title)` → true for engines/transmissions/body panels, false for modules/trim/glass
- **Tiers:** ELITE $500+ gold pulse, PREMIUM $350+ purple pulse, HIGH $250+ blue, SOLID $150+ green, BASE $100+ orange, LOW <$100 red
- **Exclusions:** complete engines/internals, complete transmissions, fenders, bumpers, hoods, door shells, quarter/rocker panels, bed sides, trunk lids, roof panels. ALLOWS all modules, trim, glass, lighting, steering, differentials.

---

## Field Pages

### attack-list.html (Daily Feed)
- **URL:** `/admin/pull`, `/puller`
- **Nav key:** `feed`
- **Features:** Vehicle scoring with color-coded score badges (green/yellow/orange), expandable vehicle rows with parts breakdown, yard scrape controls, VIN photo decode, manual vehicle add, scout alert claim inline, manual set list paste
- **Cache sync:** Loads `GET /cache/claimed-keys` on init. Stores `claimedPNs` (normalizedPN→cacheId) and `claimedItemIds` (itemId→cacheId) maps. `normalizePN()` mirrors backend suffix stripping (Ford/Toyota/Honda/Chrysler). `getCachedId(part)` checks PN first, falls back to itemId. Cached parts show green checkmark button + greyed row (opacity 0.55). Checkmark click unclaims via `POST /cache/:id/return`.
- **Part badges (6-tier):**
  - ELITE ($500+): pulsing gold (#FFD700) with soft glow animation
  - PREMIUM ($350-499): pulsing purple (#C39BD3) with soft glow animation
  - HIGH ($250-349): static blue (#3498DB)
  - SOLID ($150-249): static green (#2ECC40)
  - BASE ($100-149): static yellow (#F1C40F)
  - LOW (<$100): static red (#FF4136)
  - EST (estimate): maps to LOW/red style
- **Price floors:** Below-floor parts collapsed in greyed section (opacity 0.4), excluded from vehicle score
- **Skip/Note buttons:** Removed. Only Pull/Checkmark button remains per part row.
- **API:** `/attack-list`, `/attack-list/vehicle/:id/parts`, `/cache/claimed-keys`, `/cache/claim` (POST), `/cache/:id/return` (POST), `/part-location/:partType/:make/:model/:year`, `/part-location/confirm` (POST), `/part-location/flag-wrong` (POST), `/yards/scrape/lkq` (POST), `/yards/scrape/status`, `/yards/scrape/:yardId` (POST), `/scout-alerts/claim` (POST), `/attack-list/manual` (POST), `/vin/decode-photo` (POST), `/vin/scan` (POST)

### scout-alerts.html (Scout Alerts)
- **URL:** `/admin/scout-alerts`
- **Nav key:** `alerts`
- **Features:** Parts matching want lists at yards, claim/unclaim with cache sync, yard tabs, time filter pills, hide-pulled toggle, summary cards (MARK/QUARRY/STREAM/OVERSTOCK/JUST SOLD/YARDS), pagination
- **Cache sync:** Loads `GET /cache/claimed-keys` on init. Stores `claimedPNs`, `claimedItemIds`, `claimedAlertIds` maps. `extractPN(title)` pulls OEM PNs from alert titles for cross-tool matching. `getAlertCacheId(alert)` checks: (1) alertId in claimedAlertIds, (2) extracted PN in claimedPNs. Claimed state = cache match OR `a.claimed` field (fallback).
- **Claim flow:** `claimAlert()` → POST `/cache/claim` with source=scout_alert. Optimistic UI (immediate checkmark swap). On success, updates claimedAlertIds + claimedPNs maps.
- **Unclaim flow:** `unclaimAlert()` → parallel POST `/cache/:id/return` + POST `/scout-alerts/claim` (unclaim). Removes from both maps. Optimistic UI with revert on failure.
- **Cross-tool:** Pulling from Daily Feed automatically shows as claimed on Scout Alerts via shared PN matching.
- **API:** `/cache/claimed-keys`, `/scout-alerts/list`, `/cache/claim` (POST), `/cache/:id/return` (POST), `/scout-alerts/claim` (POST), `/scout-alerts/refresh` (POST)

### cache.html (The Cache)
- **URL:** `/admin/the-cache`
- **Nav key:** `cache`
- **Features:** Active/History/Add Part tabs, stats bar, source badges (daily_feed/scout_alert/hawk_eye/flyway/manual), return/listed/delete actions, check stock with dual query (cache + COGS), manual part add form
- **API:** `/cache/stats`, `/cache/active`, `/cache/:id/return` (POST), `/cache/:id/resolve` (POST), `/cache/:id` (DELETE), `/cache/history`, `/cache/check-stock`, `/cogs/check-stock`, `/cache/claim` (POST)

### vin-scanner.html (Hawk Eye)
- **URL:** `/admin/vin`
- **Nav key:** `vin`
- **Features:** VIN decode via camera photo or manual entry, parts research (eBay comps via Apify), claim parts to cache, scan history
- **API:** `/vin/decode-photo` (POST), `/vin/scan` (POST), `/cache/claim` (POST), `/api/instant-research`, `/api/instant-research/apify` (POST), `/vin/history`

### gate.html (Nest Protector)
- **URL:** `/admin/gate`
- **Nav key:** `gate`
- **Features:** Stock check by part number (exact/variant/cache matches, store badges for Autolumen vs DynaTrack), COGS calculator with yard profiles, blended COGS % with color-coded hero (green/yellow/red at 25%/35% thresholds), custom junkyard support
- **API:** `/cogs/check-stock`, `/cogs/yards`, `/cogs/yard-profile/:id`

### flyway.html (The Flyway)
- **URL:** `/admin/flyway`
- **Nav key:** `flyway`
- **Features:** Road trip planner with yard scoring, vehicle parts expansion, claim to cache
- **API:** `/cache/claim` (POST), `/flyway/vehicle/:id/parts`

---

## Intel Pages

### hunters-perch.html (Hunters Perch)
- **URL:** `/admin/hunters-perch`
- **Nav key:** `perch`
- **Features:** Gap intel (parts competitors sell that we never stocked, scored 0-100), emerging parts (new/accelerating signals), seller filter dropdown, competitor tracking (add/scrape/remove), expandable seller best-sellers, Mark + Dismiss buttons on intel items
- **API:** `/competitors/gap-intel`, `/competitors/emerging`, `/competitors/sellers`, `/competitors/:name/best-sellers`, `/competitors/:name/scrape` (POST), `/competitors/:name` (DELETE), `/competitors/auto-scrape` (POST), `/competitors/mark` (POST), `/competitors/dismiss` (POST)

### opportunities.html (Sky Watch)
- **URL:** `/admin/opportunities`
- **Nav key:** `sky`
- **Features:** Vehicle research cards with status filter (New/Reviewed/Marked/Dismissed), parts breakdown with HIGH/MED/LOW tiers, mark individual parts or all high-value, review/dismiss/delete cards, VIN vs RESEARCH source badges
- **API:** `/opportunities/research`, `/opportunities/research/:id/mark` (POST), `/opportunities/research/:id/mark-all-high` (POST), `/opportunities/research/:id/review` (POST), `/opportunities/research/:id/dismiss` (POST), `/opportunities/research/:id` (DELETE)

### the-mark.html (The Mark)
- **URL:** `/admin/the-mark`
- **Nav key:** `mark`
- **Features:** Active marks list with source badges (SKY WATCH/PERCH/custom), status badges (HUNTING/IN-YARD/LISTED/SOLD), stats bar, push to want list, manual want list entry, delete/remove marks
- **API:** `/competitors/marks`, `/restock-want-list/items`, `/competitors/mark/:id` (DELETE), `/restock-want-list/add` (POST)

### restock-list.html (Scour Stream)
- **URL:** `/admin/restock-list`
- **Nav key:** `scour`
- **Features:** Watchlist management, want list items (manual only), pull/found-in-yard actions, overstock tracking with suggestions, just-sold feed, add/delete want list items
- **API:** `/restock-want-list/watchlist`, `/restock-want-list/watchlist/add` (POST), `/restock-want-list/watchlist/remove` (POST), `/restock-want-list/items`, `/restock-want-list/pull` (POST), `/restock-want-list/find-in-yard` (POST), `/restock-want-list/add` (POST), `/restock-want-list/delete` (POST), `/restock-want-list/just-sold`, `/restock-want-list/overstock/*`

### restock.html (The Quarry)
- **URL:** `/admin/restock`
- **Nav key:** `quarry`
- **Features:** Restock report with configurable day range (7d/30d/60d/90d pills), found items tracking, hide-found toggle
- **Tier system:** TIER_CONFIG keys are `critical`, `low`, `watch` (mapped to display labels RESTOCK NOW, STRONG BUY, CONSIDER)
- **Summary cards:** `d.summary.critical`, `d.summary.low`, `d.summary.watch`, `d.summary.salesAnalyzed`, `d.summary.activeListings`
- **Item fields:** `score`, `urgency`, `timesSold`, `inStock`, `avgPrice`, `revenue`, `basePn`, `yearRange`, `make`, `model`, `partType`, `sampleTitle`
- **API:** `/restock/report`, `/restock/found-items`

### phoenix.html (The Phoenix)
- **URL:** `/admin/phoenix`
- **Nav key:** `phoenix`
- **Features:** Dead inventory revival, seller tracking/scraping, stats dashboard
- **API:** `/phoenix/sellers`, `/phoenix/sellers` (POST), `/phoenix/sellers/:name` (DELETE), `/phoenix/sellers/:name/scrape` (POST), `/phoenix/stats`, `/phoenix`

---

## Inventory Pages

### velocity.html (Velocity)
- **URL:** `/admin/velocity`
- **Nav key:** `velocity`
- **Features:** Sales velocity, sell-through rates, top performers, health dashboard
- **API:** `/demand-analysis/health`, `/demand-analysis/public/velocity`, `/demand-analysis/public/sell-through`, `/demand-analysis/public/top-performers`

### instincts.html (Instincts)
- **URL:** `/admin/instincts`
- **Nav key:** `instincts`
- **Features:** Pricing intelligence learnings
- **API:** `/intelligence/learnings`

### prey-cycle.html (Prey-Cycle)
- **URL:** `/admin/prey-cycle`
- **Nav key:** `prey-cycle`
- **Features:** Lifecycle tracking, seasonal analysis
- **API:** `/intelligence/lifecycle`, `/intelligence/seasonal`

### stale-inventory.html (Carcass)
- **URL:** `/admin/carcass`
- **Nav key:** `carcass`
- **Features:** Stale inventory candidates, revise price / end / relist actions, bulk end, automated run
- **API:** `/stale-inventory/candidates`, `/stale-inventory/actions`, `/stale-inventory/revise-price` (POST), `/stale-inventory/end-item` (POST), `/stale-inventory/relist-item` (POST), `/stale-inventory/bulk-end` (POST), `/stale-inventory/run` (POST)

---

## Tools

### listing-tool-v2.html (Listing Tool v2)
- **URL:** `/admin/listing-tool-v2`
- **Features:** eBay listing generator using Claude API (Anthropic direct calls)
- **API:** `https://api.anthropic.com/v1/messages` (client-side)

### import.html (CSV Import)
- **URL:** `/admin/import`
- **Features:** Bulk CSV data import, sync import listings
- **API:** `/api/parts/import/csv` (POST), `/sync/import-listings` (POST)

### home.html (DarkHawk Home)
- **URL:** `/admin/home`
- **Nav key:** none (home page, no nav bar)
- **Features:** Section link grid (Field/Intel/Inventory/Tools), collapsible Autolumen sync panel (listing upload, sales upload with orders/transactions formats)
- **API:** `/autolumen/stats`, `/autolumen/import/listings` (POST), `/autolumen/import/sales` (POST), `/autolumen/import/transactions` (POST)

### login.html
- **URL:** `/login`
- **Features:** Email/password Firebase login
- **API:** `/auth/login` (POST)

---

## Other Pages (legacy/secondary)

| File | Title | URL | Nav key |
|------|-------|-----|---------|
| alerts.html | Scout Alerts (legacy) | `/admin/alerts` | alerts |
| competitors.html | Competitors (legacy) | `/admin/competitors` | perch |
| sales.html | Sales dashboard | `/admin/sales` | quarry |
| test.html | Test | `/admin/test`, `/test` | none |
