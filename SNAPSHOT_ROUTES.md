# SNAPSHOT_ROUTES.md — DarkHawk Route Layer

> Generated: 2026-04-04 | Source: `service/index.js`, `service/routes/`

## Route Mounts (from index.js)

| Prefix | Route File | Auth |
|--------|-----------|------|
| `/auth` | `routes/auth.js` | **public** (login/logout) |
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
| `/api/instant-research` | `routes/instant-research.js` | **public** |
| `/return-intelligence` | `routes/return-intelligence.js` | **public** |
| `/flyway` | `routes/flyway.js` | **public** |
| `/phoenix` | `routes/phoenix.js` | **public** |
| `/private` | `routes/private.js` | authMiddleware + isAdmin (some) |

## Inline API Routes (defined in index.js)

| Method | Path | Purpose |
|--------|------|---------|
| -- | `authGate middleware` | Cookie-based password gate (all routes) |
| GET | `/login` | Login page (serves login.html) |
| GET | `/api/health-check` | Health check (public) |
| GET | `/api/debug/market-cache` | Debug market cache lookup |
| GET | `/api/test-lkq` | Test LKQ fetch via curl/axios |
| POST | `/api/decode-vins` | Decode all undecoded yard_vehicle VINs |
| POST | `/api/build-scrape-queue` | Build scrape queue from sales data |
| POST | `/api/build-auto-index` | Build Auto + AutoItemCompatibility from JSON |
| GET | `/api/debug/full` | Full diagnostic (raw SQL against prod) |
| GET | `/api/debug/env-check` | Check which eBay env vars are configured |
| GET | `/api/debug/makes` | Full raw SQL diagnostic (tables, samples, env) |
| POST | `/api/admin/dedup-sales` | One-time YourSale deduplication |
| POST | `/api/admin/fix-engines` | Re-format engine strings for decoded vehicles |
| POST | `/api/admin/backfill-auto` | Backfill Auto table from YourSale titles |
| POST | `/api/admin/seed-florida` | Seed Florida yards if they don't exist |
| POST | `/api/market-price/run-batch` | Kick off full market pricing pass (background) |
| GET | `/api/market-price` | Single eBay sold comp check (?q=query) |
| GET | `/api/market-price/status` | Market pricing cache freshness status |
| GET | `/test` | Simple liveness probe (returns "haribol") |

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

### `/auth` (public) -- NEW

- `POST /login` -- authenticate with DARKHAWK_PASSWORD, set session cookie
- `GET /logout` -- clear session cookie, redirect to /login

### `/items` (auth required)
- `GET /` -- list items (paginated)
- `GET /auto` -- items with auto compatibility
- `GET /latest` -- recently added items
- `GET /:id` -- single item
- `GET /lookup/search` -- search items
- `PUT /:id` -- update item (admin)
- `POST /` -- create item (admin)
- `DELETE /:id` -- delete item (admin)

### `/cron` (auth + admin)
- `GET /` -- cron status/trigger

### `/autos` (auth required)
- `GET /lookup` -- auto lookup by year/make/model
- `GET /distinct` -- distinct years/makes/models for dropdowns
- `GET /:id` -- single auto record
- `POST /get-auto-ids` -- batch get auto IDs (admin)
- `POST /` -- create auto record (admin)
- `PUT /:id` -- update auto record (admin)

### `/users` (mixed auth)
- `POST /login` -- user login (public)
- `GET /:id` -- get user (auth)
- `GET /` -- list users (admin)
- `PUT /:id` -- update user (admin)
- `DELETE /:id` -- delete user (admin)

### `/filters` (auth required)
- `GET /item` -- item filter options

