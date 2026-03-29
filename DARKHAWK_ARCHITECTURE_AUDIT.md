# DARKHAWK ARCHITECTURE AUDIT

**Generated:** 2026-03-28
**Codebase:** github.com/dynatrackracing/parthawk
**Deployment:** Railway (zucchini-rebirth) at parthawk-production.up.railway.app
**Entry point:** `service/index.js` on port 9000

---

## 1. ENTRY POINT & STARTUP

**Main file:** `service/index.js`
**Port:** `process.env.PORT || 9000`

### Middleware chain (in order):
1. `compression()` — gzip
2. `bodyParser.json({ limit: '50mb' })`
3. `bodyParser.urlencoded({ extended: true, limit: '50mb' })`
4. `cors()`

### Route mounts (in order):
| Mount Path | Router File |
|---|---|
| `/items` | routes/items.js |
| `/cron` | routes/cron.js |
| `/autos` | routes/autos.js |
| `/users` | routes/user.js |
| `/filters` | routes/filters.js |
| `/sync` | routes/sync.js |
| `/intelligence` | routes/intelligence.js |
| `/market-research` | routes/market-research.js |
| `/pricing` | routes/pricing.js |
| `/demand-analysis` | routes/demand-analysis.js |
| `/price-check` | routes/price-check.js |
| `/yards` | routes/yards.js |
| `/attack-list` | routes/attack-list.js |
| `/cogs` | routes/cogs.js |
| `/api/parts` | routes/partsLookup.js (priority) |
| `/api/parts` | routes/parts.js |
| `/api/parts-lookup` | routes/partsLookup.js |
| `/restock` | routes/restockReport.js |
| `/restock-want-list` | routes/restock-want-list.js |
| `/scout-alerts` | routes/scout-alerts.js |
| `/opportunities` | routes/opportunities.js |
| `/api/fitment` | routes/fitment.js |
| `/api/listing-tool` | routes/listing-tool.js |
| `/part-location` | routes/part-location.js |
| `/vin` | routes/vin.js |
| `/stale-inventory` | routes/stale-inventory.js |
| `/competitors` | routes/competitors.js |
| `/trim-intelligence` | routes/trim-intelligence.js |
| `/admin` | express.static('public') |
| `/private` | routes/private.js |
| `/api/instant-research` | routes/instant-research.js |
| `/*` | SPA catch-all (client build) |

### Startup sequence:
1. Run `database.migrate.latest()` (auto-migrate)
2. `Model.knex(database)` (connect Objection.js ORM)
3. `app.listen(PORT)`
4. If `RUN_JOB_NOW === '1'`, run CronWorkRunner immediately
5. 10s after startup: load Auto models + generate ScoutAlerts
6. Check YourSale freshness: if >24h stale, trigger YourData sync

---

## 2. ROUTE MAP

### Attack List (Daily Feed)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/attack-list` | None | AttackListService.getAllYardsAttackList | Scored vehicles across all yards |
| GET | `/attack-list/vehicle/:id/parts` | None | AttackListService.scoreVehicle | On-demand parts for expanded vehicle |
| GET | `/attack-list/yard/:yardId` | None | AttackListService.getAttackList | Single yard attack list |
| GET | `/attack-list/summary` | None | AttackListService.getAllYardsAttackList | Quick yard summary |
| POST | `/attack-list/log-pull` | None | database | Log pulled part |
| POST | `/attack-list/visit-feedback` | None | database | Yard visit rating |
| GET | `/attack-list/last-visit/:yardId` | None | database | Recent visit feedback |
| POST | `/attack-list/manual` | None | AttackListService.scoreManualVehicles | Score pasted vehicle list |

### Competitors (Hunter's Perch)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| POST | `/competitors/scan` | None | CompetitorMonitorService | Run price scan |
| GET | `/competitors/alerts` | None | CompetitorMonitorService | Active alerts |
| POST | `/competitors/alerts/:id/dismiss` | None | CompetitorMonitorService | Dismiss alert |
| GET | `/competitors/gap-intel` | None | database (raw SQL) | Parts competitors sell that we don't |
| GET | `/competitors/emerging` | None | database (raw SQL) | New/accelerating competitor parts |
| POST | `/competitors/auto-scrape` | None | SoldItemsManager | Auto-scrape all sellers |
| POST | `/competitors/dismiss` | None | database | Dismiss intel item |
| POST | `/competitors/undismiss` | None | database | Un-dismiss |
| POST | `/competitors/mark` | None | database | Add to The Mark want list |
| GET | `/competitors/marks` | None | database | Get all marks |
| DELETE | `/competitors/mark/:id` | None | database | Remove mark |
| PATCH | `/competitors/mark/:id` | None | database | Update mark notes |
| POST | `/competitors/mark/graduate` | None | database | Auto-graduate sold marks |
| GET | `/competitors/mark/check-vehicle` | None | database | Check vehicle against marks |
| POST | `/competitors/seed-defaults` | None | database | Seed default sellers |
| DELETE | `/competitors/:sellerId` | None | database | Remove seller |
| POST | `/competitors/:sellerId/scrape` | None | SoldItemsManager | Scrape specific seller |
| GET | `/competitors/:sellerId/best-sellers` | None | database | Seller's top items |
| GET | `/competitors/sellers` | None | database | List tracked sellers |
| POST | `/competitors/cleanup` | None | database | Purge old data |

