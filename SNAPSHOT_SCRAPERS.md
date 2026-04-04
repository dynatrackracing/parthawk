# SNAPSHOT_SCRAPERS.md
Generated 2026-04-04

## Scraper Overview Table

| Scraper | Target | Method | IP Restriction | VIN Available | Schedule |
|---|---|---|---|---|---|
| LKQScraper | pyp.com (7 locations) | curl + cheerio (HTML) | None (curl bypasses CF TLS) | Yes | Local Task Scheduler (CF blocks Railway) |
| PullAPartScraper | pullapart.com (25+ locations) | Playwright headed + REST API | None (headed browser required) | Yes | Daily 6am UTC via FlywayScrapeRunner |
| FossScraper | fossupullit.com (2 NC locations) | Playwright headless | None | No | Daily 6am UTC via FlywayScrapeRunner |
| CarolinaPickNPullScraper | carolinapicknpull.com (3 locations) | Playwright + stealth | Residential IP only (403 on datacenter) | No | FlywayScrapeRunner (skipped on Railway) |
| UPullAndSaveScraper | upullandsave.com (4 KY/TN locations) | axios POST (YardSmart AJAX) | None | Yes | Daily 6am UTC via FlywayScrapeRunner |
| ChesterfieldScraper | chesterfieldauto.com (3 VA locations) | Playwright + stealth | None | No | Daily 6am UTC via FlywayScrapeRunner |
| PickAPartVAScraper | pickapartva.com (2 VA locations) | Playwright + stealth | Residential IP only (CF 403) | Maybe | FlywayScrapeRunner (local-only when CF active) |
| SoldItemsScraper | ebay.com sold listings | Playwright + stealth | None | N/A | 4x daily via CompetitorDripRunner |
| MarketResearchScraper | ebay.com active + sold listings | Playwright + stealth | None | N/A | On-demand (PriceCheckService, yard sniper) |

## Scrape Flow

```
FlywayScrapeRunner (daily 6am UTC)
  -> auto-complete expired Flyway trips
  -> cleanup expired trip vehicles (24h grace)
  -> get active scrapable yards (non-LKQ only)
  -> dispatch to per-chain scraper (PullAPart / Foss / Carolina / UPull / Chesterfield / PickAPart)
  -> PostScrapeService.enrichYard(yardId) per yard
       -> VinDecodeService (LocalVinDecoder)
       -> trim tier assignment
       -> scout alerts

LKQ runs separately via local Windows Task Scheduler (CloudFlare blocks Railway IPs)
  -> scrape-local.js + run-scrape.bat handle enrichment separately
```

## Per-Scraper Details

### LKQScraper.js
- **Path:** `service/scrapers/LKQScraper.js`
- **Purpose:** Scrapes LKQ Pick Your Part (pyp.com) server-rendered HTML inventory pages
- **Key methods:** `scrapeAll()`, `scrapeLocation(location)`, `fetchAllPages(location)`, `fetchWithCurl(url)`, `parseInventoryPage(html)`
- **Target:** `https://www.pyp.com/inventory/{slug}/?page={N}`
- **Locations:** Raleigh (1168), Durham (1142), Greensboro (1226), East NC (1227), Tampa (1180), Largo (1189), Clearwater (1190)
- **Restrictions:** Uses curl subprocess to bypass CloudFlare TLS fingerprinting (axios gets 403). 500ms delay between pages. Max 100 pages per location. CF blocks Railway entirely -- must run from local machine.
- **Data fields:** year, make, model, color, VIN, row, stock number, date added

### PullAPartScraper.js
- **Path:** `service/scrapers/PullAPartScraper.js`
- **Purpose:** Scrapes Pull-A-Part yards via their internal REST APIs through headed Playwright
- **Key methods:** `scrapeYard(yard)`, `fetchInventoryViaAPI(yard)`, `resolveLocationId(name)`
- **Target:** `inventoryservice.pullapart.com` REST APIs (Make/OnYard, Model, Vehicle/Search)
- **Locations:** 25+ (Birmingham, Knoxville, Nashville, Charlotte, etc.) via resolveLocationId() map
- **Restrictions:** Must use headed Playwright (`headless: false`) -- headless TLS rejected on Windows. 1s delay between makes. 120s timeout per make search. Browser window positioned off-screen (-2400,-2400).
- **Data fields:** year, make, model, VIN, row, dateYardOn (no color)

### FossScraper.js
- **Path:** `service/scrapers/FossScraper.js`
- **Purpose:** Scrapes Foss U-Pull-It inventory (La Grange, Jacksonville NC)
- **Key methods:** `scrapeAll()`, `scrapeLocation(location)`, `fetchInventory(location)`
- **Target:** `https://www.fossupullit.com/inventory`
- **Restrictions:** Dynamic JS site, Playwright required (headless OK). Three extraction strategies (data attrs, table rows, regex cards). Max 20 pagination pages. Skipped on Sundays (PriceCheck uses Playwright at 2am).
- **Data fields:** year, make, model, row, color (no VIN)

