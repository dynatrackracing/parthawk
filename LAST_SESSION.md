# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-01
**Session type:** Feature — Autolumen Multi-Store Integration

## What was done
- Added `store` column to YourListing and YourSale (default: 'dynatrack')
- Scoped YourDataManager deactivation sweep to `store='dynatrack'` (CRITICAL: prevents 4x/day sync from ending Autolumen listings)
- Added `store: 'dynatrack'` to syncOrders and syncListings insert objects
- Created AutolumenImportService: Active Listings, Orders Report, Transaction Report CSV parsers
- CSV parser auto-detects header row, handles eBay date/price formats, BOM cleanup
- Created /autolumen routes: import/listings, import/sales, import/transactions, stats
- Added collapsible Autolumen Sync card to gate.html (Nest Protector) with stats + upload sections
- Added DYNATRACK/AUTOLUMEN store badges to stock check results in gate.html
- Added `store` field to check-stock API response (exact + variant results)
- Scoped StaleInventoryService to `store='dynatrack'` (no eBay API for Autolumen)
- Installed multer for multipart CSV uploads
- Verified: AttackListService buildStockIndex/buildSalesIndex/buildInventoryIndex have NO store filter — automatically see both stores
- Verified: DeadInventoryService does NOT call TradingAPI — no store scoping needed

## What files were touched
- service/database/migrations/20260401300000_add_store_column.js (NEW)
- service/services/AutolumenImportService.js (NEW)
- service/routes/autolumen.js (NEW)
- service/managers/YourDataManager.js (store column + deactivation scope)
- service/routes/cogs.js (store in check-stock SELECT + response)
- service/public/gate.html (Autolumen Sync card + store badges)
- service/services/StaleInventoryService.js (store='dynatrack' scope)
- service/index.js (mount /autolumen route)
- package.json + package-lock.json (multer dependency)

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- 5,552 vehicles have vin_decoded=true but decoded_trim IS NULL
- Mark icons (target) not appearing — marks lack partNumber, byTitle matching not wired up
- Scout alert icons (lightning) not appearing — depends on marks having PNs

## What's next
- First Autolumen CSV upload to populate data
- Verify stock checks show both stores
- EST badge gray styling
- buildInventoryIndex filter fix
- Fix mark matching to use byTitle or populate partNumber on marks

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- YourDataManager deactivation sweep is now scoped to store='dynatrack' — DO NOT remove this
- AutolumenImportService deactivates all Autolumen Active listings before inserting new ones (full replace)
- StaleInventoryService is scoped to dynatrack only — Autolumen has no eBay API access
- csv-parse was already installed; multer was added for file uploads