### Yards
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/yards` | None | database | All yards sorted by priority |
| GET | `/yards/:id/vehicles` | None | database | Vehicles at yard |
| POST | `/yards/scrape/lkq` | None | LKQScraper | Trigger LKQ scrape |
| GET | `/yards/scrape/status` | None | in-memory | Scrape progress |
| POST | `/yards/scrape/:id` | None | LKQScraper/FossScraper/PullAPartScraper | Scrape specific yard |
| GET | `/yards/status` | None | database | Scrape status all yards |
| POST | `/yards/:id/feedback` | None | database | Log visit feedback |

### Sync (eBay Data)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| POST | `/sync/your-data` | Admin | YourDataManager | Full sync (sales+listings) |
| POST | `/sync/your-orders` | Admin | YourDataManager | Sync sales only |
| POST | `/sync/your-listings` | Admin | YourDataManager | Sync listings only |
| POST | `/sync/sold-items` | Admin | SoldItemsManager | Scrape all competitor sellers |
| POST | `/sync/sold-items/:seller` | Admin | SoldItemsManager | Scrape specific seller |
| POST | `/sync/sold-items-by-keywords` | Admin | SoldItemsManager | Keyword-based scrape |
| GET | `/sync/your-listings` | Auth | YourListing | Paginated listings |
| GET | `/sync/your-sales` | Auth | YourSale | Paginated sales |
| GET | `/sync/your-sales/trends` | Auth | YourSale | Sales trends |
| GET | `/sync/health` | None | SellerAPI | eBay API connectivity |
| GET | `/sync/stats` | Auth | YourDataManager | Sync statistics |
| POST | `/sync/build-auto-index` | None | database | Build Auto+AIC from Item titles |
| POST | `/sync/import-items` | None | database | Bulk import items |
| POST | `/sync/import-sales` | None | database | Bulk import sales |
| POST | `/sync/import-listings` | None | database | Bulk import listings |
| POST | `/sync/configure-ebay` | None | SellerAPI | Set eBay credentials |
| GET | `/sync/ebay-status` | None | SellerAPI | Credential status |
| POST | `/sync/trigger` | None | YourDataManager | Background sync |

### Price Check
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/price-check/all` | None | YourListing + PriceCheck | Paginated listings with verdicts |
| POST | `/price-check/bulk` | None | PriceCheckService | Bulk price check (max 20) |
| POST | `/price-check/title` | None | PriceCheckService | Ad-hoc title price check |
| POST | `/price-check/:listingId` | None | PriceCheckService | Single listing check |
| GET | `/price-check/history/:listingId` | None | PriceCheck | Check history |
| POST | `/price-check/cron` | None | PriceCheckCronRunner | Manual cron trigger |
| GET | `/price-check/stats` | None | YourListing + PriceCheck | Coverage stats |
| POST | `/price-check/omit` | None | YourListing | Omit from checks |

### Intelligence
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/intelligence/what-to-pull` | Auth | WhatToPullService | Pull recommendations |
| GET | `/intelligence/pricing` | Auth | PricingService | Pricing recommendations |
| GET | `/intelligence/dead-inventory` | Auth | DeadInventoryService | Stale listings |
| GET | `/intelligence/opportunities` | Auth | OpportunityService | High-demand unstocked |
| GET | `/intelligence/summary` | Auth | Multiple services | Dashboard summary |

### Opportunities (Sky Watch)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/opportunities` | None | OpportunityService | Scored opportunities |

### Restock
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/restock/report` | None | database (raw SQL) | Restock report by make/model/part |
| GET | `/restock/found-items` | None | database | Claimed scout alerts |

### Restock Want List (Scour Stream)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/restock-want-list/items` | None | database | Active want list |
| GET | `/restock-want-list/just-sold` | None | database | Recently sold perch items |
| POST | `/restock-want-list/pull` | None | database | Toggle pulled status |
| POST | `/restock-want-list/find-in-yard` | None | database | Find in yards |
| POST | `/restock-want-list/add` | None | database | Add to want list |
| POST | `/restock-want-list/delete` | None | database | Delete from want list |
| GET | `/restock-want-list/watchlist` | None | database | Curated watchlist |
| POST | `/restock-want-list/watchlist/add` | None | database | Add to watchlist |
| POST | `/restock-want-list/watchlist/remove` | None | database | Remove from watchlist |
| POST | `/restock-want-list/watchlist/update` | None | database | Update watchlist item |

