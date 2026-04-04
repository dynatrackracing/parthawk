# SNAPSHOT_SCRAPERS.md
Generated 2026-04-01

## Scraper Overview Table

| Scraper | Chain | Method | IP Requirement | VIN? | Locations |
|---|---|---|---|---|---|
| LKQScraper | LKQ Pick Your Part | curl + cheerio (no browser) | Datacenter OK | Yes | Raleigh, Durham, Greensboro, East NC, Tampa, Largo, Clearwater |
| PullAPartScraper | Pull-A-Part | Playwright headed + REST API | Datacenter OK (headed required) | Yes | 25+ locations (Birmingham, Charlotte, Nashville, etc.) |
| UPullAndSaveScraper | U Pull & Save / Bessler's | axios POST (YardSmart AJAX) | Datacenter OK | Yes | Hebron KY, Louisville KY, Lexington KY, Savannah TN |
| ChesterfieldScraper | Chesterfield Auto Parts | Playwright (form iteration) | Datacenter OK | No | Richmond, Midlothian, Fort Lee (VA) |
| CarolinaPickNPullScraper | Carolina PNP | Playwright + stealth | Residential ONLY (403 on DC) | No | Wilmington, Fayetteville, Conway SC |
| PickAPartVAScraper | Pick-A-Part VA | Playwright + stealth | Residential ONLY (Cloudflare) | Maybe | Fredericksburg, Stafford (VA) |
| FossScraper | Foss U-Pull-It | Playwright (multi-strategy) | Datacenter OK | Maybe | La Grange NC, Jacksonville NC |

## Scrape Flow Diagram

```
                    ┌──────────────────────────┐
                    │  FlywayScrapeRunner       │  Daily 6am UTC (Railway cron)
                    │  service/lib/             │
                    └──────────┬───────────────┘
                               │ delegates by chain
         ┌────────┬────────┬───┴───┬──────────┬──────────┐
         v        v        v       v          v          v
    PullAPart  Foss  Carolina  UPullSave  Chesterfield  PickAPartVA
         │        │        │       │          │          │
         └────────┴────────┴───┬───┴──────────┴──────────┘
                               v
                    yard_vehicle table (upsert)
                               │
                    PostScrapeService.enrichYard()
                        │         │          │
                  LocalVinDecoder  TrimTier  ScoutAlerts
```

## Per-Scraper Details

### LKQScraper (`service/scrapers/LKQScraper.js`)
- Server-rendered HTML from pyp.com (DotNetNuke CMS). No JSON API.
- Uses `curl` subprocess to bypass CloudFlare TLS fingerprinting (axios gets 403).
- Parses `div.pypvi_resultRow[id]` elements with cheerio. Fields: year, make, model, color, VIN, row, stock#, date available.
- Pagination via "Next Page" link detection, 500ms inter-page delay, max 100 pages.
- Mark-all-inactive-then-reactivate pattern. Vehicles not seen stay inactive; 7-day TTL for attack list.

### PullAPartScraper (`service/scrapers/PullAPartScraper.js`)
- Internal REST APIs at `inventoryservice.pullapart.com` and `enterpriseservice.pullapart.com`.
- **Must run headed** (`headless: false`) -- API rejects headless TLS on Windows. Window positioned off-screen (`-2400,-2400`).
- Flow: load pullapart.com/inventory -> wait 8s for `window.apiEndpoints` -> iterate makes via OnYard -> POST Vehicle/Search per make.
- Deduplicates by VIN. 1s delay between makes.

### UPullAndSaveScraper (`service/scrapers/UPullAndSaveScraper.js`)
- Pure AJAX via WordPress YardSmart plugin. POST to `/wp-admin/admin-ajax.php`.
- Single request per yard (`length=5000` returns all). Clean JSON with VIN, color, row, stock.
- Retry logic: 401 rate-limit -> 10s/20s exponential backoff, max 3 attempts.

### ChesterfieldScraper (`service/scrapers/ChesterfieldScraper.js`)
- WordPress site. Playwright iterates make dropdown -> model dropdown -> parses result table.
- Fields: Make, Model, Year, Color, Body, Engine, Yard Row. No VIN.

### CarolinaPickNPullScraper (`service/scrapers/CarolinaPickNPullScraper.js`)
- **Local-only** (datacenter IPs blocked). FlywayScrapeRunner skips if `RAILWAY_ENVIRONMENT` is set.
- Iterates 40 common makes via AJAX endpoint, then per-model search pages.
- Normalizes make: strips "TRUCK" suffix, MERCEDES -> MERCEDES-BENZ, MINI COOPER -> MINI.

### PickAPartVAScraper (`service/scrapers/PickAPartVAScraper.js`)
- Cloudflare-protected. Auto-discovers page structure (table, cards, or form strategies).
- Tries primary URL then fallback. Logs CF detection and aborts if challenged.

### FossScraper (`service/scrapers/FossScraper.js`)
- Multi-strategy extraction: data attributes, table rows, then regex card parsing.
- Pagination up to 20 pages. Skipped on Sundays by FlywayScrapeRunner (PriceCheck day conflict).

## eBay API Clients (`service/ebay/`)

| Client | Protocol | Auth | Purpose |
|---|---|---|---|
| TokenManager | OAuth2 Client Credentials | AppName + CertName | Manages cached access tokens (env var with expiry) |
| BrowseAPI | REST (Buy API) | Bearer token | Item search by category + seller filter |
| FindingsAPI | SOAP XML | AppName header | findItemsAdvanced, findCompletedItems (seller sold data) |
| TradingAPI | SOAP XML | IAF-TOKEN header | GetItem, ReviseItem (price), EndItem, RelistItem |
| SellerAPI | SOAP XML | eBayAuthToken in XML body | GetOrders (90d max), GetMyeBaySelling, SendMessageToPartner |
| TaxonomyAPI | REST (Commerce API) | Bearer token | Category compatibility property values (category 33563) |
| SoldItemsScraper | Playwright + stealth | None (browser scrape) | Scrape ebay.com/sch sold listings, dual layout (.s-card + .s-item) |
| MarketResearchScraper | Playwright + stealth | None (browser scrape) | Full research: active listings + sold items by keyword |

