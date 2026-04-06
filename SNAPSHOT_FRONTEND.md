# SNAPSHOT_FRONTEND.md
Generated 2026-04-06

## Shared Components

### dh-nav.js
- Two-bar sticky nav: FIELD row (6 links, red active) + INTEL row (10 links, yellow active)
- Logo + "DARKHAWK" links to /admin/home. INTEL row hidden on mobile.
- **FIELD:** feed, alerts, cache, vin, gate, flyway
- **INTEL:** scour, quarry, sky, perch, mark, velocity, instincts, prey-cycle, carcass, phoenix

### dh-parts.js + dh-parts.css (Part Value Utilities)
- **Loaded by:** all 6 field pages
- **getPartTier(price):** ELITE $500+ gold pulse, PREMIUM $350+ purple pulse, HIGH $250+ blue, SOLID $150+ green, BASE $100+ orange, LOW <$100 red
- **renderPriceBadge(price, prefix):** HTML badge with tier color
- **isExcludedPart(title):** Filters engines/internals, transmissions, body panels, airbags/SRS. Clock springs allowed. Same patterns as backend.
- **CSS:** `.tier-elite` through `.tier-low`, `.tier-nodata`, `@keyframes pulse-gold`/`pulse-purple`, `.part-badge` base

---

## Field Pages