### Scout Alerts
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/scout-alerts/list` | None | ScoutAlertService | Paginated alerts |
| POST | `/scout-alerts/claim` | None | database | Mark alert claimed |
| POST | `/scout-alerts/refresh` | None | ScoutAlertService | Regenerate alerts |

### COGS (Nest Protector)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| POST | `/cogs/gate` | None | COGSService | Max spend for gate |
| POST | `/cogs/session` | None | COGSService | Full session calculation |
| GET | `/cogs/yard-profile/:yardId` | None | COGSService | Yard COGS profile |
| GET | `/cogs/yards` | None | database | All yards with fees |

### VIN & Fitment
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/trim-intelligence/:year/:make/:model/:trim` | None | TrimIntelligenceService | Trim research |
| GET | `/api/fitment/lookup` | None (CORS) | FitmentIntelligenceService | Fitment lookup |
| GET | `/api/fitment/stats` | None (CORS) | database | Fitment stats |
| GET | `/part-location/:partType/:make/:model/:year` | None | PartLocationService | Part location |
| POST | `/part-location/confirm` | None | PartLocationService | Confirm location |
| POST | `/part-location/flag-wrong` | None | PartLocationService | Flag wrong location |

### Listing Tool
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/api/listing-tool/ebay-lookup` | None (CORS) | axios/cheerio | Scrape eBay listing |
| GET | `/api/listing-tool/parts-lookup` | None (CORS) | database | Part fitment lookup |
| POST | `/api/listing-tool/save-fitment` | None (CORS) | database | Save fitment cache |

### Instant Research
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/api/instant-research` | None | PriceCheckService + database | Vehicle parts research |
| GET | `/api/instant-research/years` | None | database | Year picker |
| GET | `/api/instant-research/makes` | None | database | Make picker |
| GET | `/api/instant-research/models` | None | database | Model picker |
| GET | `/api/instant-research/engines` | None | database | Engine picker |

### Stale Inventory
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| POST | `/stale-inventory/run` | None | StaleInventoryService | Trigger automation |
| GET | `/stale-inventory/actions` | None | database | Action history |
| POST | `/stale-inventory/returns` | None | ReturnIntakeService | Log return |
| GET | `/stale-inventory/returns/pending` | None | ReturnIntakeService | Pending relists |
| POST | `/stale-inventory/returns/:id/relisted` | None | ReturnIntakeService | Mark relisted |
| POST | `/stale-inventory/returns/:id/scrapped` | None | ReturnIntakeService | Mark scrapped |
| POST | `/stale-inventory/restock/scan` | None | RestockService | Run restock scan |
| GET | `/stale-inventory/restock/flags` | None | RestockService | Get flags |
| POST | `/stale-inventory/restock/:id/acknowledge` | None | RestockService | Acknowledge flag |

### Items (Auth Required)
| METHOD | PATH | AUTH | HANDLER | PURPOSE |
|---|---|---|---|---|
| GET | `/items` | Auth | ItemLookupService | Items by part number |
| GET | `/items/auto` | Auth | ItemLookupService | Items for vehicle |
| GET | `/items/latest` | Auth | ItemLookupService | Latest items |
| GET | `/items/:id` | Auth | ItemLookupService | Item by ID |
| PUT | `/items/:id` | Admin | ItemLookupService | Update item |
| POST | `/items` | Admin | ItemLookupService | Create item |
| DELETE | `/items/:id` | Admin | ItemLookupService | Delete item |

### Direct Routes in index.js
| METHOD | PATH | AUTH | PURPOSE |
|---|---|---|---|
| GET | `/api/health-check` | None | Health check |
| GET | `/api/debug/market-cache` | None | Debug cache lookup |
| GET | `/api/debug/env-check` | None | Check env vars |
| GET | `/api/debug/makes` | None | Raw SQL diagnostic |
| POST | `/api/decode-vins` | None | Decode all undecoded VINs |
| POST | `/api/build-scrape-queue` | None | Build scrape queue |
| POST | `/api/market-price/run-batch` | None | Kick off market pricing |
| GET | `/api/market-price` | None | Single market price scrape |
| GET | `/api/market-price/status` | None | Cache status |
| POST | `/api/build-auto-index` | None | Build Auto+AIC from JSON |
| POST | `/api/admin/dedup-sales` | None | Remove duplicate sales |
| POST | `/api/admin/fix-engines` | None | Reformat engine strings |
| POST | `/api/admin/backfill-auto` | None | Backfill Auto table |
| POST | `/api/admin/seed-florida` | None | Seed Florida yards |

---

## 3. SERVICE DEPENDENCY GRAPH