### CarolinaPickNPullScraper.js
- **Path:** `service/scrapers/CarolinaPickNPullScraper.js`
- **Purpose:** Scrapes Carolina Pick N Pull via WordPress AJAX + Playwright
- **Key methods:** `scrapeYard(yard)`, `fetchInventory(locationId, yardName)`
- **Target:** `https://carolinapicknpull.com/inventory/` + `inventorySelectUpdater.php` AJAX
- **Locations:** Wilmington (3), Fayetteville (10), Conway SC (9)
- **Restrictions:** IP-blocked on cloud/datacenter IPs (nginx 403). MUST run from residential IP. Iterates 40 makes x N models. Uses playwright-extra stealth plugin.
- **Data fields:** year, make, model, row, dateIn (no VIN, no color)

### UPullAndSaveScraper.js
- **Path:** `service/scrapers/UPullAndSaveScraper.js`
- **Purpose:** Scrapes U Pull & Save / Bessler's via YardSmart WordPress AJAX API
- **Key methods:** `scrapeYard(yard)`, `fetchInventory(yardSmartId, vehicleTypeId, yardName)`
- **Target:** `https://upullandsave.com/wp-admin/admin-ajax.php` (YardSmart integration)
- **Locations:** Hebron KY (232), Louisville KY (265), Lexington KY (595), Savannah TN (298)
- **Restrictions:** Pure AJAX, no browser needed. Returns 401 if hit too fast -- 10s/20s exponential backoff, 3 retries. Works from datacenter IPs.
- **Data fields:** year, make, model, VIN, color, row, stock number

### ChesterfieldScraper.js
- **Path:** `service/scrapers/ChesterfieldScraper.js`
- **Purpose:** Scrapes Chesterfield Auto Parts via form-driven search pages
- **Key methods:** `scrapeYard(yard)`, `fetchInventory(storeName, yardName)`
- **Target:** `https://chesterfieldauto.com/search-our-inventory-by-location/`
- **Locations:** Richmond, Southside (Midlothian), Ft. Lee
- **Restrictions:** Playwright required (JS form interaction). Iterates all makes x models via URL params. Works from datacenter IPs.
- **Data fields:** year, make, model, color, row, body, engine (no VIN)

### PickAPartVAScraper.js
- **Path:** `service/scrapers/PickAPartVAScraper.js`
- **Purpose:** Scrapes Pick-A-Part Virginia inventory (Fredericksburg, Stafford)
- **Key methods:** `scrapeYard(yard)`, `fetchInventory(locationName, yardName)`
- **Target:** `https://pickapartva.com/inventory-search/` (fallback: `/inventory/`)
- **Restrictions:** Cloudflare-protected -- MUST run from residential IP (datacenter gets 403). Auto-discovers page structure (table, cards, or form). Uses playwright-extra stealth.
- **Data fields:** year, make, model, VIN (maybe), color, row

## eBay Scrapers

### SoldItemsScraper.js
- **Path:** `service/ebay/SoldItemsScraper.js`
- **Purpose:** Scrapes eBay sold/completed listing pages for competitor intelligence
- **Key methods:** `scrapeSoldItems({seller, keywords, categoryId, maxPages})`, `scrapeSoldItemsByKeywords({keywords})`, `scrapeMultipleSellers(sellers)`, `extractItemsFromPage(page, seller)`
- **Target:** `https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1`
- **Restrictions:** Playwright stealth, 2-4s random delay between pages, UA rotation (5 agents), scrolls to trigger lazy loading. Handles both `.s-card__*` (2024+) and `.s-item__*` (legacy) layouts.
- **Data fields:** ebayItemId, title, soldPrice, soldDate, condition, seller, pictureUrl

### MarketResearchScraper.js
- **Path:** `service/ebay/MarketResearchScraper.js`
- **Purpose:** Full market research -- scrapes both active listings (competitor prices) and sold items
- **Key methods:** `fullMarketResearch({keywords, categoryId})`, `scrapeActiveListings({keywords})`, `scrapeSoldItems({keywords})`, `extractActiveListings(page)`, `extractSoldItems(page)`
- **Target:** `https://www.ebay.com/sch/i.html` (active + sold filters)
- **Restrictions:** No eBay API tokens used (browser-only to avoid attribution). 2-4s random delay, 3-5s delay between active and sold phases. Extracts seller feedback scores and shipping costs.
- **Data fields:** ebayItemId, title, currentPrice/soldPrice, seller, sellerFeedbackScore, condition, shippingCost, freeShipping, location

