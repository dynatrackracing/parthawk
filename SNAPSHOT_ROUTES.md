Generated 2026-04-07

# PartHawk Route Map

Source: `service/index.js` -- all app.use mounts, inline routes, and admin pages.

---

## Section 1: API Route Mounts

| Prefix | Route File | Key Endpoints |
|--------|-----------|---------------|
| `/auth` | auth.js | POST `/login`, GET `/logout` |
| `/items` | items.js | GET `/` `/auto` `/latest` `/:id` `/lookup/search`, PUT `/:id`, POST `/`, DELETE `/:id` |
| `/cron` | cron.js | GET `/` (cron trigger) |
| `/autos` | autos.js | GET `/lookup` `/distinct` `/:id`, POST `/` `/get-auto-ids`, PUT `/:id` |
| `/users` | user.js | POST `/login`, GET `/` `/:id`, PUT `/:id`, DELETE `/:id` |
| `/filters` | filters.js | GET `/item` |
| `/sync` | sync.js | GET `/status` `/your-listings` `/your-sales` `/your-sales/trends` `/health` `/stats` `/ebay-status`, POST `/your-data` `/your-orders` `/your-listings` `/sold-items` `/import-items` `/import-sales` `/import-listings` `/configure-ebay` `/trigger` |
| `/intelligence` | intelligence.js | GET `/learnings` `/data-health` `/lifecycle` `/seasonal` `/what-to-pull` `/pricing` `/dead-inventory` `/opportunities` `/summary` |
| `/market-research` | market-research.js | POST `/inventory` `/keywords`, GET `/all-sold` `/all-competitors` `/stats` `/competitors/:id` `/sold/:id` `/price-analysis/:id` |
| `/pricing` | pricing.js | GET `/predict/:listingId` `/batch` `/underpriced` `/overpriced` `/velocity/:keywords` `/market-summary` |
| `/demand-analysis` | demand-analysis.js | GET `/sell-through` `/stale-inventory` `/velocity` `/top-performers` `/competition/:keywords` `/dashboard` `/health` |
| `/price-check` | price-check.js | POST `/omit` `/bulk` `/title` `/:listingId` `/cron`, GET `/all` `/history/:listingId` `/stats` |
| `/yards` | yards.js | GET `/ping` `/` `/:id/vehicles` `/scrape/status` `/status` `/scrape-health`, POST `/scrape/lkq` `/scrape/:id` `/:id/feedback` |
| `/attack-list` | attack-list.js | GET `/` `/vehicle/:id/parts` `/yard/:yardId` `/summary` `/last-visit/:yardId`, POST `/log-pull` `/visit-feedback` `/manual` |
| `/cogs` | cogs.js | POST `/gate` `/session`, GET `/yard-profile/:yardId` `/yards` `/check-stock` |
| `/api/parts` | partsLookup.js (priority), parts.js (fallback) | GET `/lookup`, PATCH `/:partNumber/fitment` |
| `/api/parts-lookup` | partsLookup.js | (alias mount) |
| `/restock` | restockReport.js | GET `/report` (per-tier 100-row cap, FOUND from the_cache, timeframe sort) `/found-items` (legacy), POST `/quarry-sync` |
| `/restock-want-list` | restock-want-list.js | GET `/items` `/titles` (lightweight, no stock check) `/just-sold` `/watchlist` `/overstock` `/overstock/suggestions` `/overstock/scan-duplicates` `/overstock/scan-high-qty`, POST `/pull` `/find-in-yard` `/add` (PN+desc+make+model) `/delete` + watchlist/overstock CRUD, PATCH `/:id` `/by-title` |
| `/blocked-comps` | blocked-comps.js | POST `/block` (comp by itemId) `/block-sold` (by partType+year+make+model), DELETE `/by-id/:id` (unified restore) `/:itemId` (comp compat), GET `/` (list with ?search&type&limit&offset) |
| `/scout-alerts` | scout-alerts.js | GET `/list`, POST `/claim` `/refresh` |
| `/opportunities` | opportunities.js | GET `/` `/dismissed` `/research`, POST `/dismiss` `/undismiss` `/research` + research sub-routes |
| `/api/fitment` | fitment.js | GET `/lookup` `/stats` |
| `/api/listing-tool` | listing-tool.js | GET `/ebay-lookup` `/parts-lookup` `/intelligence`, POST `/save-fitment` `/save-listing-intel` |
| `/part-location` | part-location.js | GET `/:partType/:make/:model/:year`, POST `/confirm` `/flag-wrong` |
| `/vin` | vin.js | POST `/decode-photo` `/scan`, GET `/history` `/test-local/:vin` |
| `/stale-inventory` | stale-inventory.js | POST `/run` `/returns` `/revise-price` `/end-item` `/relist-item` `/bulk-end`, GET `/actions` `/returns/pending` `/candidates` `/restock/flags` |
| `/competitors` | competitors.js | POST `/scan` `/auto-scrape` `/mark` `/mark/graduate` `/seed-defaults`, GET `/alerts` `/gap-intel` (Clean Pipe partNumberBase, year-range PN rejection) `/emerging` (3+ sales by 2+ sellers in 60d) `/sellers` `/marks` `/:sellerId/best-sellers` + CRUD |
| `/hidden` | hidden.js | POST `/add` (raw INSERT, ON CONFLICT DO NOTHING), DELETE `/:id`, GET `/list` `/keys` |
| `/autolumen` | autolumen.js | POST `/import/listings` `/import/sales` `/import/transactions`, GET `/stats` |
| `/cache` | cache.js | GET `/active` `/history` `/stats` `/check-stock` `/claimed-keys`, POST `/claim` `/:id/return` `/:id/resolve` `/resolve`, DELETE `/:id` |
| `/trim-intelligence` | trim-intelligence.js | GET `/:year/:make/:model/:trim` |
| `/ebay-messaging` | ebay-messaging.js | GET `/status` `/history` `/templates`, POST `/poll` `/process` `/test-send` |
| `/private` | private.js | GET `/ebay-challenger-api` `/cache/flush` `/cache/stats`, POST `/ebay-challenger-api` |
| `/api/instant-research` | instant-research.js | GET `/` `/quick` `/years` `/makes` `/models` `/engines`, POST `/apify` |
| `/return-intelligence` | return-intelligence.js | GET `/summary` `/by-part-type` `/problem-parts` `/repeat-returners` `/by-make` `/monthly-trend` `/inad` `/high-value-alerts` |
| `/flyway` | flyway.js | GET `/trips` `/trips/:id` `/cleanup-preview` `/trips/:id/attack-list` `/vehicle/:vehicleId/parts` `/active-yards` `/available-yards`, POST `/trips` `/trips/:id/yards` `/trips/:id/reinstate` `/trips/:id/scrape`, PATCH `/trips/:id`, DELETE `/trips/:id` |
| `/phoenix` | phoenix.js | GET `/` `/stats` `/sellers`, POST `/sellers` `/sellers/:name/scrape`, DELETE `/sellers/:name` |