| Service | Reads | Writes | External APIs | Depends On |
|---|---|---|---|---|
| **AttackListService** | Auto, Item, AIC, YourSale, YourListing, market_demand_cache | — | — | partIntelligence, trim-tier-config, MarketPricingService, platformMatch |
| **AutoService** | Auto, AIC, Item | Auto | eBay Taxonomy API | CacheManager, EbayQueryCacheManager |
| **COGSService** | yard | — | — | yard-cogs-reference config |
| **CompetitorMonitorService** | YourListing, Item, market_demand_cache | competitor_alert | — | partNumberUtils |
| **DeadInventoryService** | YourListing, SoldItem, Item, market_demand_cache, YourSale, dead_inventory | dead_inventory | — | partNumberUtils |
| **DemandAnalysisService** | YourSale, YourListing, SoldItem, CompetitorListing | — | — | — |
| **FitmentIntelligenceService** | fitment_intelligence | fitment_intelligence | eBay Trading API, eBay Taxonomy API | TradingAPI, TaxonomyAPI |
| **ItemLookupService** | Auto, AIC, Item, YourListing, YourSale | Item, AIC | — | AutoService, CacheManager |
| **MarketPricingService** | market_demand_cache | market_demand_cache | eBay search (scrape) | PriceCheckServiceV2, PriceCheckService, partIntelligence |
| **OpportunityService** | market_demand_cache, YourListing, YourSale | — | — | partIntelligence |
| **PartLocationService** | part_location | part_location | **Anthropic Claude API** (web_search) | — |
| **PartNumberService** | — | — | — | — |
| **PriceCheckService** | PriceCheck | PriceCheck | eBay search (Playwright) | smart-query-builder, relevance-scorer |
| **PriceCheckServiceV2** | — | — | eBay search (axios+cheerio) | smart-query-builder |
| **PricePredictionService** | YourListing, YourSale, SoldItem, CompetitorListing | — | — | — |
| **PricingService** | YourListing, YourSale, SoldItem, Item | — | — | — |
| **RestockService** | YourSale, YourListing | restock_flag | — | partNumberUtils |
| **ReturnIntakeService** | — | return_intake | — | — |
| **ScoutAlertService** | yard_vehicle, yard, restock_want_list, YourSale | scout_alerts, scout_alerts_meta | — | partMatcher, partIntelligence |
| **StaleInventoryService** | YourListing, stale_inventory_action, market_demand_cache | stale_inventory_action | **eBay Trading API** (ReviseItem) | — |
| **TrimIntelligenceService** | trim_intelligence | trim_intelligence | **Anthropic Claude API** (web_search) | — |
| **VinDecodeService** | vin_cache | vin_cache | **NHTSA VIN Decoder** | — |
| **WhatToPullService** | SoldItem, YourSale, Item | — | — | — |

### Cron Runners
| Runner | Reads | Writes | External APIs |
|---|---|---|---|
| **CronWorkRunner** | Item, Competitor | Cron | eBay (via SellerItemManager) |
| **MarketDemandCronRunner** | Item | market_demand_cache | eBay Finding API |
| **PriceCheckCronRunner** | YourListing, PriceCheck | PriceCheck | eBay search (Playwright) |

---

## 4. DATABASE SCHEMA (ACTUAL)

### Core Tables
| Table | Key Columns | Purpose |
|---|---|---|
| **Auto** | id, year, make, model, trim, engine | Vehicle compatibility reference |
| **Item** | id, ebayId, title, price, seller, partNumberBase, manufacturerPartNumber | Inventory parts (importapart, pro-rebuild, dynatrack) |
| **AutoItemCompatibility** | autoId, itemId | Links vehicles to parts |
| **User** | id, email, isAdmin, isVerified | Authentication |

### Your eBay Data
| Table | Key Columns | Purpose |
|---|---|---|
| **YourSale** | id, ebayOrderId, ebayItemId, title, salePrice, soldDate, store | Your sold items |
| **YourListing** | id, ebayItemId, title, currentPrice, listingStatus, store, isProgrammed | Your active listings |

### Competitor Data
| Table | Key Columns | Purpose |
|---|---|---|
| **SoldItem** | id, ebayItemId, title, soldPrice, soldDate, seller | Competitor sold items |
| **SoldItemSeller** | name (PK), enabled, lastScrapedAt | Tracked sellers |
| **CompetitorListing** | id, ebayItemId, title, currentPrice, seller | Active competitor listings |
| **Competitor** | name (PK), enabled | Legacy competitor tracking |

### Market Intelligence
| Table | Key Columns | Purpose |
|---|---|---|
| **market_demand_cache** | part_number_base (unique), ebay_avg_price, ebay_sold_90d, market_score | eBay price cache |
| **PriceCheck** | id, listingId, marketMedian, compCount, verdict | Per-listing price checks |
| **PriceSnapshot** | id, keywords, soldCount, soldPriceMedian | Point-in-time snapshots |
| **MarketResearchRun** | id, yourListingId, keywords, status | Research job tracking |
| **competitor_alert** | id, competitor_seller, alert_type, our_price, competitor_price | Price alerts |

### Yard & Vehicles
| Table | Key Columns | Purpose |
|---|---|---|
| **yard** | id, name, chain, distance_from_base, entry_fee, enabled | Junkyard locations |
| **yard_vehicle** | id, yard_id, year, make, model, trim, vin, date_added, last_seen, active, decoded_trim, trim_tier | Vehicles at yards |
| **yard_visit_feedback** | id, yard_id, rating, notes | Visit ratings |
| **pull_session** | id, yard_id, date, parts_cost, total_true_cogs | Pull session COGS |

