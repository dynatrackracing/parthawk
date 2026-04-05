# LAST SESSION — 2026-04-05

## Edit Part Numbers on Cache & Scour Stream Want List
- Added PATCH /cache/:id — update partNumber (re-normalized), partDescription, partType, make, model, year, notes on cache entries
- Added PATCH /restock-want-list/:id — update title, notes on want list entries
- Added PATCH /restock-want-list/by-title — update want list entry by title match (used by scout-alerts inline edit), also updates scout_alerts.source_title
- cache.html: part number and description are now inline-editable (tap to edit, save on blur/Enter, green flash on success). Empty fields show "+ add PN" / "+ add description" placeholders.
- restock-list.html (Scour Stream): want list title and notes are inline-editable in the WANT LIST tab
- scout-alerts.html: STREAM alert source_title is inline-editable — patches the underlying want list entry and syncs alert records

## Files touched
- service/services/CacheService.js — added updateEntry()
- service/routes/cache.js — added PATCH /:id
- service/routes/restock-want-list.js — added PATCH /:id, PATCH /by-title
- service/public/cache.html — inline edit CSS + JS for partNumber, partDescription
- service/public/restock-list.html — inline edit CSS + JS for title, notes
- service/public/scout-alerts.html — inline edit CSS + JS for STREAM source_title

## What's next — priority order
1. Verify Skip/Note buttons removed from attack list
2. Scout alert source badges on Daily Feed parts
3. Fix Hunters Perch → Mark link
4. Hawk Eye search functionality (enables Sky Watch workflow)
5. Hawk Eye + Flyway cache sync (same claimed-keys pattern)

## Open tech debt
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitorService Thu 4am reads frozen SoldItem
- LifecycleService loads all YourSale into memory (watch at 50K+)
- The Mark table empty (adoption gap — Hunters Perch link broken)
- instrumentclusterstore scraper: 0 items, needs debug-scrape diagnosis
- MarketPricingService still references PriceCheckServiceV2 as fallback (dead on Railway too?)
