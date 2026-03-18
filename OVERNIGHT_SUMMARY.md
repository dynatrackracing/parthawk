# Overnight Build Summary — 2026-03-18

## Completed

### Task 1: PWA Shell
- `manifest.json` with dark theme (#0a0a0a), standalone display, portrait orientation
- Service worker (`sw.js`) with network-first caching for API routes, cache-first for static assets
- Background sync via IndexedDB for offline POST requests (part-location confirmations)
- Placeholder PWA icons (1x1 dark PNG — replace with branded 192/512px assets)
- Meta tags for theme-color, Add to Home Screen, apple-touch-icon
- Service worker registered in attack-list.html

### Task 2: Mobile Attack List UI
- Complete rewrite of `/admin/pull` page as phone-first design
- Collapsed view: score badge + year/make/model + row + est value + part type chips
- Part chips colored by verdict: PULL (red), WATCH (yellow), SKIP (gray)
- 48px minimum tap targets per spec
- Expanded accordion view per vehicle with:
  - Per-part detail: market value, stock count, sold velocity, part number
  - Verdict chip with one-line reason
  - "Mark as Pulled" button (logs to pull_session via API)
  - "Skip" button with reason dropdown (damaged/missing/already pulled/not worth it)
  - "Add Note" text input per part
  - Part location section (auto-researches on expand for 2014+ vehicles)
- Tabs: All | Raleigh | Durham | Greensboro | Day Trip | Road Trip
- VIN scanner button in header with camera modal
- All vehicles shown per yard (not just top 5)

### Task 3: Vehicle to Inventory Match Fix
- Scoring floor at 10 when Item table has matching parts, even without YourSale history
- Per-part verdicts (PULL/WATCH/SKIP) with reasons
- `detectPartType()` extracts part type from title/category for chip display
- `findMatchedParts()` extracted as separate method for cleaner code
- `getAllYardsAttackList()` returns all vehicles, not just top 5

### Task 4: VIN Photo Decode
- `POST /vin/decode-photo` accepts multipart photo upload
- Sends to Claude API (claude-sonnet-4-20250514) with prompt to read 17-char VIN
- Returns "UNREADABLE" if VIN not legible, with retake prompt in UI
- Decodes valid VIN via NHTSA API (`vpic.nhtsa.dot.gov/api/vehicles/decodevin/`)
- Parses: year, make, model, engine, body style
- Caches in `vin_cache` table (same VIN never decoded twice)
- Matches decoded vehicle against active `yard_vehicle` inventory
- Returns `matchedVehicle` ID for jump-to-vehicle in attack list
- Camera button and VIN modal in attack-list.html header

### Task 5: Part Number Normalization
- `partNumberUtils.js` with `normalizePartNumber()` function
- Strips Chrysler/Mopar 2-letter alpha suffixes (68269652AA → 68269652)
- Strips Ford trailing suffix after last dash (AL3Z-2C204-A → AL3Z-2C204)
- Strips GM trailing 2-letter alpha suffixes
- Migration adds `partNumberBase` column to Item table with index
- Backfills all existing records with normalized base numbers
- `ItemLookupService` sets `partNumberBase` on create and update

### Task 6: Dead Inventory Scoring
- `scanAndLog()` method finds items listed >60 days with no YourSale match
- Logs to `dead_inventory` table with failure reason:
  - `overpriced` if listing price >20% above market_demand_cache avg
  - `low_demand` if market data exists but price is reasonable
  - `unknown` if no market data available
- `getWarning(partNumber)` for attack list display
- Deduplicates: skips if part_number_exact already logged

### Task 7: Yard Visit Logging
- `POST /attack-list/log-pull` auto-creates `pull_session` per yard/day
- `POST /attack-list/visit-feedback` logs rating (1-5) + notes
- `GET /attack-list/last-visit/:yardId` returns most recent feedback
- Frontend "Mark as Pulled" already wired to call log-pull

### Task 8: Market Demand Cache
- `MarketDemandCronRunner` queries eBay Finding API for all normalized part numbers
- `findCompletedItems` for sold count and avg price (last 90 days)
- `findItemsByKeywords` for active listing count
- `market_score = sold_90d / active_listings`
- 24h TTL: never queries same part number twice per day
- 100ms rate limit between eBay API calls
- Scheduled at 3am nightly (after LKQ scrape at 2am)

### Task 9: Part Location Knowledge Base
- Already implemented in earlier commit, verified all spec requirements:
  - Research triggers: year >= 2014, part type whitelist, no existing record
  - Claude API (claude-sonnet-4-20250514) with web_search tool
  - Search priority: OEM manuals → NHTSA TSBs → forums
  - Field confirmation: increment count, promote confidence at 3
  - Flag wrong: reset to researched with count 0
  - Window regulator motor tip auto-attached
  - Display rules: 2014+ researches, pre-2014 shows "Add location" only

## Assumptions Made

1. **VIN photo parsing**: Used manual multipart parsing instead of adding multer dependency. Assumes single file field named 'photo'. Works for the camera capture use case but may need multer for complex multi-file uploads.

2. **PWA icons**: Created 1x1 placeholder PNGs. Need to be replaced with actual 192x192 and 512x512 branded icons for proper Add to Home Screen experience.

3. **Part number normalization**: The suffix stripping rules cover Chrysler/Mopar, Ford, and GM patterns. Other OEMs (Japanese, European) may have different suffix conventions — the generic fallback strips any trailing 2 alpha chars after 6+ chars.

4. **Dead inventory scan**: Runs on-demand via `scanAndLog()` — not scheduled as a cron job. Can be triggered via the existing dead inventory routes or added as a scheduled job if needed.

5. **Market demand cache**: The `findCompletedItems` eBay API operation may require a more recent API version or different credentials than the existing `FindingsAPI.js`. Falls back to zero data if `FINDINGS_APP_NAME` env var is not set.

6. **bodyParser vs multer for VIN photos**: The VIN decode route reads raw request body directly since body-parser doesn't handle multipart. This works but is fragile — production should use multer.

7. **Service worker scope**: Registered from `/admin/sw.js` which scopes it to `/admin/`. The `/puller` route serves the same HTML file, so it benefits from the cache but the SW scope may not cover it perfectly. For full PWA, consider moving SW to root scope.

## Errors / Known Issues

- **Attack list may still show empty** if the `yard` table has no rows or `yard_vehicle` has no active rows. The code is defensive (try/catch everywhere) but depends on the scraper having run successfully at least once. The database seeding in migration `20260317000001` creates yard rows, but the scraper must actually run to populate `yard_vehicle`.

- **`body-parser` conflict with VIN upload**: `body-parser` with `json()` middleware may consume the request body before the VIN route can read it as raw multipart data. The VIN route re-reads from the request stream, which only works if body-parser hasn't already consumed it. May need route-level middleware ordering or multer.

## Environment Variables Required

```
ANTHROPIC_API_KEY=...   # For part location research + VIN decode
FINDINGS_APP_NAME=...   # For market demand cache (eBay Finding API)
```