### Inventory Management
| Table | Key Columns | Purpose |
|---|---|---|
| **dead_inventory** | id, part_number_base, days_listed, failure_reason | Dead stock tracking |
| **stale_inventory_action** | id, ebay_item_id, action_type, old_price, new_price, tier | Price reduction log |
| **restock_flag** | id, part_number_base, restock_score, acknowledged | Restock signals |
| **return_intake** | id, ebay_item_id, condition_grade, relist_status | Return processing |

### Want Lists & Alerts
| Table | Key Columns | Purpose |
|---|---|---|
| **restock_want_list** | id, title, active, pulled | Manual want list |
| **restock_watchlist** | id, part_number_base, target_stock, priority | PN-based watchlist |
| **scout_alerts** | id, source, source_title, part_value, yard_name, vehicle_year/make/model, claimed | Part-to-yard alerts |
| **scout_alerts_meta** | key, value | Alert generation metadata |
| **the_mark** | id, normalizedTitle, originalTitle, partNumber, active, trim_tier | Hunter's Perch want list |
| **dismissed_intel** | normalizedTitle (PK), originalTitle | Dismissed gap intel |

### Fitment & Trim
| Table | Key Columns | Purpose |
|---|---|---|
| **trim_catalog** | id, year, make, model, trim_raw, trim_name, tier | eBay Taxonomy trim data |
| **trim_catalog_tracked** | id, year, make, model, trim_count | Cataloged combos |
| **trim_intelligence** | id, year, make, model, trim, expected_parts, confidence | Claude-researched trim packages |
| **fitment_intelligence** | id, part_type, make, model, year_start, year_end, fits_trims, does_not_fit_trims | Fitment negations |
| **fitment_data** | (from SQL seed) | Confirmed fitment data |
| **part_fitment_cache** | id, part_number_base, year, make, model, engine, trim, does_not_fit | Listing tool fitment cache |

### Platform Cross-Reference
| Table | Key Columns | Purpose |
|---|---|---|
| **platform_group** | id, platform, year_start, year_end | Shared platform definitions |
| **platform_vehicle** | id, group_id, make, model | Vehicles in platform |
| **platform_shared_part** | id, group_id, part_types | Shared parts across platform |

### VIN & Location
| Table | Key Columns | Purpose |
|---|---|---|
| **vin_cache** | id, vin (unique), year, make, model, trim, engine | NHTSA decode cache |
| **vin_scan_log** | id, vin, year, make, model, scanned_at, source | Scan history |
| **ai_vehicle_research** | id, year, make, model, research | Claude research cache |
| **part_location** | id, part_type, make, model, location_text, removal_steps | Part location in vehicle |
| **instant_research_cache** | id, vehicle_key (unique), results | Research results cache |

### Misc
| Table | Key Columns | Purpose |
|---|---|---|
| **Cron** | id, total, processed, elapsed | Cron job metrics |
| **InterchangeNumber** | id, interchangeNumber | Part interchange data |
| **ItemInterchangeNumber** | manufacturerPartNumber, interchangePartId | Join table |

### Orphaned Tables (exist in migrations, minimal/no service references)
- **PriceSnapshot** — created but rarely queried
- **CompetitorListing** — 0 rows currently, populated only during market research runs
- **fitment_data** — created by SQL seed, used by listing tool lookup
- **fitment_scrape_queue** — created by SQL seed, not actively used

---

## 5. FRONTEND FEATURE MAP

### DAILY FEED (`/admin/pull` → attack-list.html)
- **API calls:** `GET /attack-list?since=`, `GET /attack-list/vehicle/:id/parts`, `POST /attack-list/manual`, `POST /yards/scrape/lkq`, `GET /part-location/...`, `GET /api/instant-research`, `POST /vin/decode-photo`
- **Features:** Yard tabs, date filter (Today/3d/7d/30d/All), vehicle cards with score badges, expandable part details, market data display, trim badges, manual set list paste, VIN camera scanner, part location lookup
- **Data:** Scored vehicles from yard_vehicle + inventory matching + YourSale demand

### SCOUT ALERTS (`/admin/scout-alerts` → scout-alerts.html)
- **API calls:** `GET /scout-alerts/list`, `POST /scout-alerts/claim`, `POST /scout-alerts/refresh`
- **Features:** Yard filter, time filter, hide pulled toggle, source badges (QUARRY/STREAM), confidence levels
- **Data:** Matched want list parts against active yard vehicles

### HAWK EYE (`/admin/vin` → vin-scanner.html)
- **API calls:** `POST /vin/decode-photo`, `POST /vin/scan`, `GET /api/instant-research`, `GET /vin/history`
- **Features:** VIN input, camera scanner, decode display, market research, scan history

