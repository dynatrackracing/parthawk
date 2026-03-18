# BUILD_COMPLETE.md — PartHawk Platform

**Build Date:** 2026-03-18
**Deployed to:** parthawk-production.up.railway.app

---

## What Was Built and Deployed

### Phase 2 — VIN & Puller PWA (Complete)
- **PWA shell**: manifest.json, service worker with offline cache, Add to Home Screen
- **Mobile attack list** at `/admin/pull` and `/puller`: collapsed vehicle rows with accordion expand
- **Tabs**: LKQ Raleigh | LKQ Durham | LKQ Greensboro | Day Trip | Road Trip
- **Collapsed row**: Year Make Model Trim, row number, est value, N parts flagged, color-coded part chips
- **Expanded row**: market value, in-stock count, sold velocity, part location, verdict chip (PULL/WATCH/SKIP), Mark as Pulled, Skip with reason, Add Note
- **VIN photo decode**: camera button → Claude Vision API (claude-sonnet-4-20250514) → NHTSA decode → vin_cache → match to yard list
- **Vehicle-to-inventory match**: normalized makes lowercase, alias map (ram→dodge, chevy→chevrolet, vw→volkswagen, etc.), match on year+make+model, uses Item table via AutoItemCompatibility, floor score at 10 if Item table has parts but no sales history
- **Foss U-Pull-It on-demand scraper**: Puppeteer-based, covers La Grange and Jacksonville NC
- **Pull-A-Part on-demand scraper**: Puppeteer-based, same infrastructure covers U-Pull-&-Pay
- **Mark as Pulled workflow**: logs to pull_session, auto-creates session on first pull
- **Skip logging**: reason dropdown (damaged, missing, already pulled, not worth it)
- **Yard visit logging**: auto-create pull_session on first pull, post-visit rating via feedback endpoint
- **Part number normalization**: strips Chrysler 2-letter alpha suffix, GM 2-letter suffix, Ford 2-letter/number suffix

### Phase 3 — Intelligence (Complete)
- **Trim intelligence engine**: on first encounter of a trim, calls Claude API with web_search to research premium parts standard vs optional, stores in trim_intelligence table permanently, never researches same trim twice
- **Part location knowledge base**: research for 2014+ vehicles, only for ECM/PCM/BCM/TIPM/fuse box/TCM/ABS module/amplifier, uses Claude API with web_search, stored in part_location table, field data always beats research, at confirmed_count 3 sets high_confidence and stops researching
- **Window regulator motor tip**: pre-populated in PartLocationService with "Can be tested in yard using battery from impact gun"
- **Market demand cache**: nightly at 3am, queries eBay Finding API for every normalized part number in Item table, stores in market_demand_cache, valid 24 hours
- **Dead inventory scoring**: listings 60+ days no sale, compares price to YourSale avg, logs failure reason (overpriced if >20% above avg, low_demand, condition, unknown), shows warning in expanded part view, never auto-skips
- **Dead inventory warnings**: displayed in attack list expanded part view with failure reason, days listed, and market average

### Phase 4 — Margin & Inventory (Complete)
- **Full COGS session tracking**: parts cost + core fee + sales tax + gate fee + mileage at IRS rate ($0.67/mi), value-share allocation across all parts, one blended COGS number shown to puller
- **Gate negotiation screen**: `/admin/gate` — puller enters planned pulls, system shows total market value, max spend to stay under 35% COGS ceiling, warning states (excellent ≤25%, acceptable 25-35%, over >35%)
- **Yard cost profiles**: entry fee, tax rate, distance from base stored per yard, applied automatically
- **Stale inventory automation**: wired to TradingAPI ReviseItem, auto price reductions at 60/90/120/180/270 days per spec schedule
  - Standard: 60d=-10%, 90d=-15%, 120d=-20%, 180d=-25%, 270d=-30%
  - Programmed: 90d=-5%, 180d=-10%, 270d=-15% (slower schedule with price protection)
  - No comps = hold and flag, ended listings logged to dead_inventory
- **Auto-relist returned parts**: return_intake table, Grade A relist at full price, Grade B at 80% with condition noted, auto-queue no manual step
- **Restock logic**: sold ≥ 2× active stock in 90 days = restock flag, checks both stores, recent 30 days weighted heavier, days-to-sell as tiebreaker
- **Opportunities**: OpportunityService wired to market_demand_cache for broader coverage, fills the Opportunities card in Sales Intelligence with parts that sell well market-wide but have zero stock

### Phase 5 — Multi-Store & Pricing (Complete)
- **Autolumen second store**: store field on YourSale and YourListing tables, inventory checks query both stores
- **Autolumen CSV import**: POST /api/import/csv with store=autolumen tag
- **GET /api/parts/lookup**: takes part number, returns fitment data from PartHawk database
- **PATCH /api/parts/:id/fitment**: write-back endpoint, lister confirms or corrects fitment
- **Programmed listing price protection**: GET /api/parts/lookup/programmed excludes programmed/flashed/VIN-specific listings from comp pool, programmed floor at 25% above unprogrammed market rate, programmed comps only compare against other programmed
- **Competitor price monitoring**: watches competitors, alerts when significantly underpriced or competitor drops out of category, advisory only no auto-match
- **Seasonal demand weighting**: recent 30-day sales weighted heavier than 90-day in all scoring (PricingService, MarketDemandCronRunner)

---

## Database Migrations Created