---

## Section 2: Inline Routes (defined directly in index.js)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/login` | Serve login.html |
| GET | `/api/health-check` | Returns `{ ok, time, env }` |
| GET | `/api/debug/market-cache` | Debug market_demand_cache lookup by key or PN |
| GET | `/api/test-lkq` | Test LKQ fetch via curl from Railway |
| POST | `/api/decode-vins` | Decode all undecoded VINs in yard_vehicle |
| POST | `/api/build-scrape-queue` | Build scrape queue from sales data |
| GET | `/test` | **Healthcheck** -- returns `"haribol"` (NOT `/`) |
| POST | `/api/market-price/run-batch` | Kick off full market pricing pass (background) |
| GET | `/api/market-price` | Single eBay sold comp lookup `?q=partNumber` |
| GET | `/api/market-price/status` | Pricing pass freshness status |
| POST | `/api/build-auto-index` | Build Auto + AutoItemCompatibility from JSON |
| GET | `/api/debug/full` | Full diagnostic: raw SQL against prod DB |
| POST | `/api/admin/dedup-sales` | One-time dedup YourSale rows |
| POST | `/api/admin/fix-engines` | Re-format engine strings, retry failed VIN decodes |
| POST | `/api/admin/backfill-auto` | Backfill Auto table from YourSale titles |
| GET | `/api/debug/env-check` | Environment variable check |
| POST | `/api/admin/seed-florida` | Seed Florida yard data |
| GET | `/api/debug/makes` | Debug: list makes in DB |
| GET | `/puller` | Serve attack-list.html (public, no auth) |

