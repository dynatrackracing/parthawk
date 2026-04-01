# DARKHAWK CHANGELOG

Reverse chronological. Every deploy gets one entry. Claude Code appends to this after every session.

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