### `/sync` (auth required, some admin, some public)
- `GET /status` -- current sync status (auth)
- `POST /your-data` -- sync eBay orders + listings (admin, background 202)
- `POST /your-orders` -- sync eBay orders only (admin)
- `POST /your-listings` -- sync eBay listings only (admin)
- `POST /sold-items` -- scrape sold items from all competitors (admin)
- `POST /sold-items/:seller` -- scrape sold items from specific seller (admin)
- `POST /sold-items-by-keywords` -- scrape sold items by keyword search (admin)
- `GET /your-listings` -- get synced listings (paginated, auth)
- `GET /your-sales/trends` -- sales trends by day/week (auth)
- `GET /your-sales` -- get synced sales (paginated, auth)
- `GET /health` -- test eBay API connectivity (public)
- `GET /stats` -- sync statistics (auth)
- `POST /build-auto-index` -- build Auto + AutoItemCompatibility from titles (public)
- `POST /import-items` -- bulk import competitor/reference items (public)
- `POST /import-sales` -- bulk import sales records with store field (public)
- `POST /import-listings` -- bulk import listings (public, store field + deactivation pass)
- `POST /configure-ebay` -- set eBay Trading API credentials at runtime (public)
- `GET /ebay-status` -- check eBay credential config + data freshness (public)
- `POST /trigger` -- quick trigger sync (public, runs in background)

### `/intelligence` (mixed auth)
- `GET /learnings` -- AI learnings (public)
- `GET /data-health` -- data health dashboard (public)
- `GET /lifecycle` -- listing lifecycle analysis (public)
- `GET /seasonal` -- seasonal trends (public)
- `GET /what-to-pull` -- what to pull recommendations (auth)
- `GET /pricing` -- pricing intelligence (auth)
- `GET /dead-inventory` -- dead inventory analysis (auth)
- `GET /opportunities` -- opportunity finder (auth)
- `GET /summary` -- intelligence summary (auth)

### `/market-research` (auth + admin for writes)
- `POST /inventory` -- research inventory (admin)
- `POST /keywords` -- research by keywords (admin)
- `GET /all-sold` -- all sold items (auth)
- `GET /all-competitors` -- all competitor data (auth)
- `GET /stats` -- research stats (auth)
- `GET /competitors/:yourListingId` -- competitors for a listing (auth)
- `GET /sold/:yourListingId` -- sold comps for a listing (auth)
- `GET /price-analysis/:yourListingId` -- price analysis for a listing (auth)

### `/pricing` (auth required)
- `GET /predict/:listingId` -- price prediction for a listing
- `GET /batch` -- batch pricing analysis
- `GET /underpriced` -- underpriced listings
- `GET /overpriced` -- overpriced listings
- `GET /velocity/:keywords` -- velocity analysis by keywords
- `GET /market-summary` -- market pricing summary

### `/demand-analysis` (mixed auth)
- `GET /sell-through` -- sell-through rate analysis (auth)
- `GET /stale-inventory` -- stale inventory analysis (auth)
- `GET /velocity` -- velocity metrics (auth)
- `GET /top-performers` -- top performing parts (auth)
- `GET /competition/:keywords` -- competition analysis (auth)
- `GET /dashboard` -- demand dashboard (auth)
- `GET /health` -- demand data health (public)
- `GET /public/velocity` -- public velocity data
- `GET /public/sell-through` -- public sell-through data
- `GET /public/top-performers` -- public top performers

### `/price-check` (public)
- `POST /omit` -- omit a listing from price checks
- `GET /all` -- all price check results
- `POST /bulk` -- bulk price check
- `POST /title` -- price check by title
- `POST /:listingId` -- price check for a listing
- `GET /history/:listingId` -- price check history
- `POST /cron` -- trigger price check cron
- `GET /stats` -- price check stats

### `/yards` (public)
- `GET /ping` -- simple ping
- `GET /` -- list all yards
- `GET /:id/vehicles` -- vehicles at a yard
- `POST /scrape/lkq` -- trigger LKQ scrape
- `GET /scrape/status` -- scrape job status
- `POST /scrape/:id` -- trigger yard scrape
- `GET /status` -- yard freshness status
- `GET /scrape-health` -- scrape health dashboard
- `POST /:id/feedback` -- yard feedback

### `/attack-list` (public)
- `GET /` -- full attack list for a yard
- `GET /vehicle/:id/parts` -- parts detail for a vehicle
- `GET /yard/:yardId` -- yard-specific list
- `GET /summary` -- attack list summary stats
- `POST /log-pull` -- log a part pull
- `POST /visit-feedback` -- log yard visit feedback
- `GET /last-visit/:yardId` -- last visit info
- `POST /manual` -- manually score vehicles