---

## Section 3: Admin HTML Pages

| URL Path | HTML File Served |
|----------|-----------------|
| `/admin/home` | home.html -- admin dashboard |
| `/admin/import` | import.html |
| `/admin/pull` | attack-list.html (puller tool) |
| `/admin/gate` | gate.html (COGS entry) |
| `/admin/vin` | vin-scanner.html |
| `/admin/hunters-perch` | hunters-perch.html |
| `/admin/phoenix` | phoenix.html |
| `/admin/the-cache` | cache.html (Phase 7 Part 1) |
| `/admin/the-mark` | the-mark.html |
| `/admin/velocity` | velocity.html |
| `/admin/instincts` | instincts.html |
| `/admin/prey-cycle` | prey-cycle.html |
| `/admin/carcass` | stale-inventory.html |
| `/admin/blocked-comps` | blocked-comps.html |
| `/admin/scout-alerts` | scout-alerts.html |
| `/admin/alerts` | alerts.html |
| `/admin/sales` | sales.html |
| `/admin/competitors` | competitors.html |
| `/admin/opportunities` | opportunities.html |
| `/admin/restock` | restock.html |
| `/admin/restock-list` | restock-list.html |
| `/admin/test` | test.html |
| `/admin/listing-tool` | listing-tool.html |
| `/admin/listing-tool-v2` | listing-tool-v2.html |
| `/admin/flyway` | flyway.html |

Static: `/admin` serves `service/public/` (10m cache, images 24h).

---

## Section 4: Key Endpoint Details

### /cache (The Cache)
Parts staging system -- tracks parts claimed from yards before listing.
- `GET /cache/active` -- active claims in the field. Filter: `?source=&claimedBy=&sortBy=`
- `GET /cache/history` -- resolved entries. `?days=30&limit=100`
- `GET /cache/stats` -- claim/resolution dashboard stats
- `GET /cache/claimed-keys` -- **lightweight sync for puller tools.** Returns `{ claimedPNs: {normalizedPN: cacheId}, claimedItemIds: {itemId: cacheId}, claimedAlertIds: {alertId: cacheId} }`. Used by Daily Feed and Scout Alerts on page load.
- `POST /cache/claim` -- claim a part from yard. Accepts `itemId` field for no-PN parts. Backend deduplicates by normalized PN or itemId.
- `POST /cache/:id/return` -- mark part returned
- `POST /cache/:id/resolve` -- resolve single claim
- `POST /cache/resolve` -- bulk auto-resolve from listings
- `DELETE /cache/:id` -- delete claim
- `GET /cache/check-stock` -- check if part already in cache
- **Admin page:** `/admin/the-cache` serves cache.html

### /autolumen (Radio/Autolumen imports)
- `POST /autolumen/import/listings` -- CSV upload of active listings (multipart, 10MB max)
- `POST /autolumen/import/sales` -- CSV upload of sales history
- `POST /autolumen/import/transactions` -- CSV upload of unified transactions
- `GET /autolumen/stats` -- import summary stats

