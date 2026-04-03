# DARKHAWK CHANGELOG

Reverse chronological. Every deploy gets one entry. Claude Code appends to this after every session.

---

## [2026-04-03] Phase 9: Local VIN Decoder — Eliminate All NHTSA API Calls
- **Added:** @cardog/corgi for offline VIN decoding (sub-15ms, zero network, ~20MB bundled SQLite)
- **Added:** vin_decoder schema with manufacturers, vds_trim_lookup, engine_codes, name_aliases tables
- **Added:** GM/Chrysler/Honda/Ford trim and engine code seed data
- **Added:** LocalVinDecoder singleton service (corgi + VDS enrichment pipeline)
- **Added:** /vin/test-local/:vin diagnostic endpoint
- **Changed:** PostScrapeService.decodeBatch() → local decode (was NHTSA batch API)
- **Changed:** VinDecodeService.decode() → local decode (was NHTSA single VIN API)
- **Changed:** /vin/decode-photo and /vin/scan routes → local decode
- **Changed:** attack-list manual VIN decode → local decode
- **Changed:** nixpacks.toml adds python3 + build-essential for better-sqlite3
- **Removed:** All NHTSA API calls (zero remain in codebase)
- **Removed:** NHTSA rate limit sleeps (200ms, 1000ms, 2000ms)
- **Files touched:** package.json, nixpacks.toml, migration (new), LocalVinDecoder.js (new), PostScrapeService.js, VinDecodeService.js, vin.js, attack-list.js, index.js
- **Affects:** All VIN decoding across DarkHawk — post-scrape, cron, VIN scanner, manual lists
- **Notes:** Decoder pre-inits on startup. VDS enrichment falls back gracefully if tables not yet migrated.

---

## [2026-04-01] Homepage section links + Autolumen uploads placement
- **Added:** home.html at /admin/home — DarkHawk homepage with categorized section links (Field/Intel/Inventory/Tools)
- **Moved:** Autolumen Sync card from gate.html to home.html (both Active Listings + Sales History uploads)
- **Changed:** gate.html stripped to Nest Protector only (stock check + COGS)
- **Changed:** DarkHawk logo in dh-nav.js links to /admin/home instead of /
- **Files touched:** home.html (new), gate.html, dh-nav.js, index.js
- **Notes:** Root / still serves React SPA (DynaTrack inventory). DarkHawk homepage is /admin/home.

---

## [2026-04-01] Fix: Cache check-stock matches Nest Protector accuracy
- **Fixed:** cache.html sent `part_number` param but both `/cogs/check-stock` and `/cache/check-stock` expect `pn`
- **Fixed:** cache.html parsed `/cogs/check-stock` response as `d.results` instead of `d.exact`/`d.variants`
- **Fixed:** cache.html parsed `/cache/check-stock` response as `d.results` instead of `d.cached`
- **Files touched:** cache.html
- **Notes:** Cache check-stock now produces identical results to Nest Protector for the same PN input

---

## [2026-04-01] The Cache Phase 7 Part 2 — Frontend + Puller Tool Wiring
- **Added:** cache.html — Active/History/Add Part tabs, mobile-first, manual entry by PN or YMM
- **Added:** Pull buttons on Daily Feed, Hawk Eye, Flyway expanded parts
- **Added:** THE CACHE nav link in dh-nav.js (between Scout Alerts and Hawk Eye)
- **Changed:** Daily Feed markPulled() → claimPart() via POST /cache/claim
- **Changed:** Scout Alerts claim handler → routes through /cache/claim (server marks alert claimed)
- **Changed:** Hawk Eye shows cachedParts notice and Pull buttons on scan results
- **Changed:** gate.html stock check shows "In The Cache" section for cached claims
- **Files touched:** cache.html (new), dh-nav.js, attack-list.html, scout-alerts.html, vin-scanner.html, flyway.html, gate.html, index.js
- **Affects:** All puller tools, stock checks, nav across all pages
- **Notes:** Source badges color-coded: daily_feed=red, scout_alert=orange, hawk_eye=teal, flyway=blue, manual=gray

---

## [2026-04-01] Fix: the_cache migration + CacheService.getStats()
- **Fixed:** Store column migration failed on prod because column already existed — made idempotent with `hasColumn` check
- **Fixed:** Cache migration blocked by store column migration failure — both now run with existence guards
- **Fixed:** `CacheService.getStats()` destructured `database.raw()` result incorrectly for pg driver — returns `{ rows }` not array
- **Removed:** Temporary diagnostic endpoints (`/api/migrate-status`, `/api/run-migrations`)
- **Files touched:** migrations/20260401300000, migrations/20260401400000, CacheService.js, index.js
- **Notes:** Migrations now recorded in knex_migrations (batch 51). All /cache endpoints verified working on production.

---

## [2026-04-01] The Cache Phase 7 Part 1 — Backend
- **Added:** `the_cache` table with UUID PK, vehicle/part/yard fields, status lifecycle (claimed→listed/returned/deleted)
- **Added:** CacheService — claim, return, delete, resolve, stats, checkCacheStock
- **Added:** /cache routes — active, history, stats, claim, return, delete, resolve, check-stock
- **Added:** Manual entry via source='manual' (by PN or by YMM+description)
- **Changed:** YourDataManager.syncAll now runs cache auto-resolution after listing sync (4x/day)
- **Changed:** /cogs/check-stock returns cachedClaims alongside YourListing results
- **Changed:** /vin/scan returns cachedParts for scanned vehicle
- **Files touched:** migration (new), CacheService.js (new), routes/cache.js (new), YourDataManager.js, cogs.js, vin.js, index.js
- **Affects:** Stock checks (Nest Protector + Hawk Eye), VIN scanner, all puller tools
- **Notes:** Scout alert cross-linking: claim marks alert claimed, return re-activates. Phase 7 Part 2 (frontend) not yet built.

---

## [2026-04-01] Autolumen Multi-Store Integration
- **Added:** `store` column on YourListing and YourSale (default: 'dynatrack')
- **Added:** AutolumenImportService — CSV import for active listings, orders, and transaction reports
- **Added:** /autolumen routes (import/listings, import/sales, import/transactions, stats)
- **Added:** Collapsible Autolumen Sync card on Nest Protector (gate.html)
- **Added:** DYNATRACK/AUTOLUMEN store badges on stock check results
- **Changed:** YourDataManager deactivation sweep scoped to store='dynatrack'
- **Changed:** StaleInventoryService scoped to store='dynatrack'
- **Changed:** check-stock API now returns `store` field on results
- **Files touched:** migration (new), AutolumenImportService.js (new), routes/autolumen.js (new), YourDataManager.js, cogs.js, gate.html, StaleInventoryService.js, index.js, package.json
- **Affects:** Stock checks, attack list scoring, restock flags, overstock watch, stale inventory automation
- **Notes:** All existing services automatically see both stores — no store filter in AttackListService. StaleInventoryService and YourDataManager are the only places scoped to dynatrack.

---

## [2026-04-01] Workflow Infrastructure
- **Added:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Purpose:** Prevent Claude Code sessions from overwriting each other's work
- **Files:** CLAUDE_RULES.md, CHANGELOG.md, LAST_SESSION.md
- **Notes:** Every future session reads these files first before touching code

---

<!-- TEMPLATE FOR NEW ENTRIES (copy and fill in at top of file):

## [YYYY-MM-DD] Short Description
- **Changed:** What was modified
- **Added:** What was created
- **Fixed:** What bugs were resolved
- **Files touched:** List every file modified
- **Affects:** What downstream features are impacted
- **Notes:** Anything the next session needs to know

-->
