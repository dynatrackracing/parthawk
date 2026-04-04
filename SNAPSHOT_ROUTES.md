# SNAPSHOT_ROUTES.md — DarkHawk Route Layer

> Generated: 2026-04-04 | Source: `service/index.js`, `service/routes/`

## Route Mounts (from index.js)

| Prefix | Route File | Auth |
|--------|-----------|------|
| `/auth` | `routes/auth.js` | **public** (login/logout) |
| `/login` | inline (serves login.html) | **public** |
| `/items` | `routes/items.js` | authMiddleware |
| `/cron` | `routes/cron.js` | authMiddleware + isAdmin |
| `/autos` | `routes/autos.js` | authMiddleware |
| `/users` | `routes/user.js` | mixed (login=public) |
| `/filters` | `routes/filters.js` | authMiddleware |
| `/sync` | `routes/sync.js` | authMiddleware (some isAdmin) |
| `/intelligence` | `routes/intelligence.js` | mixed (learnings/data-health=public) |
| `/market-research` | `routes/market-research.js` | authMiddleware + isAdmin (some) |
| `/pricing` | `routes/pricing.js` | authMiddleware |
| `/demand-analysis` | `routes/demand-analysis.js` | mixed (public/* endpoints) |
| `/price-check` | `routes/price-check.js` | **public** (no auth) |
| `/yards` | `routes/yards.js` | **public** (no auth) |
| `/attack-list` | `routes/attack-list.js` | **public** (no auth) |
| `/cogs` | `routes/cogs.js` | **public** (no auth) |
| `/api/parts` | `routes/partsLookup.js` (priority) | **public** |
| `/api/parts` | `routes/parts.js` (fallback) | **public** |
| `/api/parts-lookup` | `routes/partsLookup.js` | **public** |
| `/restock` | `routes/restockReport.js` | **public** |
| `/restock-want-list` | `routes/restock-want-list.js` | **public** |
| `/scout-alerts` | `routes/scout-alerts.js` | **public** |
| `/opportunities` | `routes/opportunities.js` | **public** |
| `/api/fitment` | `routes/fitment.js` | **public** |
| `/api/listing-tool` | `routes/listing-tool.js` | **public** |
| `/part-location` | `routes/part-location.js` | **public** |
| `/vin` | `routes/vin.js` | **public** |
| `/stale-inventory` | `routes/stale-inventory.js` | **public** |
| `/competitors` | `routes/competitors.js` | **public** |
| `/autolumen` | `routes/autolumen.js` | **public** |
| `/cache` | `routes/cache.js` | **public** |
| `/trim-intelligence` | `routes/trim-intelligence.js` | **public** |
| `/ebay-messaging` | `routes/ebay-messaging.js` | **public** |
| `/flyway` | `routes/flyway.js` | **public** |
| `/instant-research` | `routes/instant-research.js` | **public** |
| `/trim-validation` | `routes/trim-validation.js` | **public** |
| `/phoenix` | `routes/phoenix.js` | **public** |
| `/return-intelligence` | `routes/return-intelligence.js` | **public** |
| `/private` | `routes/private.js` | authMiddleware + isAdmin (some) |

## Inline API Routes (defined in index.js)

| Method | Path | Purpose |
|--------|------|---------|
| -- | `authGate middleware` | Cookie-based password gate (all routes) |
| GET | `/login` | Login page (public, serves login.html) |
| GET | `/api/health-check` | Health check (public, bypasses authGate) |
| GET | `/api/debug/market-cache` | Debug market cache lookup |
| GET | `/api/test-lkq` | Test LKQ fetch via curl/axios |
| POST | `/api/decode-vins` | Decode all undecoded yard_vehicle VINs |
| POST | `/api/build-scrape-queue` | Build scrape queue from sales data |
| POST | `/api/build-auto-index` | Build Auto + AutoItemCompatibility from JSON |
| GET | `/api/debug/full` | Full diagnostic (raw SQL against prod) |
| POST | `/api/admin/dedup-sales` | One-time YourSale deduplication |
| POST | `/api/admin/fix-engines` | Re-format engine strings for decoded vehicles |
| POST | `/api/admin/backfill-auto` | Backfill Auto table from YourSale titles |
| POST | `/api/market-price/run-batch` | Kick off full market pricing pass (background) |
| GET | `/api/market-price` | Single eBay sold comp check (?q=query) |

---

## Admin HTML Pages

| Path | HTML File | Purpose |
|------|-----------|---------|
| `/admin/home` | `home.html` | Admin dashboard |
| `/admin/import` | `import.html` | Data import tool |
| `/admin/pull` | `attack-list.html` | Attack list (puller tool) |
| `/puller` | `attack-list.html` | Attack list (public alias) |
| `/admin/gate` | `gate.html` | Gate receipt / COGS entry |
| `/admin/vin` | `vin-scanner.html` | VIN scanner tool |
| `/admin/hunters-perch` | `hunters-perch.html` | Hunters Perch dashboard |
| `/admin/phoenix` | `phoenix.html` | Phoenix dead-listing harvester |
| `/admin/the-cache` | `cache.html` | The Cache (claimed parts tracker) |
| `/admin/the-mark` | `the-mark.html` | The Mark (market intelligence) |
| `/admin/velocity` | `velocity.html` | Velocity dashboard |
| `/admin/instincts` | `instincts.html` | Instincts (AI insights) |
| `/admin/prey-cycle` | `prey-cycle.html` | Prey Cycle (listing lifecycle) |
| `/admin/carcass` | `stale-inventory.html` | Carcass (stale inventory manager) |
| `/admin/scout-alerts` | `scout-alerts.html` | Scout alerts dashboard |
| `/admin/alerts` | `alerts.html` | Alerts page |
| `/admin/sales` | `sales.html` | Sales dashboard |
| `/admin/competitors` | `competitors.html` | Competitor monitoring |
| `/admin/opportunities` | `opportunities.html` | Opportunities dashboard |
| `/admin/restock` | `restock.html` | Restock report |
| `/admin/restock-list` | `restock-list.html` | Restock want list |
| `/admin/test` | `test.html` | Test/debug page |
| `/admin/listing-tool` | `listing-tool.html` | Listing creation tool |
| `/admin/listing-tool-v2` | `listing-tool-v2.html` | Listing tool v2 |
| `/admin/flyway` | `flyway.html` | Flyway trip planner |

---

## Key Route Endpoints

### `/items` (auth required)
- `GET /` -- list items (paginated)
- `GET /auto` -- items with auto compatibility
- `GET /latest` -- recently added items
- `GET /:id` -- single item
- `GET /lookup/search` -- search items
- `PUT /:id` -- update item (admin)
- `POST /` -- create item (admin)
- `DELETE /:id` -- delete item (admin)

### `/attack-list` (public)
- `GET /` -- full attack list for a yard
- `GET /vehicle/:id/parts` -- parts detail for a vehicle
- `GET /yard/:yardId` -- yard-specific list
- `GET /summary` -- attack list summary stats
- `POST /log-pull` -- log a part pull
- `POST /visit-feedback` -- log yard visit feedback
- `GET /last-visit/:yardId` -- last visit info
- `POST /manual` -- manually score vehicles

### `/yards` (public)
- `GET /` -- list all yards
- `GET /:id/vehicles` -- vehicles at a yard
- `POST /scrape/lkq` -- trigger LKQ scrape
- `POST /scrape/:id` -- trigger yard scrape
- `GET /scrape/status` -- scrape job status
- `GET /status` -- yard freshness status
- `GET /scrape-health` -- scrape health dashboard
- `POST /:id/feedback` -- yard feedback

### `/cache` (public)
- `GET /active` -- active claimed parts
- `GET /history` -- resolved history
- `GET /stats` -- cache dashboard stats
- `POST /claim` -- claim a part
- `POST /:id/return` -- return to alerts
- `POST /:id/resolve` -- manual resolve
- `DELETE /:id` -- delete claim
- `POST /resolve` -- auto-resolve from listings
- `GET /check-stock` -- check if part already in cache

### `/flyway` (public)
- `GET /trips` -- list trips
- `POST /trips` -- create trip
- `PATCH /trips/:id` -- update trip
- `DELETE /trips/:id` -- delete trip
- `POST /trips/:id/yards` -- add yard to trip
- `DELETE /trips/:tripId/yards/:yardId` -- remove yard
- `POST /trips/:id/reinstate` -- reinstate expired trip
- `GET /trips/:id/attack-list` -- trip attack list
- `GET /vehicle/:vehicleId/parts` -- vehicle parts detail
- `POST /trips/:id/scrape` -- trigger trip scrape
- `GET /active-yards` -- yards on active trips
- `GET /available-yards` -- yards available to add

### `/competitors` (public)
- `POST /scan` -- scan a competitor
- `GET /alerts` -- competitor alerts
- `GET /gap-intel` -- gap intelligence
- `GET /emerging` -- emerging competitor analysis
- `POST /auto-scrape` -- trigger auto-scrape
- `POST /mark` -- mark a competitor finding
- `GET /marks` -- list marks
- `GET /sellers` -- list tracked sellers
- `POST /:sellerId/scrape` -- scrape specific seller
- `GET /:sellerId/best-sellers` -- seller best sellers

### `/vin` (public)
- `POST /decode-photo` -- decode VIN from photo
- `POST /scan` -- scan/decode a VIN
- `GET /history` -- VIN decode history
- `GET /test-local/:vin` -- test local decoder

### `/sync` (auth required)
- `POST /your-data` -- sync eBay seller data (admin)
- `POST /your-orders` -- sync eBay orders (admin)
- `POST /your-listings` -- sync eBay listings (admin)
- `POST /sold-items` -- scrape sold items (admin)
- `GET /your-listings` -- get synced listings
- `GET /your-sales` -- get synced sales
- `GET /your-sales/trends` -- sales trend data
- `GET /stats` -- sync status/stats
- `POST /trigger` -- trigger sync
- `POST /import-listings` -- CSV import (upsert + store + qty→status + deactivation pass)
- `POST /import-sales` -- bulk import sales records
- `POST /import-items` -- bulk import competitor items

### `/auth` (public)
- `POST /login` -- password check, set session cookie
- `GET /logout` -- clear session cookie, redirect to /login