### /vin (VIN decode + scan)
- `POST /vin/decode-photo` -- Claude Vision API decodes VIN from base64 JPEG
- `POST /vin/scan` -- decode VIN via LocalVinDecoder + cache
- `GET /vin/history` -- decoded VIN history
- `GET /vin/test-local/:vin` -- **diagnostic**: decode single VIN locally
- **Admin page:** `/admin/vin` serves vin-scanner.html

### /attack-list (Yard pull planning)
- `GET /attack-list` -- all yards, slim payload by default. `?days=90&full=true&since=`
- `GET /attack-list/vehicle/:id/parts` -- on-demand parts for a vehicle
- `GET /attack-list/yard/:yardId` -- single yard attack list
- `GET /attack-list/summary` -- cross-yard summary
- `POST /attack-list/log-pull` -- log a pulled part
- `POST /attack-list/visit-feedback` -- post-visit yard feedback
- `GET /attack-list/last-visit/:yardId` -- last visit info
- `POST /attack-list/manual` -- manual vehicle entry
- **Admin page:** `/admin/pull` and `/puller` (public) both serve attack-list.html

### /hidden (Global Part Blacklist)
- `POST /hidden/add` -- hide a part globally. Body: `{ partNumberBase, partType, make, model, source, sourceDetail, hiddenBy }`. Raw INSERT with ON CONFLICT (part_number_base, COALESCE(make,''), COALESCE(model,'')) DO NOTHING. Returns `{ success, id, alreadyHidden }`.
- `DELETE /hidden/:id` -- unhide a part
- `GET /hidden/list` -- all hidden parts ordered by created_at desc
- `GET /hidden/keys` -- lightweight set for backend filtering: `{ keys: ["PN|MAKE|MODEL", ...] }`

### /competitors (Phase E4 -- partNumberBase grouping)
`gap-intel`, `emerging`, and `best-sellers` now group by partNumberBase.
- `POST /competitors/scan` -- run competitor price monitoring
- `GET /competitors/alerts` -- active price alerts. `?dismissed=&limit=`
- `GET /competitors/gap-intel` -- parts they sell that we don't (partNumberBase groups). Uses Clean Pipe partNumberBase from YourSale/YourListing (not title extraction). extractPartNumber() rejects year ranges. Filters: weAlreadySellThis, dismissed, marked (dual markedTitles + markedPNs), hidden (loadHiddenSet). 90-day window, $100+ floor.
- `GET /competitors/emerging` -- hot parts: 3+ sales by 2+ distinct sellers in 60-day window. Same Clean Pipe + hidden/marked filters. Sort: sellerCount DESC, totalCount DESC, avgPrice DESC. Cap 50.
- `GET /competitors/:sellerId/best-sellers` -- seller top sellers (partNumberBase groups)
- `GET /competitors/sellers` -- list tracked sellers
- `POST /competitors/auto-scrape` -- trigger scrape of tracked sellers
- `POST /competitors/mark` -- mark a competitor part
- `GET /competitors/marks` -- all marks
- `POST /competitors/mark/graduate` -- graduate mark to action
- `GET /competitors/mark/check-vehicle` -- check vehicle against marks
- **Admin page:** `/admin/competitors` serves competitors.html

### /cogs (Cost of Goods Sold)
- `POST /cogs/gate` -- calculate max spend for gate negotiation. Body: `{ yardId, parts }`
- `POST /cogs/session` -- record a pull session with true COGS
- `GET /cogs/yard-profile/:yardId` -- yard cost profile
- `GET /cogs/yards` -- all yards with COGS data
- `GET /cogs/check-stock` -- stock check against COGS
- **Admin page:** `/admin/gate` serves gate.html

### Healthcheck
- `GET /test` -- liveness probe, returns `"haribol"` (healthcheck is here, NOT `/`)
- `GET /api/health-check` -- JSON health: `{ ok, time, env }`

### SPA Fallback
- `GET /*` -- serves `client/build/index.html` (React SPA catch-all, last route)