### NEST PROTECTOR (`/admin/gate` → gate.html)
- **API calls:** `GET /cogs/yards`, `GET /cogs/yard-profile/:id`
- **Features:** Yard selector, parts at register form, COGS calculator, blended rate display, color-coded verdict

### SCOUR STREAM (`/admin/restock-list` → restock-list.html)
- **API calls:** `GET /restock-want-list/watchlist`, `GET /restock-want-list/items`, `POST /restock-want-list/pull`, `POST /restock-want-list/find-in-yard`, `GET /restock-want-list/just-sold`
- **Features:** Watchlist tab (PN-based), Want List tab (title-based), pulled status, yard search, just-sold alerts

### THE QUARRY (`/admin/restock` → restock.html)
- **API calls:** `GET /restock/report?days=`, `GET /restock/found-items`
- **Features:** Period selector, tiered restock report (green/yellow/orange), found-in-yard badges

### SKY WATCH (`/admin/opportunities` → opportunities.html)
- **API calls:** `GET /opportunities?sort=`
- **Features:** Sortable opportunity cards, score breakdown, recommendation levels

### HUNTERS PERCH (`/admin/hunters-perch` → hunters-perch.html)
- **API calls:** `GET /competitors/gap-intel`, `GET /competitors/emerging`, `GET /competitors/sellers`, `POST /competitors/:seller/scrape`, `POST /competitors/mark`, `POST /competitors/dismiss`
- **Features:** Gap intel with scoring, emerging parts detection, seller tracking, mark/dismiss actions

### THE MARK (`/admin/the-mark` → the-mark.html)
- **API calls:** None (iframe to external listing tool)
- **Features:** Embedded listing cleaner at listcleaner.dynatrackracingnc.workers.dev

### LISTING TOOL (`/admin/listing-tool` → listing-tool.html)
- **API calls:** `GET /api/fitment/lookup`, `GET /api/listing-tool/ebay-lookup`, `GET /api/listing-tool/parts-lookup`, `POST /api/listing-tool/save-fitment`, Anthropic Claude API direct
- **Features:** Part number lookup, donor vehicle input, Claude AI listing generation, programming database, fitment warnings

### CSV IMPORT (`/admin/import` → import.html)
- **API calls:** `POST /api/parts/import/csv`
- **Features:** Store selector, file picker, import results

---

## 6. DATA FLOW CHAINS

### a. LKQ scrape → yard_vehicle → attack list → UI
```
scrape-local.js (local machine, curl → LKQ pyp.com HTML)
  → INSERT yard_vehicle (year, make, model, vin, date_added, row_number)
  → NHTSA VIN decode → UPDATE yard_vehicle (engine, drivetrain, trim_level)
  → decode-yard-vins.js → UPDATE yard_vehicle (decoded_trim, trim_tier)

GET /attack-list?since=
  → AttackListService.getAllYardsAttackList()
    → SELECT yard_vehicle WHERE active=true AND last_seen >= since
    → buildInventoryIndex() (Auto + Item + AIC)
    → buildSalesIndex() (YourSale last 90d)
    → buildStockIndex() (YourListing active)
    → buildPlatformIndex() (platform_group + platform_vehicle)
    → scoreVehicle() per vehicle
      → match parts by make|model|year
      → recency-weighted avg price from YourSale
      → trim multiplier from trim-tier-config
    → MarketPricingService.getCachedPrice() (market_demand_cache enrichment)
  → Frontend renders: score badge, part chips, trim badge, age badge
```

### b. eBay sync → YourSale → restock scoring
```
YourDataManager.syncAll() (cron every 6h)
  → SellerAPI.getOrders(daysBack) → INSERT/UPDATE YourSale
  → SellerAPI.getActiveListings() → INSERT/UPDATE YourListing

GET /restock/report?days=30
  → Raw SQL: JOIN YourSale + YourListing + market_demand_cache
  → Group by make/model/partType
  → Score: sold count, avg price, current stock, market demand
  → Tier: green (75+), yellow (60-74), orange (40-59)
```

### c. Market demand cache → Daily Feed UI
```
MarketDemandCronRunner.work() (nightly 3am)
  → SELECT DISTINCT partNumberBase FROM Item
  → eBay Finding API findCompletedItems per PN
  → UPSERT market_demand_cache (soldCount, avgPrice, activeListings)

Attack list vehicle expansion:
  → MarketPricingService.getCachedPrice(cacheKey)
  → SELECT FROM market_demand_cache WHERE part_number_base = cacheKey
  → Displayed as "Market ref" line under each part
```

### d. VIN photo → Claude Vision → NHTSA → part lookup
```
POST /vin/decode-photo (body: {image: base64})
  → Anthropic Claude API (claude-sonnet-4-20250514)
    → Claude extracts VIN text from image
  → NHTSA DecodeVin API
    → Returns: year, make, model, trim, engine, drivetrain
  → INSERT vin_scan_log
  → Response → frontend renders vehicle info + instant research
```