### `/cogs` (public)
- `POST /gate` -- gate receipt entry
- `POST /session` -- create COGS session
- `GET /yard-profile/:yardId` -- yard profile for COGS
- `GET /yards` -- yards list for COGS
- `GET /check-stock` -- check stock for COGS

### `/api/parts` via partsLookup.js (public, priority)
- `GET /lookup` -- part number lookup with market data
- `PATCH /:partNumber/fitment` -- update fitment for a part number

### `/api/parts` via parts.js (public, fallback)
- `GET /lookup` -- part lookup (legacy)
- `PATCH /:id/fitment` -- update fitment
- `GET /lookup/programmed` -- programmed parts lookup
- `POST /import/csv` -- CSV import

### `/restock` (public)
- `GET /report` -- restock report
- `GET /found-items` -- found items for restock

### `/restock-want-list` (public)
- `GET /debug/:id` -- debug want list item
- `GET /items` -- want list items
- `GET /just-sold` -- recently sold items for restock
- `POST /pull` -- mark item as pulled
- `POST /find-in-yard` -- find want list item in yard
- `POST /add` -- add to want list
- `POST /delete` -- delete from want list
- `GET /watchlist` -- watchlist items
- `POST /watchlist/add` -- add to watchlist
- `POST /watchlist/remove` -- remove from watchlist
- `POST /watchlist/update` -- update watchlist item
- `GET /overstock` -- overstock items
- `POST /overstock/add` -- add overstock item
- `POST /overstock/add-items` -- bulk add overstock items
- `POST /overstock/acknowledge` -- acknowledge overstock
- `POST /overstock/rewatch` -- rewatch overstock item
- `POST /overstock/delete` -- delete overstock item
- `POST /overstock/update-target` -- update overstock target
- `POST /overstock/check-now` -- force overstock check
- `GET /overstock/suggestions` -- overstock suggestions

### `/scout-alerts` (public)
- `GET /list` -- list scout alerts
- `POST /claim` -- claim a scout alert
- `POST /refresh` -- refresh scout alerts

### `/opportunities` (public)
- `GET /` -- list opportunities
- `POST /dismiss` -- dismiss opportunity
- `POST /undismiss` -- undismiss opportunity
- `GET /dismissed` -- dismissed opportunities
- `GET /research` -- research opportunities
- `POST /research` -- create research opportunity
- `POST /research/:id/mark` -- mark research finding
- `POST /research/:id/mark-all-high` -- mark all high-value
- `POST /research/:id/review` -- review research
- `POST /research/:id/dismiss` -- dismiss research
- `DELETE /research/:id` -- delete research

### `/api/fitment` (public)
- `GET /lookup` -- fitment lookup
- `GET /stats` -- fitment stats

### `/api/listing-tool` (public)
- `GET /ebay-lookup` -- eBay listing lookup
- `GET /parts-lookup` -- parts lookup for listing tool
- `POST /save-fitment` -- save fitment data
- `GET /intelligence` -- listing intelligence
- `POST /save-listing-intel` -- save listing intelligence

### `/part-location` (public)
- `GET /:partType/:make/:model/:year` -- get part location
- `POST /confirm` -- confirm part location
- `POST /flag-wrong` -- flag incorrect location

### `/vin` (public)
- `POST /decode-photo` -- decode VIN from photo
- `POST /scan` -- scan/decode a VIN
- `GET /history` -- VIN decode history
- `GET /test-local/:vin` -- test local decoder

### `/stale-inventory` (public)
- `POST /run` -- run stale inventory analysis
- `GET /actions` -- get stale inventory actions
- `POST /returns` -- log a return
- `GET /returns/pending` -- pending returns
- `POST /returns/:id/relisted` -- mark return as relisted
- `POST /returns/:id/scrapped` -- mark return as scrapped
- `POST /restock/scan` -- scan for restock candidates
- `GET /restock/flags` -- restock flags
- `POST /restock/:id/acknowledge` -- acknowledge restock flag
- `GET /candidates` -- stale inventory candidates
- `POST /revise-price` -- revise listing price via eBay API
- `POST /end-item` -- end listing via eBay API
- `POST /relist-item` -- relist item via eBay API
- `POST /bulk-end` -- bulk end listings