### attack-list.html (Daily Feed)
- **URL:** `/admin/pull`, `/puller`
- **Nav key:** `feed`
- **4-line collapsed vehicle card layout:**
  - **Line 1 — Headline:** Score badge (inline color, pulse at 120+) + Year Make Model + engine + rarity badge (inline after engine) + $value (right-aligned, color-coded). Rarity: only UNCOMMON (blue), RARE (purple pulse), LEGENDARY (gold pulse ★) shown. SATURATED/COMMON/NORMAL hidden.
  - **Line 2 — Attributes:** Trim/CULT/DIESEL/4WD/MANUAL/CHECK MT/CVT badges. Collapses when none apply.
  - **Line 3 — Location:** Row · Color · Xd ago + NEW badge (green #4CAF50, for ≤0d). Gone label for inactive.
  - **Line 4 — Parts:** Up to 6 type chips colored by price tier. Novelty dots: cyan ● = NOVEL, green ● = RESTOCK. Intel chips: ★gold MARK, ★green RESTOCK, ★blue WANT, ✕red OVER. ★N indicator for intel match count.
- **Score display:** Uncapped (can show 127, 145, etc.). Color tiers: 120+ gold, 100+ bright green, 80+ green, 60+ yellow, 40+ orange, <40 red. Gold pulses at 120+.
- **getScoreColor(score):** Returns hex color for score badge background.
- **VEHICLE_CAPS:** `{ newest: 50, '3d': 150, '7d': 300, '30d': 500, '60d': 1000, '90d': 2000, all: 5000 }`
- **Filters:** Newest / 3d / 7d / 30d / 60d / All. ALL uses pillDays=999, groups by age tiers, no date restriction.
- **Cache sync:** Loads GET /cache/claimed-keys on init. Two-key matching: PN + itemId. Pull → checkmark, checkmark → unclaim.
- **Expanded view:** On-demand part loading (GET /attack-list/vehicle/:id/parts). Price badges (6-tier), cache claim buttons, below-floor section, spec mismatch section, trim intelligence, part location.
- **API:** `/attack-list`, `/attack-list/vehicle/:id/parts`, `/cache/claimed-keys`, `/cache/claim`, `/cache/:id/return`, `/part-location/...`, `/yards/scrape/...`, `/scout-alerts/claim`, `/attack-list/manual`, `/vin/decode-photo`, `/vin/scan`

### scout-alerts.html (Scout Alerts)
- **URL:** `/admin/scout-alerts`
- **Nav key:** `alerts`
- **Features:** Parts matching want lists at yards, claim/unclaim with cache sync, yard tabs, time filter pills, hide-pulled toggle, summary cards, pagination, inline edit for STREAM entries
- **Cache sync:** Loads /cache/claimed-keys. Three maps: claimedPNs, claimedItemIds, claimedAlertIds. extractPN() for cross-tool matching. Claim routes through /cache/claim, unclaim calls both /cache/:id/return + /scout-alerts/claim.
- **API:** `/cache/claimed-keys`, `/scout-alerts/list`, `/cache/claim`, `/cache/:id/return`, `/scout-alerts/claim`, `/scout-alerts/refresh`, `/restock-want-list/by-title` (PATCH)

### cache.html (The Cache)
- **URL:** `/admin/the-cache`
- **Nav key:** `cache`
- **Features:** Active/History tabs, stats bar, source badges (daily_feed/scout_alert/hawk_eye/flyway/manual), return/listed/delete actions, price badges via renderPriceBadge(), inline edit on PN and description, check stock (cache + COGS), manual part add
- **API:** `/cache/stats`, `/cache/active`, `/cache/:id` (PATCH/DELETE), `/cache/:id/return`, `/cache/:id/resolve`, `/cache/history`, `/cache/check-stock`, `/cogs/check-stock`, `/cache/claim`

### vin-scanner.html (Hawk Eye)
- **URL:** `/admin/vin`
- **Nav key:** `vin`
- **Features:** VIN decode via camera photo or manual entry, parts research, claim to cache, scan history. Uses getPartTier() for 6-tier badges.
- **API:** `/vin/decode-photo`, `/vin/scan`, `/cache/claim`, `/api/instant-research`, `/api/instant-research/apify`, `/vin/history`

### gate.html (Nest Protector)
- **URL:** `/admin/gate`
- **Nav key:** `gate`
- **Features:** Stock check by PN (exact/variant/cache, store badges for Autolumen vs DynaTrack), COGS calculator with yard profiles, price badges via renderPriceBadge()
- **API:** `/cogs/check-stock`, `/cogs/yards`, `/cogs/yard-profile/:id`

### flyway.html (The Flyway)
- **URL:** `/admin/flyway`
- **Nav key:** `flyway`
- **Features:** Road trip planner. Vehicle cards match attack list layout (4-line: score+YMM+rarity+$value / attributes / location+NEW / part chips with novelty dots). Day trip = full feed, road trip = LEGENDARY+RARE+MARK only.
- **Card layout:** getScoreColor() for score badge, rarity badges (UNCOMMON/RARE/LEGENDARY only), green NEW badge, novelty dots on part chips. Price right-aligned, attribute badges on Line 2.
- **API:** `/cache/claim`, `/flyway/vehicle/:id/parts`, `/flyway/trips`, `/flyway/trips/:id/attack-list`, etc.

---

## Intel Pages

### hunters-perch.html (Hunters Perch)
- **URL:** `/admin/hunters-perch`
- **Nav key:** `perch`
- **Two tabs:** INTEL (default) / HIDDEN (with count badge)
- **INTEL tab:** Two sections: NEW INTEL (gap-intel: parts competitors sell that we don't, 90d) + EMERGING (hot parts: 3+ sales by 2+ sellers in 60d). Seller filter dropdown. Mark (★ gold) + Hide (✕ red) buttons per item using `window._intelData` lookup pattern.
- **HIDDEN tab:** Lazy-loads GET /hidden/list. Shows PN + partType + source per item, Unhide button (DELETE /hidden/:id), hidden count badge on tab.
- **Mark flow:** markByIdx() → POST /competitors/mark with structured data from _intelData
- **Hide flow:** hideByIdx() → POST /hidden/add with partNumber from _intelData (structured, not title regex)
- **API:** `/competitors/gap-intel`, `/competitors/emerging`, `/competitors/sellers`, `/competitors/:name/best-sellers`, `/competitors/:name/scrape`, `/competitors/mark`, `/hidden/add`, `/hidden/list`, `/hidden/:id` (DELETE)

### opportunities.html (Sky Watch)
- **URL:** `/admin/opportunities`
- **Nav key:** `sky`
- **Features:** Vehicle research cards with status filter, parts breakdown HIGH/MED/LOW, mark/review/dismiss
- **API:** `/opportunities/research`, `/opportunities/research/:id/mark`, etc.

### the-mark.html (The Mark)
- **URL:** `/admin/the-mark`
- **Nav key:** `mark`
- **Search bar:** Sticky at top, 150ms debounce, client-side filter across partNumber/originalTitle/partType/source/notes. "Showing X of Y marks" count.
- **Mark cards:** Source badges (SKY/PERCH), status badges (HUNTING/IN-YARD/LISTED/SOLD), IN WANT LIST badge, median price, part number, time ago.
- **Buttons per card:** Find in Yard (pin-drop icon, inline yard results), Send to want list (if not already), Remove, Hide (✕ red).
- **Find in Yard:** Hits POST /restock-want-list/find-in-yard with mark title. Shows matching yard vehicles inline (YMM/color/yard/row/set date). Toggle on/off.
- **Hide flow:** hideMark() awaits POST /hidden/add, checks response, only deletes from the_mark on success. Reverts card on failure.
- **Hidden parts:** Collapsible section at bottom. Lazy-loads /hidden/list, unhide per item.
- **API:** `/competitors/marks`, `/restock-want-list/titles` (lightweight, no stock check), `/restock-want-list/find-in-yard`, `/competitors/mark/:id` (DELETE), `/restock-want-list/add`, `/hidden/add`, `/hidden/list`, `/hidden/:id` (DELETE)

### restock-list.html (Scour Stream)
- **URL:** `/admin/restock-list`
- **Nav key:** `scour`
- **Features:** Two tabs: WANT LIST (default) + OVERSTOCK. Add form: PN + Description + Make + Model + Notes. Inline edit (title/notes), pull/found-in-yard actions. Overstock: compact row layout, scan duplicates (scoped to overstock list), scan high-qty new. Auto-transition: overstock stock=0 creates want list entry.
- **API:** `/restock-want-list/watchlist`, `/restock-want-list/items`, `/restock-want-list/add`, `/restock-want-list/delete`, `/restock-want-list/just-sold`, etc.

### restock.html (The Quarry)
- **URL:** `/admin/restock`
- **Nav key:** `quarry`
- **Features:** Restock report with CRITICAL/LOW/WATCH tiers, period pills (7d/30d/60d/90d), found items tracking, hide-found toggle
- **API:** `/restock/report`, `/restock/found-items`

### phoenix.html (The Phoenix)
- **URL:** `/admin/phoenix`
- **Nav key:** `phoenix`
- **Features:** Dead inventory revival, rebuild seller management, Phoenix score badges (PRIME/SOLID/WATCH/LOW)
- **API:** `/phoenix/sellers`, `/phoenix/stats`, `/phoenix`

---

## Inventory Pages

### velocity.html
- **URL:** `/admin/velocity` | **Nav:** `velocity`
- Sales velocity, sell-through rates, top performers, health dashboard

### instincts.html
- **URL:** `/admin/instincts` | **Nav:** `instincts`
- Pricing intelligence, return patterns, dead inventory learnings, INAD tracker

### prey-cycle.html
- **URL:** `/admin/prey-cycle` | **Nav:** `prey-cycle`
- Lifecycle tracking, seasonal analysis, day-of-week patterns, quarterly trends

### stale-inventory.html (Carcass)
- **URL:** `/admin/carcass` | **Nav:** `carcass`
- Stale inventory candidates, revise/end/relist actions, bulk end, automation

---

## Tools

### listing-tool-v2.html
- **URL:** `/admin/listing-tool-v2`
- eBay listing generator using Claude API

### import.html
- **URL:** `/admin/import`
- Bulk CSV import, sync import listings

### home.html
- **URL:** `/admin/home`
- Section link grid (Field/Intel/Inventory/Tools), Autolumen sync panel

### login.html
- **URL:** `/login`
- Firebase email/password login