### e. Item + Auto + AIC → part lookup → consumers
```
CronWorkRunner (every 6h) / sync/build-auto-index
  → SellerItemManager fetches items from eBay sellers
  → ItemDetailsManager enriches with compatibility
  → INSERT Item + Auto + AutoItemCompatibility

Consumers:
  → AttackListService.buildInventoryIndex() — scores yard vehicles
  → ItemLookupService — search/filter items
  → MarketDemandCronRunner — gets distinct PNs for cache updates
  → ScoutAlertService — matches want list against inventory
  → WhatToPullService — pull recommendations
```

### f. Competitor data (Hunter's Perch) → downstream
```
POST /competitors/:seller/scrape
  → SoldItemsManager.scrapeCompetitor()
    → FindingsAPI.fetchAllCompletedItems() (or scraper fallback)
    → INSERT SoldItem (title, soldPrice, soldDate, seller)

GET /competitors/gap-intel
  → SELECT SoldItem WHERE seller != dynatrack
  → GROUP BY normalizedTitle, compare against YourSale + YourListing + Item
  → Result: parts competitors sell that we don't
  → Feeds: dismissed_intel, the_mark (user actions)

GET /competitors/emerging
  → Detect NEW (first appearance) and ACCEL (velocity spike) parts
```

### g. PriceCheckService → cache consumers
```
PriceCheckService.checkPrice(listingId, title, price)
  → buildSearchQuery(title) — PN-first, keyword fallback
  → scrapeSoldItems(query) — Playwright or axios+cheerio
  → filterRelevantItems() (skip for PN searches)
  → calculateMetrics() → verdict
  → INSERT PriceCheck (marketMedian, compCount, verdict)

Consumers:
  → GET /price-check/all — paginated listings with verdicts
  → GET /attack-list/vehicle/:id/parts — market enrichment
  → StaleInventoryService — check comps before price reduction
```

---

## 7. ENVIRONMENT VARIABLES

### Database
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (production) |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Fallback (dev) |
| `DB_TEST_NAME` | Test database |
| `DB_LOGGING` | Enable SQL logging |

### eBay APIs
| Variable | Purpose |
|---|---|
| `TRADING_API_DEV_NAME` | Developer account name |
| `TRADING_API_APP_NAME` | App ID / Client ID |
| `TRADING_API_CERT_NAME` | Certificate / Client Secret |
| `TRADING_API_TOKEN` | IAF auth token |
| `FINDINGS_APP_NAME` | Finding API app name |
| `REDIRECT_URL` | OAuth redirect |
| `VERIFICATION_TOKEN` | Webhook signature |

### Third Party
| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API (PartLocation, TrimIntelligence, VIN route) |
| `APIFY_TOKEN` | Apify scraper (run-apify-market-refresh.js) |

### Firebase
| Variable | Purpose |
|---|---|
| `FIREBASE_BASE_64` | Base64-encoded service account JSON |

### Server
| Variable | Purpose |
|---|---|
| `PORT` | Express port (default 9000) |
| `NODE_ENV` | Environment (development/production) |
| `RUN_JOB_NOW` | Set to '1' to run CronWorkRunner on startup |
| `ITEM_PROCESS_BATCH` | Item batch size (default 700) |

---

## 8. SCHEDULED TASKS & AUTOMATION

| Schedule | Time (UTC) | Runner | Purpose | Tables Touched |
|---|---|---|---|---|
| `0 */6 * * *` | Every 6h | CronWorkRunner | eBay seller processing | Item, Cron |
| `0 1,7,13,19 * * *` | 4x daily | YourDataManager.syncAll | Sync sales + listings | YourSale, YourListing |
| `0 2 * * *` | Daily 2am | LKQScraper.scrapeAll | Nightly yard scrape | yard_vehicle |
| `0 2 * * 0` | Sunday 2am | PriceCheckCronRunner | Weekly price checks | PriceCheck |
| `0 3 * * *` | Daily 3am | MarketDemandCronRunner | Update market cache | market_demand_cache |
| `0 3 * * 3` | Wed 3am | StaleInventoryService | Stale inventory automation | stale_inventory_action |
| `0 4 * * 1` | Mon 4am | DeadInventoryService | Dead inventory scan | dead_inventory |
| `0 4 * * 2` | Tue 4am | RestockService | Restock scan | restock_flag |
| `0 4 * * 4` | Thu 4am | CompetitorMonitorService | Competitor monitoring | competitor_alert |
| `0 11 * * *` | Daily 11am | competitors.js cron | Auto-scrape sellers + graduate marks | SoldItem, the_mark |
| Startup +10s | Once | ScoutAlertService | Generate alerts | scout_alerts |

### Local pipeline (run-scrape.bat):
```
scrape-local.js → build-trim-catalog.js → decode-yard-vins.js
```

---

## 9. DEAD CODE & ORPHANED TABLES

### Services never imported by routes:
- **PricingService.js** — imported by `intelligence.js` route but that requires auth (React admin only)
- **WhatToPullService.js** — imported by `intelligence.js` route (auth required)
- **PricePredictionService.js** — imported by `pricing.js` route (auth required)