## Cron Runners

### FlywayScrapeRunner.js
- **Path:** `service/lib/FlywayScrapeRunner.js`
- **Schedule:** Daily 6:00 AM UTC (`0 6 * * *`)
- **Purpose:** Orchestrates daily scraping of all non-LKQ yards with active Flyway trips
- **Flow:** Auto-complete expired trips -> cleanup 24h-old vehicle data -> scrape each unique yard -> PostScrapeService.enrichYard() per yard
- **Restrictions:** 5-minute timeout per yard. 3s delay between yards. Skips Carolina PNP on Railway. Skips Foss on Sundays. Mutex via `this.running` flag.

### CompetitorDripRunner.js
- **Path:** `service/lib/CompetitorDripRunner.js`
- **Schedule:** 4x daily at 5am, noon, 6pm, midnight UTC (+ 0-45min random jitter)
- **Purpose:** Randomized micro-scrape of eBay competitor sold items (1-2 pages per run)
- **Flow:** Random 0-45min delay -> pick least-recently-scraped enabled seller -> scrape 1-2 pages via SoldItemsManager -> update seller stats
- **Restrictions:** Skips if all sellers scraped within 6 hours. Category 6030 (auto parts).

### CronWorkRunner.js -- DISABLED
- **Path:** `service/lib/CronWorkRunner.js`
- **Purpose:** Legacy eBay seller item processing (import + process via ItemDetailsManager)
- **Notes:** Commented out in index.js. Item table frozen at 21K records. Replaced by CompetitorDripRunner + YourData sync.

### MarketDemandCronRunner.js -- DISABLED
- **Path:** `service/lib/MarketDemandCronRunner.js`
- **Purpose:** Nightly update of market_demand_cache via eBay Finding API (findCompletedItems + findItemsByKeywords)
- **Notes:** Commented out in index.js. Cache now populated by PriceCheckService (weekly), yard sniper (on-demand), importapart drip (manual). 100ms delay between API calls. 24h cache TTL.

### PriceCheckCronRunner.js
- **Path:** `service/lib/PriceCheckCronRunner.js`
- **Schedule:** Sunday 2:00 AM UTC (`0 2 * * 0`)
- **Purpose:** Weekly price check for active eBay listings against market comps
- **Flow:** Get oldest unchecked active listings -> PriceCheckService.checkPrice() each -> 3-6s random delay between checks
- **Restrictions:** Batch size 15. 7-day cache window. Async-lock prevents concurrent runs.

## Key Notes

- NHTSA eliminated -- all VIN decode via LocalVinDecoder (`service/lib/LocalVinDecoder.js`)
- SoldItemsManager extracts Clean Pipe fields on insert (Phase C)
- MarketDemandCronRunner DISABLED -- Finding API dead, cache populated by PriceCheckService weekly + on-demand
- CronWorkRunner DISABLED -- Item table frozen at 21K records
- LKQ scraping runs from local Windows machine only (CloudFlare blocks Railway IPs)
- CarolinaPickNPull and PickAPartVA require residential IP (local machine)
- VIN decode crons at 3:00 AM and 8:40 AM UTC chase local scrapes
- YourData sync (orders + listings) runs 4x daily at 1, 7, 13, 19 UTC

## Sniper Scripts

### service/scripts/run-yard-market-sniper.js
- **Purpose:** Fill market_demand_cache for parts matched to recent yard vehicles. PN-only search, no keyword fallback.
- **Usage:** `node service/scripts/run-yard-market-sniper.js --dry-run` (default) or `--execute --limit=50`
- **Queue building flow:**
  1. Get active yard vehicles (last 7 days)
  2. Match to inventory parts via `Auto + AIC + Item` join
  3. Extract PNs from matched Item titles (`extractPartNumbers`)
  4. **Sanitize + dedup** via `sanitizePartNumberForSearch()` and `deduplicatePNQueue()` from partIntelligence.js (Phase E1) -- strips junk PNs, Ford ECU suffixes, dash-variant duplicates
  5. Filter against `market_demand_cache` (skip fresh entries <7d)
  6. Sort by Item.price descending, cap at `--limit`
  7. Scrape eBay sold comps via `PriceCheckServiceV2.scrapeSoldComps()` (quoted exact match, retry once)
  8. Write results to `market_demand_cache` with `key_type='pn'`, `source='yard_sniper'`
- **Dependencies:** `partIntelligence.js` (PN extraction + sanitization), `OpportunityService.shouldExclude` (skip engines/trans/panels), `PriceCheckServiceV2` (cheerio scraper)
- **Rate limit:** 2-3s random delay between scrapes
- **Gotcha:** Uses its own Knex instance (not the app's database singleton) -- requires `DATABASE_URL` env var
