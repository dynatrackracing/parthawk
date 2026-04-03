# SNAPSHOT_SCRAPERS.md — DarkHawk Scraper Layer

> Generated: 2026-04-01 | Source: `service/scrapers/`, `service/lib/FlywayScrapeRunner.js`

## Scraper Index

| Scraper | Target | Method | IP Requirement | VIN Available |
|---------|--------|--------|----------------|---------------|
| `LKQScraper.js` | LKQ Pick Your Part (pyp.com) | axios + cheerio (HTML) | Datacenter OK | Yes |
| `PullAPartScraper.js` | Pull-A-Part (4 locations) | Playwright headed (API) | Needs real TLS | Yes (via API) |
| `FossScraper.js` | Foss U-Pull-It (2 NC locations) | Puppeteer (JS site) | Datacenter OK | Unknown |
| `CarolinaPickNPullScraper.js` | Carolina PNP (3 locations) | HTTP (per-make search) | Residential only | No |
| `ChesterfieldScraper.js` | Chesterfield Auto Parts (3 VA) | Playwright (form+table) | Datacenter OK | No |
| `UPullAndSaveScraper.js` | U Pull & Save / Bessler's (4 KY/TN) | axios AJAX (YardSmart API) | Datacenter OK | Yes |
| `PickAPartVAScraper.js` | Pick-A-Part VA (2 VA locations) | Playwright (Cloudflare) | Residential only | Maybe |

---

## Scrape Flow

```
Cron / Manual Trigger
        |
        v
FlywayScrapeRunner.work()
        |
        +-- Step 1: Auto-complete expired Flyway trips
        +-- Step 2: Cleanup vehicles from expired trips (24h grace)
        +-- Step 3: Get active scrapable yards (non-LKQ only)
        |           Filter out LKQ (separate cron), manual, none
        |           Deduplicate yards across trips
        |
        +-- Step 4: For each yard, dispatch to scraper:
        |     chain="pull-a-part"    -> PullAPartScraper
        |     chain="foss"           -> FossScraper (skip Sundays)
        |     chain="carolina pnp"   -> CarolinaPickNPullScraper (skip on Railway)
        |     chain="upullandsave"   -> UPullAndSaveScraper
        |     chain="chesterfield"   -> ChesterfieldScraper
        |     chain="pickapartva"    -> PickAPartVAScraper
        |     (5-min timeout per yard, 3s delay between yards)
        |
        +-- Step 5: Enrich each scraped yard:
              PostScrapeService.enrichYard(yardId)
                +-- Batch VIN decode (50/batch via LocalVinDecoder)
                +-- Trim tier matching
                +-- Scout alert generation (background)
```

LKQ yards are scraped separately via a dedicated nightly cron (2am), not through FlywayScrapeRunner.

---

## LKQScraper.js

**Target:** LKQ Pick Your Part (pyp.com) -- 4 NC stores

**Locations:** Raleigh (1168), Durham (1142), Greensboro (1226), East NC (1227)

**Method:** Pure HTTP -- `axios` + `cheerio`. No browser needed. Server-rendered HTML (DotNetNuke CMS).

**URL Pattern:** `https://www.pyp.com/inventory/{slug}/?page={N}` (~25 vehicles/page)

**Data:** Year, make, model, color, VIN, section, row, stock number, available date

**Pagination:** Follows "Next Page" link until no vehicles with id= found

---

## PullAPartScraper.js

**Target:** Pull-A-Part chain -- 4 locations

**Locations:** Birmingham (5), Knoxville (10), Nashville (6), Charlotte (7)

**Method:** Playwright headed mode (headless fails on Windows TLS). Calls internal APIs:
- `enterpriseservice.pullapart.com/Location`
- `inventoryservice.pullapart.com/Make/`
- `inventoryservice.pullapart.com/Model?makeID=X`
- `inventoryservice.pullapart.com/Vehicle/Search` (POST)

**Pattern:** Iterates all makes to get full inventory per location

---

## FossScraper.js

**Target:** Foss U-Pull-It -- 2 NC locations

**Locations:** La Grange, Jacksonville

**Method:** Puppeteer (dynamic JS site, `fossupullit.com`)

**Note:** On-demand scrape only (not nightly). Skipped on Sundays (PriceCheck day).

---

## CarolinaPickNPullScraper.js

**Target:** Carolina Pick N Pull -- 3 locations

**Locations:** Wilmington (3), Fayetteville (10), Conway SC (9)

**Method:** HTTP per-make+model queries. No bulk inventory endpoint.

**Data:** Make, model, year, row, date-in (no VIN, no color)

**Restriction:** IP-blocked on cloud/datacenter IPs (403 from nginx). Must run from residential IP via `node scripts/scrape-carolina.js`. Skipped automatically on Railway.

---

## ChesterfieldScraper.js

**Target:** Chesterfield Auto Parts -- 3 VA locations

**Locations:** Richmond, Midlothian (Southside), Fort Lee

**Method:** Playwright (JS form submission + table parsing)

**Data:** Store, make, model, year, color, body, engine, yard row (no VIN)

**URL:** `chesterfieldauto.com/search-our-inventory-by-location/`

---

## UPullAndSaveScraper.js

**Target:** U Pull & Save / Road Tested Parts / Bessler's -- 4 KY/TN locations

**Locations:** Bessler's Hebron KY (232), Bessler's Louisville KY (265), Bluegrass Lexington KY (595), Raceway Savannah TN (298)

**Method:** Pure AJAX -- `axios` POST to WordPress admin-ajax.php (YardSmart integration). Returns clean JSON.

**API:** `action=yardsmart_integration`, `api_call=getInventoryDatatablesArray`, `length=5000` (all at once)

**Data:** Full vehicle info with VIN, color, row, stock

**Gotcha:** Returns 401 if hit too fast -- use 5s delays between locations

---

## PickAPartVAScraper.js

**Target:** Pick-A-Part Virginia -- 2 VA locations

**Locations:** Fredericksburg, Stafford

**Method:** Playwright (Cloudflare-protected WordPress site)

**Restriction:** Datacenter IPs get 403. Must run locally via `node scripts/scrape-pickapartva.js`.