### Tables with zero rows / minimal use:
- **CompetitorListing** — 0 rows, only populated during MarketResearchRun (rarely triggered)
- **PriceSnapshot** — created but no service actively writes to it
- **fitment_scrape_queue** — created by SQL seed, not referenced by any service

### Frontend features calling endpoints that exist but may return empty:
- **Market data on attack list parts** — `market_demand_cache` was purged, will repopulate over time
- **Pricing insights** (React admin) — requires auth, not used in DarkHawk

### Placeholder HTML pages:
- `alerts.html`, `competitors.html`, `sales.html` — "Coming soon" pages superseded by DarkHawk equivalents

### Deprecated utils:
- `partMatcher.js` — superseded by `partIntelligence.js` but still imported by ScoutAlertService
- `partNumberExtractor.js` — superseded by `partIntelligence.js`

---

## 10. DATA INTEGRITY RISKS

### No transactions on multi-table writes:
- `ScoutAlertService.generateAlerts()` — truncates scout_alerts then inserts new ones (crash between = empty alerts)
- `sync/build-auto-index` — bulk inserts Auto + AIC without transaction wrapper
- `competitors.js` auto-scrape route — updates SoldItemSeller + inserts SoldItem separately

### Race conditions:
- `CronWorkRunner` uses async-lock but `MarketDemandCronRunner` does not — concurrent market cache writes possible
- `PriceCheckCronRunner` uses async-lock correctly
- `StaleInventoryService.runAutomation()` makes eBay ReviseItem calls without dedup — could double-reduce if run twice

### Silent data loss risks:
- `scrape-local.js` uses early termination on duplicate pages — if LKQ changes pagination, new vehicles could be missed
- `SoldItemsManager` has consecutive dupe stop (10 dupes = stop) — could miss items if eBay results are interleaved
- `market_demand_cache` UPSERT overwrites previous data without preserving history

### Stale data risks:
- `vin_cache` has no TTL — decoded VINs are cached forever (fine for VINs, they don't change)
- `instant_research_cache` has no expiry mechanism
- `part_fitment_cache` has no TTL — manual fitment entries persist indefinitely

---

## 11. GAPS: SPEC vs REALITY

### Attack list scoring
**Status: WORKING.** `scoreVehicle()` computes demand (YourSale weighted avg), supply (stock count), and total value. Trim multipliers applied. Platform cross-reference active. Market enrichment from cache.

### Market demand cache
**Status: REBUILDING.** Cache was purged (broken keyword data). PN-first pipeline deployed. Nightly cron will repopulate via eBay Finding API. MarketPricingService also populates on-demand.

### Restock report
**Status: WORKING.** Uses YourSale + YourListing + market_demand_cache. Groups by make/model/partType with tiered scoring.

### Price check
**Status: WORKING.** PriceCheckService (V1 Playwright) + PriceCheckServiceV2 (axios+cheerio). PN-first query building deployed. Weekly cron runs Sunday 2am.

### Stale inventory
**Status: WORKING.** Auto-reduces prices via eBay TradingAPI ReviseItem. Standard vs programmed schedules. Runs Wednesday 3am.

### HAWK EYE camera
**Status: WORKING.** Camera capture → base64 → Claude Vision → VIN extraction → NHTSA decode → instant research. Full pipeline functional.

### HUNTERS PERCH
**Status: WORKING.** Scrapes competitor sellers via FindingsAPI. Gap intel + emerging detection. Mark/dismiss actions. Auto-scrape cron at 11am UTC daily.

### Daily Feed market data
**Status: REBUILDING.** market_demand_cache empty (purged). Will repopulate. Frontend correctly shows YourSale as primary, market as reference.

### VIN scanner
**Status: WORKING.** NHTSA decode with VIN cache. Scan history logging. No year/engine filtering currently — returns all matching parts.

### Paste set list
**Status: WORKING.** Multi-line parser handles: year+make+model, VIN, row, color, engine, drivetrain. VIN decode via NHTSA. Scores through same engine.

### Listing tool integration
**Status: WORKING.** `GET /api/listing-tool/parts-lookup` queries part_fitment_cache + fitment_data + Item+AIC. `GET /api/listing-tool/ebay-lookup` scrapes eBay listing pages. Claude AI generates descriptions.

### TradingAPI
**Status: PARTIAL.** GetItem implemented (with IAF token header). ReviseItem implemented in StaleInventoryService. EndItem NOT implemented. No RelistItem.

### Trim intelligence
**Status: WORKING.** trim_catalog populated from eBay Taxonomy API. VIN decode stores decoded_trim + trim_tier. Attack list applies trim multipliers. Premium brand floor in place.

---

*End of audit. Total: 29 route files, 23 services, 6 lib modules, 3 utils, 8 eBay modules, 3 middleware, 2 config files, 16 models, 59 migrations, 40+ tables, ~200+ API endpoints, 10 scheduled tasks.*