## Cron Runners + Schedules (Railway, `service/index.js`)

| Runner | Schedule (UTC) | What it does |
|---|---|---|
| YourDataManager.syncAll | `0 1,7,13,19 * * *` (4x/day) | eBay orders + listings sync (30d window) |
| CompetitorDripRunner | `0 0,5,12,18 * * *` (4x/day) | Random 0-45min jitter, picks least-recently-scraped seller, 1-2 pages via SoldItemsScraper |
| PriceCheckCronRunner | `0 2 * * 0` (Sun 2am) | Weekly batch of 35 listings, priority queue (never-checked first, then stalest, highest price), 3-6s delay |
| FlywayScrapeRunner | `0 6 * * *` (daily 6am) | Scrapes non-LKQ yards on active Flyway trips, then enrichYard() per yard |
| VIN decode (3am) | `0 3 * * *` | Post-scrape batch: 5 rounds x 200 VINs via LocalVinDecoder, then trim tier enrichment |
| VIN decode (8:40am) | `40 8 * * *` | Mop-up decode for morning scrape window |
| StaleInventoryService | `0 3 * * 3` (Wed 3am) | Weekly stale inventory automation |
| DeadInventoryService | `0 4 * * 1` (Mon 4am) | Weekly dead inventory scan |
| RestockService | `0 4 * * 2` (Tue 4am) | Weekly restock scan |
| CompetitorMonitorService | `0 4 * * 4` (Thu 4am) | Weekly competitor monitoring |
| EbayMessagingService poll | `*/15 * * * *` | Poll new orders for messaging |
| EbayMessagingService process | `*/2 * * * *` | Process message queue |
| CronWorkRunner | **DISABLED** | Was eBay seller processing via FindingsAPI (dead since Feb 2025). Item table frozen at 21K. |
| MarketDemandCronRunner | **DISABLED** | Was nightly market_demand_cache via Finding API. Replaced by Market Drip + yard sniper. |

## Sniper Scripts (Local Machine, Task Scheduler)

### run-importapart-drip.js (Market Drip)
- **Location:** repo root
- **Schedule:** 6 AM, 1 PM, 9 PM via `run-importapart-drip.bat` (Windows Task Scheduler)
- **3-bucket priority queue:** Bucket 1 = active inventory PNs (YourListing), Bucket 2 = sold-not-restocked (YourSale 365d, no active listing), Bucket 3 = importapart catalog (Item table). Deduped, highest bucket wins.
- **Comp quality filter:** Regex excludes AS-IS, FOR PARTS, UNTESTED, NOT WORKING, CORE ONLY, NEEDS PROGRAMMING, etc.
- **Mechanics:** sanitizePartNumberForSearch from partIntelligence.js, Playwright primary with stealth, PriceCheckServiceV2 cheerio fallback.
- **Pacing:** 3s delay between PNs, 200/batch, 3 runs/day = 600/day, ~17-day full cycle.
- **Output:** Upserts market_demand_cache with `source=market_drip`, writes PriceSnapshot for price history.
- **State:** File-based offset tracking (`importapart-drip-offset.json`), wraps when queue exhausted, skips PNs with fresh cache (<7d).

### run-yard-market-sniper.js (Yard Sniper)
- **Location:** `service/scripts/run-yard-market-sniper.js`
- **Trigger:** Manual via `run-yard-market-sniper.bat` after LKQ scrape
- **Pipeline:** active yard_vehicles (7d) -> match to inventory via Auto+AIC+Item join -> extractPartNumbers + sanitizePartNumberForSearch + deduplicatePNQueue from partIntelligence.js -> filter against fresh cache -> scrape via PriceCheckServiceV2 (quoted exact PN match).
- **Filters:** shouldExclude() from OpportunityService (skips complete engines/transmissions/body panels), price >= $50, stripSuffix for Chrysler/Ford revision codes.
- **Pacing:** 2-3s between scrapes, default 50 PNs/run, sorted by price descending.
- **Output:** Upserts market_demand_cache with `source=yard_sniper`, writes PriceSnapshot.

## Key Notes

1. **NHTSA eliminated** -- all VIN decoding uses LocalVinDecoder (`@cardog/corgi` offline, sub-15ms, zero network). Enrichment pipeline: corgi decode -> VDS trim lookup -> engine code lookup -> vin_cache write.
2. **FlywayScrapeRunner.enrichYard()** delegates to PostScrapeService which runs LocalVinDecoder + trim tier assignment + scout alert generation per yard after scrape.
3. **SoldItemsManager** extracts Clean Pipe fields on insert (Phase C) when storing competitor sold items from CompetitorDripRunner.
4. **PriceCheckCronRunner** batch size increased from 15 to 35/week. Priority queue: never-checked listings first, then stalest, both sorted by currentPrice DESC.
5. **LKQ scraper** is the only yard scraper that runs from the **yards.js route handler** (on-demand via UI). All other yards scrape via FlywayScrapeRunner daily cron or local scripts.
6. **market_demand_cache** is the pricing source of truth (see priceResolver.js). Three feeders: Market Drip (primary, source=market_drip), Yard Sniper (source=yard_sniper), PriceCheckService (source=weekly cron).
