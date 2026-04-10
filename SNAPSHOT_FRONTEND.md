# SNAPSHOT_FRONTEND.md
Generated 2026-04-10

## Shared Components

### dh-nav.js
- Two-bar sticky nav: FIELD row (6 links desktop / 5 mobile, red active) + INTEL row (11 links, yellow active)
- Logo + "DARKHAWK" links to /admin/home. INTEL row hidden on mobile. Flyway hidden on mobile via `.field-link-mobile-hide` at 768px.
- **FIELD:** feed, alerts, cache, vin, gate, flyway (flyway desktop-only)
- **INTEL:** scour, quarry, sky, perch, mark, velocity, instincts, prey-cycle, carcass, phoenix, blocked
- Carcass link hidden in INTEL row via inline CSS override (`display:none !important`); accessed via FIELD → carcass page directly.
- Splash background: random image 1–8 from `/admin/images/splash-N.jpg`, persisted per session. `body::before` overlay at rgba(0,0,0,0.7) injected via `<style>` element.
- Logout link: absolute-positioned right side of INTEL row.

### dh-parts.js + dh-parts.css (Part Value Utilities)
- **Loaded by:** all field pages (attack-list, scout-alerts, vin-scanner, flyway, gate, cache)
- **getPartTier(price):** ELITE $500+ gold pulse, PREMIUM $350+ purple pulse, HIGH $250+ blue, SOLID $150+ green, BASE $100+ orange, LOW <$100 red
- **renderPriceBadge(price, prefix):** HTML badge with tier color
- **isExcludedPart(title):** Filters engines/internals, transmissions, body panels, airbags/SRS. Clock springs allowed. Same patterns as backend.
- **renderIntelIcon(sources):** Priority icon for chip prefix — mark > quarry > stream/restock > overstock. Quarry gets `.intel-fire` pulse animation.
- **CSS:** `.tier-elite` through `.tier-low`, `.tier-nodata`, `@keyframes pulse-gold`/`pulse-purple`, `.intel-fire`, `.archives-badge`, `.part-badge` base

---

## Field Pages