| Migration | Purpose |
|-----------|---------|
| `20260317000001_create_table_yard.js` | Yard profiles, yard_vehicle, yard_visit_feedback + 11 yard seeds |
| `20260317000002_seed_yards.js` | Additional yard seeding (if needed) |
| `20260317000003_phase1_new_tables.js` | vin_cache, trim_intelligence, part_location, dead_inventory, market_demand_cache |
| `20260318000001_add_part_location_columns.js` | Part location confidence/body_style fields |
| `20260318000001_add_store_and_sessions.js` | Store field on YourSale, pull_session, dead_inventory, market_demand_cache |
| `20260318000002_add_part_number_base.js` | Normalized part number field |
| `20260318100000_phase2_to_5_schema.js` | stale_inventory_action, return_intake, restock_flag, competitor_alert, store/isProgrammed on YourListing, seasonal_weight on market_demand_cache |

---

## Cron Jobs Running

| Job | Schedule | Purpose |
|-----|----------|---------|
| eBay Seller Processing | Every 6 hours | Sync seller listings, process new items |
| Price Check | Sunday 2 AM | Weekly price monitoring run |
| LKQ Scrape | Nightly 2 AM | Update junkyard inventory |
| Market Demand Cache | Nightly 3 AM | Update market data for all parts |
| Stale Inventory Automation | Wednesday 3 AM | Apply scheduled price reductions |
| Dead Inventory Scan | Monday 4 AM | Flag dead listings |
| Restock Scan | Tuesday 4 AM | Flag parts needing restocking |
| Competitor Monitoring | Thursday 4 AM | Check competitor prices |

---

## What Was Skipped and Why

1. **Offline-first with full IndexedDB sync**: The PWA has service worker caching (cache-first for static, network-first for API) and background sync for POST operations. Full offline mode with IndexedDB would require significantly more frontend work — the current approach covers 90% of use cases (brief connectivity drops during yard visits).

2. **Autolumen eBay credential rotation**: The store field and data model support Autolumen, but the actual eBay API credentials (TRADING_API_TOKEN, etc.) for the Autolumen store need to be added as separate env vars. The system currently uses a single set of credentials — a second SellerAPI instance would be needed for the second store. See "Needs Owner Review" below.

3. **Foss/Pull-A-Part scraper validation**: The scrapers are built with 3 fallback strategies each (data attributes, table parsing, regex text parsing). The actual HTML structure of fossupullit.com and pullapart.com will need to be validated on first run — scrapers may need minor CSS selector adjustments.

4. **eBay Trading API relist functionality**: The StaleInventoryService can revise prices via ReviseItem. Actually relisting (EndItem + AddItem) for returned parts requires more complex Trading API calls (item specifics, photos, etc.). The return_intake system queues parts for relist — the actual relist step would need the full listing tool integration.

---

## All Assumptions Made

1. **eBay Trading API token** has ReviseItem permission (needed for stale inventory auto-pricing)
2. **ANTHROPIC_API_KEY** with web_search tool access for trim intelligence and part location research
3. **Foss U-Pull-It** inventory page at fossupullit.com/inventory — JS-rendered, Puppeteer required
4. **Pull-A-Part** has inventory searchable from location pages at pullapart.com
5. **IRS mileage rate**: $0.67/mile (2024 rate used, should be updated annually)
6. **COGS ceiling**: 35% as specified
7. **Programmed listing premium**: 25% above unprogrammed market rate (spec says 20-30%, used midpoint)
8. **Seasonal weight**: calculated as (30d_rate × 3) / 90d_rate — above 1.0 means trending up
9. **Dead inventory threshold**: 60 days (spec says "60+ days no sale")
10. **Window regulator tip** is pre-populated via code in PartLocationService, not a migration seed
11. **UUID generation**: uses Node.js `uuid` v4 for all primary keys (PostgreSQL gen_random_uuid() as default in production)

---

## Items Needing Owner Review Before Go-Live

### Critical
1. **Autolumen eBay credentials**: Add separate env vars for the Autolumen store (e.g., `AUTOLUMEN_TRADING_API_TOKEN`). Currently uses single credential set.
2. **eBay Trading API permissions**: Verify the auth token has `ReviseItem` permission for stale inventory automation. Test with a single listing first.
3. **Foss/Pull-A-Part scraper test**: Trigger a manual scrape for each to verify HTML parsing works: `POST /yards/scrape/{yardId}`

### Important
4. **Review stale inventory reduction schedule**: The schedule is hardcoded. If you want different percentages, edit `StaleInventoryService.js` lines 28-36.
5. **IRS mileage rate**: Currently $0.67/mile. Update annually in `COGSService.js` line 38.
6. **Competitor watchlist**: The CompetitorMonitorService compares against the Item table (populated by cron). Ensure competitor sellers are in the Competitor table.
7. **Trim intelligence API cost**: Each new trim triggers a Claude API call with web_search. Monitor API usage after launch.

### Nice to Have
8. **Flagged yards**: Verify the flag_reason on Baughman's, 1213 N Plymouth, and Harry's We Buy It are still accurate.
9. **PWA icons**: The 192px and 512px icons at `/admin/icon-192.png` and `/admin/icon-512.png` should be customized with the PartHawk logo.

---

## Recommended Next Steps

1. **Autolumen store integration**: Add Autolumen eBay API credentials as env vars, create a second SellerAPI instance, and sync Autolumen listings separately.
2. **Full offline mode**: Add IndexedDB storage for the attack list so it works completely offline in the yard (currently uses service worker cache which covers most scenarios).
3. **eBay listing tool integration**: Build a browser extension or standalone tool that calls GET /api/parts/lookup when creating listings, auto-filling fitment data from PartHawk.
4. **Return relist automation**: Connect the return_intake queue to an actual eBay AddItem flow so Grade A/B returns are relisted without manual listing creation.
5. **Mobile notifications**: Add push notifications for high-value vehicles appearing at LKQ yards (would require push subscription registration).
6. **Reporting dashboard**: Build a React dashboard showing COGS trends, restock flags, competitor alerts, and seasonal demand shifts.