### `/competitors` (public)
- `POST /scan` -- scan a competitor
- `GET /alerts` -- competitor alerts
- `POST /alerts/:id/dismiss` -- dismiss an alert
- `GET /gap-intel` -- gap intelligence
- `GET /emerging` -- emerging competitor analysis
- `POST /cleanup` -- clean up old competitor data
- `POST /auto-scrape` -- trigger auto-scrape
- `POST /dismiss` -- dismiss competitor finding
- `POST /undismiss` -- undismiss competitor finding
- `POST /mark` -- mark a competitor finding
- `GET /marks` -- list marks
- `DELETE /mark/:id` -- delete mark
- `PATCH /mark/:id` -- update mark
- `POST /mark/graduate` -- graduate mark to action
- `GET /mark/check-vehicle` -- check vehicle in marks
- `POST /seed-defaults` -- seed default competitors
- `DELETE /:sellerId` -- delete tracked seller
- `POST /:sellerId/scrape` -- scrape specific seller
- `GET /:sellerId/best-sellers` -- seller best sellers
- `GET /sellers` -- list tracked sellers

### `/autolumen` (public)
- `POST /import/listings` -- import Autolumen listings CSV
- `POST /import/sales` -- import Autolumen sales CSV
- `POST /import/transactions` -- import Autolumen transactions CSV
- `GET /stats` -- Autolumen stats

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

### `/trim-intelligence` (public)
- `GET /:year/:make/:model/:trim` -- trim-level intelligence

### `/ebay-messaging` (public)
- `GET /status` -- messaging system status
- `GET /history` -- message history
- `GET /templates` -- message templates
- `POST /poll` -- poll for new messages
- `POST /process` -- process pending messages
- `POST /test-send` -- test send a message

### `/api/instant-research` (public)
- `GET /` -- instant research results
- `GET /quick` -- quick research lookup
- `POST /apify` -- trigger Apify research scrape
- `GET /years` -- available years
- `GET /makes` -- available makes
- `GET /models` -- available models
- `GET /engines` -- available engines

### `/return-intelligence` (public)
- `GET /summary` -- return intelligence summary
- `GET /by-part-type` -- returns by part type
- `GET /problem-parts` -- problem parts analysis
- `GET /repeat-returners` -- repeat returner analysis
- `GET /by-make` -- returns by make
- `GET /monthly-trend` -- monthly return trend
- `GET /inad` -- INAD (Item Not As Described) analysis
- `GET /high-value-alerts` -- high-value return alerts

### `/flyway` (public)
- `GET /trips` -- list trips
- `GET /trips/:id` -- get trip detail
- `POST /trips` -- create trip
- `PATCH /trips/:id` -- update trip
- `DELETE /trips/:id` -- delete trip
- `POST /trips/:id/yards` -- add yard to trip
- `DELETE /trips/:tripId/yards/:yardId` -- remove yard
- `POST /trips/:id/reinstate` -- reinstate expired trip
- `GET /cleanup-preview` -- preview cleanup of expired trips
- `GET /trips/:id/attack-list` -- trip attack list
- `GET /vehicle/:vehicleId/parts` -- vehicle parts detail
- `GET /active-yards` -- yards on active trips
- `GET /available-yards` -- yards available to add
- `POST /trips/:id/scrape` -- trigger trip scrape
- `GET /trips/:id/scrape-status` -- scrape status for trip

### `/phoenix` (public)
- `GET /` -- dead listing harvest results
- `GET /stats` -- phoenix stats
- `GET /sellers` -- tracked sellers
- `POST /sellers` -- add tracked seller
- `DELETE /sellers/:name` -- remove tracked seller
- `POST /sellers/:name/scrape` -- scrape seller for dead listings

### `/private` (auth + admin for some)
- `GET /ebay-challenger-api` -- eBay challenger API (public)
- `POST /ebay-challenger-api` -- eBay challenger API post (public)
- `GET /cache/flush` -- flush cache (admin)
- `GET /cache/stats` -- cache stats (admin)