### attack-list.html (Daily Feed)
- **URL:** `/admin/pull`, `/puller`
- **Nav key:** `feed`
- **4-line collapsed vehicle card layout:**
  - **Line 1 — Headline:** Score badge (inline color, gold pulse at 120+) + Year Make Model + engine + rarity badge (inline after engine) + $value (right-aligned, color-coded). Rarity: only UNCOMMON (blue), RARE (purple pulse), LEGENDARY (gold pulse ★) shown. SATURATED/COMMON/NORMAL hidden.
  - **Line 2 — Attributes:** Priority-sorted badges (leftmost = biggest score driver): EV (electric blue #2979ff border, bold) → PHEV (bright cyan #1de9b6 border) → PERFORMANCE → HYBRID (cyan #00bcd4 border) → DIESEL → 4WD+MT → PREMIUM → MANUAL → 4WD → CHECK MT → CVT → TRIM → CULT. Collapses when none apply. Badges read from server-computed `boostReasons[]` for powertrain; client-side detection for drivetrain/transmission. Sorted via `BADGE_PRIORITY` map before render.
  - **Stale scrape banner (2026-04-08):** Yellow ⚠ bar when `yard.isStale` (>18h since last scrape). Shows hours since last scrape. Not dismissible.
  - **Date handling (2026-04-08 doctrine):** `getNewestDate()`, `getDaysFromNewest()`, `parseLocalDate()` DELETED. Pill filters read `v.daysSinceSet` (server-computed int in ET). "Set Xd ago" label reads `v.setDateLabel` (server string). Frontend never parses dates.
  - **Line 3 — Location:** Row · Color · Xd ago + NEW badge (green #4CAF50, for ≤0d). Gone label for inactive.
  - **Line 4 — Parts:** Up to 6 type chips colored by price tier. **alertDot priority (2026-04-10):** `p.isSynthetic` → 📢 amber icon on chip (takes priority over intel icon and novelty dot). `p.scoutAlertMatch` (non-synthetic) → 🎯 gold icon on chip. Then intel icons (mark/quarry/stream/over), then novelty dots: cyan ● = NOVEL, green ● = RESTOCK. ★N indicator for intel match count.
- **Score display:** Uncapped (can show 127, 145, etc.). Color tiers: 120+ gold, 100+ bright green, 80+ green, 60+ yellow, 40+ orange, <40 red. Gold pulses at 120+.
- **getScoreColor(score):** Returns hex color for score badge background.
- **VEHICLE_CAPS:** `{ newest: 50, '3d': 150, '7d': 300, '30d': 500, '60d': 1000, '90d': 2000, all: 5000 }`
- **Filters:** Newest / 3d / 7d / 30d / 60d / All. ALL uses pillDays=999, groups by age tiers, no date restriction.
- **Cache sync:** Loads GET /cache/claimed-keys on init. Two-key matching: PN + itemId. Pull → checkmark, checkmark → unclaim.
- **Lazy rendering:** First 30 vehicles per section rendered immediately; remaining vehicles behind IntersectionObserver lazy-load sentinel (200px margin). Click sentinel to force-load.
- **Expanded view (2026-04-09):** On-demand part loading (GET /attack-list/vehicle/:id/parts). Parts sorted: scout-alert-first (scoutAlertScore DESC), then sold history (price DESC), then competitor intel, then ARCHIVES bucket at bottom (price DESC within). ARCHIVES badge (yellow, left slot) on item_reference parts replaces NEW badge. Dual price display: `valueSource=scout_alert` → `$price (alert)` amber suffix; `yoursale` → `$price mkt $median`; `market_estimate` → `$price (market est)`. SOLD/SOLD pills killed, RESTOCK kept. Price badges (6-tier), freshness icon (✅/⚠️/❌), cache claim buttons, below-floor section (collapsed), spec mismatch section (collapsed), trim intelligence (validated suggestions per trim), part location, rebuild reference. **Block button** on chips with priceSource in (item_reference, sold). Optimistic UI with undo on unclaim.
- **isSynthetic badge in expanded parts (2026-04-10):** `p.isSynthetic` → `📢 ALERT {score}` amber pulsing badge (background #f59e0b, `animation:pulse 2s infinite`). `p.scoutAlertMatch` (non-synthetic) → `🎯 SA {score}` gold badge (#FFD700). Both show scoutAlertScore if present.
- **Manual Set List modal:** Paste VINs/vehicles from any source, one per line, any format. POST /attack-list/manual. Renders results in MANUAL yard tab.
- **Inline VIN scanner modal:** Lightweight camera capture → POST /vin/decode-photo → auto-fills VIN input → doScan flow.
- **Model name cleaning:** `cleanModel()` strips LKQ platform codes (JK/JL/DS1/etc.), NHTSA trim suffixes stuffed into model names, deduplicates consecutive words. Mazda 3/6/5 rewritten to Mazda3/Mazda6/Mazda5.
- **API:** `/attack-list`, `/attack-list/vehicle/:id/parts`, `/cache/claimed-keys`, `/cache/claim`, `/cache/:id/return`, `/part-location/...`, `/yards/scrape/...`, `/scout-alerts/claim`, `/attack-list/manual`, `/vin/decode-photo`, `/vin/scan`, `/blocked-comps/block`, `/blocked-comps/block-sold`

### scout-alerts.html (Scout Alerts)
- **URL:** `/admin/scout-alerts`
- **Nav key:** `alerts`
- **Vehicle-centric rebuild (2026-04-09):** One card per yard_vehicle_id, collapsed by default. Expand reveals part groups: HARD_PART_TYPES (ECM/PCM/ECU/BCM/TCM/TIPM/ABS/AIRBAG/SRS) get one row per partNumberBase; soft types get one row per partType with partNumberBreakdown showing PN distribution. Per-row soldHere + soldLifetime. headline_source (highest priority) + headline_score (max match_score). Alert_count collapse note.
- **Part-type section headers (2026-04-10):** `.pt-header` styled `font-weight:800; color:#FFFFFF; text-transform:uppercase` — bold white headers with optional tier-color tint background (rgba from tier hex at 18–25% opacity for SOLID/LOW/BASE).
- **Score badge coloring (2026-04-10):** `score-high` (≥75) = `background:#3B82F6` blue (previously green). Scale: ≥75 blue, ≥60 green, ≥50 yellow, ≥40 orange, <40 red. Numeric match_score badges inline per part row.
- **Claim:** Per dedup row via first alertId. Cache sync via /cache/claimed-keys (three maps: claimedPNs, claimedItemIds, claimedAlertIds). Hide-pulled hides fully-claimed vehicles.
- **Features:** Yard tabs (Raleigh/Durham/Greensboro/East NC/Tampa/Largo/Clearwater), time filter pills (Today/3d/7d/30d/60d/90d/All), summary tiles (MARK/QUARRY/STREAM/OVERSTOCK/YARDS), pagination at vehicle level (50/page), inline edit for STREAM entries (`.editable-stream` dashed underline, click to edit in-place), numeric match_score badges per row.
- **API:** `/cache/claimed-keys`, `/scout-alerts/list` (vehicle-centric shape), `/cache/claim`, `/cache/:id/return`, `/scout-alerts/claim`, `/scout-alerts/refresh`, `/restock-want-list/by-title` (PATCH)

### vin-scanner.html (Hawk Eye)
- **URL:** `/admin/vin`
- **Nav key:** `vin`
- **Full Hawk Eye rewrite (2026-04-10):** Uses AttackListService scoring pipeline via new `/vin/scan-scored` endpoint (POST). No longer calls `/api/instant-research` or `/api/instant-research/apify`.
- **Vehicle card layout:** Matches Daily Feed exactly — score badge (with ℹ️ tooltip noting no yard freshness boost), YMM + engine + rarity inline, attribute badges via `renderAttrBadges()`, VIN in green monospace, spec row (trim/drivetrain/transmission/bodyStyle), collapsed part chips via `renderChips()`.
- **renderChips(parts):** Dedupes by partType, up to 6 chips. `p.isSynthetic` → 📢 amber prefix. `p.scoutAlertMatch` (non-synthetic) → 🎯 gold prefix. Then intel icon, then novelty dot.
- **Part buckets:** aboveFloor, specMismatch (collapsed `<details>`), belowFloor (collapsed `<details>`), archiveParts (item_reference, inline at bottom). `isExcluded` parts skipped entirely.
- **verdictBadge(price, priceSource):** `priceSource=scout_alert` → ` (alert)` suffix on badge text. Archives: `~$N EST` suffix.
- **freshIcon(dateStr):** ✅ ≤60d, ⚠️ ≤90d, ❌ >90d (based on yourSaleLatest/marketCheckedAt/lastSoldDate).
- **renderPartDetail():** alertMatch badge (MARK/QUARRY/OVER source-colored), intel source badges (MARK/QUARRY/STREAM/OVER/FLAG), ARCHIVES badge, novelty badge (NEW/RESTOCK), isSynthetic badge (📢 ALERT pulsing amber), scoutAlertMatch badge (🎯 SA gold). Stats row (in_stock, sold_90d, PN). Market comparison row (median/count/velocity with deviation coloring). Dead warning box. Block button for comp (item_reference + itemId) or sold (partType + YMM) blocks.
- **Camera flow:** processVinPhoto() resizes to max 1280px, JPEG 0.7 quality, further halves if b64 > 1.5MB. POST /vin/decode-photo → auto-fills VIN → doScan('camera').
- **Scan history:** `loadHistory()` lazy-loads on link click. Shows last 10 scans, click to re-scan.
- **Rebuilt reference:** Shows if `data.rebuild_parts.length > 0` at 50% opacity.
- **cachedParts notice:** Amber card if parts already in cache for this vehicle/YMM.
- **Platform siblings:** Shows `v.platform_siblings` if present.
- **API:** `/vin/decode-photo`, `/vin/scan-scored` (new — replaces `/vin/scan`), `/cache/claim`, `/vin/history`, `/blocked-comps/block`, `/blocked-comps/block-sold`

### gate.html (Nest Protector)
- **URL:** `/admin/gate`
- **Nav key:** `gate`
- **Features:** Stock check by PN (exact/variant/cache, store badges for Autolumen vs DynaTrack), COGS calculator with yard profiles, price badges via renderPriceBadge()
- **API:** `/cogs/check-stock`, `/cogs/yards`, `/cogs/yard-profile/:id`

### flyway.html (The Flyway)
- **URL:** `/admin/flyway`
- **Nav key:** `flyway`
- **Features:** Road trip planner. Vehicle cards match attack list layout (4-line: score+YMM+rarity+$value / attributes / location+NEW / part chips with novelty dots). Day trip = full feed, road trip = LEGENDARY+RARE+MARK only.
- **Card layout:** getScoreColor() for score badge, rarity badges (UNCOMMON/RARE/LEGENDARY only), green NEW badge, novelty dots on part chips. Price right-aligned, attribute badges on Line 2. Trip type toggle (DAY teal / ROAD orange).
- **Trip types:** Day trip uses all vehicles; Road trip filters LEGENDARY+RARE+MARK-matched only.
- **Views:** Trip picker list → select trip → attack list for that trip. Yard selector for new trip creation.
- **API:** `/cache/claim`, `/flyway/vehicle/:id/parts`, `/flyway/trips`, `/flyway/trips/:id/attack-list`, `/flyway/trips` (POST/PATCH/DELETE)

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
- **Mark cards:** Source badges (SKY/PERCH), status badges (HUNTING/IN-YARD/LISTED/SOLD), NEEDS REVIEW badge (yellow pulsing, for marks missing structured year), IN WANT LIST badge, median price, part number, time ago.
- **Inline-editable fields (2026-04-07):** Year Start, Year End, Make, Model per card. onChange → PATCH /competitors/mark/:id. "Saved" indicator on success. Year save auto-clears needs_review. needs_review marks sort to top with yellow border.
- **Buttons per card:** Find in Yard (pin-drop icon, inline yard results), Send to want list (if not already), Remove, Hide (✕ red).
- **Find in Yard:** Hits POST /restock-want-list/find-in-yard with mark title. Shows matching yard vehicles inline (YMM/color/yard/row/set date). Toggle on/off.
- **Hide flow:** hideMark() awaits POST /hidden/add, checks response, only deletes from the_mark on success. Reverts card on failure.
- **Hidden parts:** Collapsible section at bottom. Lazy-loads /hidden/list, unhide per item.
- **API:** `/competitors/marks`, `/restock-want-list/titles`, `/restock-want-list/find-in-yard`, `/competitors/mark/:id` (PATCH for edits, DELETE for removal), `/restock-want-list/add`, `/hidden/add`, `/hidden/list`, `/hidden/:id` (DELETE)

### restock-list.html (Scour Stream)
- **URL:** `/admin/restock-list`
- **Nav key:** `scour`
- **Features:** Two tabs: WANT LIST (default) + OVERSTOCK. Add form: PN + Description + Make + Model + Notes. Inline edit (title/notes), pull/found-in-yard actions. Overstock: compact row layout, scan duplicates (scoped to overstock list), scan high-qty new. Auto-transition: overstock stock=0 creates want list entry.
- **Search (2026-04-07):** Sticky search input on Want List tab, 150ms debounce, client-side filter on title/notes/matchedTitles/matchDebug. "Showing X of Y items" count. Overstock tab unchanged.
- **API:** `/restock-want-list/items`, `/restock-want-list/add`, `/restock-want-list/delete`, `/restock-want-list/pull`, `/restock-want-list/find-in-yard`, etc.

### restock.html (The Quarry)
- **URL:** `/admin/restock`
- **Nav key:** `quarry`
- **Features:** Restock report with RESTOCK NOW/STRONG BUY/CONSIDER tiers, period pills (7d/30d/60d/90d), found items tracking, hide-found toggle.
- **Per-tier cap (2026-04-07):** Each tier independently sorted and capped at 100 rows (was global pageSize=100 that cut off lower tiers). Summary tiles show full unpaginated counts.
- **FOUND from the_cache (2026-04-07):** FOUND tile reads from the_cache (Attack List claims) instead of bone_pile scout_alerts. Period-aware. Matches by part_number.
- **API:** `/restock/report` (includes foundCount + foundMap inline)

### blocked-comps.html (Hidden / Blocked Comps)
- **URL:** `/admin/blocked-comps`
- **Nav key:** `blocked`
- All/Comp/Sold tab filters. Search box (debounced 300ms) across title, PN, part type, make, model, reason.
- Table: Type badge (COMP blue / SOLD orange), Block description, PN, Reason, When, Restore button.
- COMP display: source_title (truncated). SOLD display: "ALL {partType} on {year} {make} {model}".
- Restore via DELETE /blocked-comps/by-id/:id (works for both types). Row fades on restore.
- Pagination: 100 per page, Prev/Next.

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
- Stale listing diagnostics (read-only view). Two tabs: CANDIDATES + HISTORY.
- CANDIDATES: fetches `/stale-inventory/candidates`, shows listings needing attention with item cards and action buttons (btn-danger/btn-warn/btn-green).
- Warning banner: "Read-only view. Inventory management happens outside this tool."
- API: `/stale-inventory/candidates`, `/stale-inventory/history`

---

## Tools

### listing-tool.html / listing-tool-v2.html
- **URL:** `/admin/listing-tool-v2`
- eBay listing generator using Claude API. Light theme (white bg, red header). Standard form layout with Tailwind-style tokens.

### import.html
- **URL:** `/admin/import`
- Bulk CSV import, sync import listings

### home.html
- **URL:** `/admin/home`
- Section link grid: IN THE FIELD (6 red cards) / OFFICE INTEL (6 yellow cards) / INVENTORY (4 green cards) / TOOLS (2 cyan cards).
- Random splash background (same mechanism as dh-nav.js — `body::before` dim overlay).
- Autolumen Sync panel: collapsible section (▶ toggle), CSV upload for active listings + sales history (Orders Report or Transaction Report radio toggle). Safe to re-upload (duplicate handling).
- **Sections:** DAILY FEED, SCOUT ALERTS, THE CACHE, HAWK EYE, NEST PROTECTOR, THE FLYWAY / HUNTERS PERCH, PHOENIX, SCOUR STREAM, THE QUARRY, SKY WATCH, THE MARK / VELOCITY, INSTINCTS, PREY-CYCLE, CARCASS / LISTING TOOL, CSV IMPORT

### login.html
- **URL:** `/login`
- Firebase email/password login
