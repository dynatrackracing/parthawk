# LAST SESSION — 2026-04-03

## Phase 9: Local VIN Decoder (DEPLOYED)
- Installed @cardog/corgi for offline VIN decoding
- Created vin_decoder schema with VDS trim + engine code lookup tables
- Built LocalVinDecoder.js singleton service (service/lib/)
- Rewired all 5 NHTSA callers (PostScrapeService, VinDecodeService, VIN routes, attack list)
- Fixed tonnage leaking into trim field
- Fixed chassis codes (MCX20L) leaking into trim field
- Added engine fallback for null corgi data
- Added /vin/test-local/:vin diagnostic endpoint
- Tested against 20 real VINs: engine improved, drivetrain perfect, some trim regressions (corgi doesn't surface trim for all vehicles)

## PartOutPRO Evaluated — Rejected
- No listing automation capability, research tool only
- Downgraded to free tier

## Intelligence Diagnostic Run
- 5 issues identified (see HANDOFF_2026-04-03.md)
- instrumentclusterstore scraper: 0 items
- 416 VINs need decode (next cron handles)
- Autolumen listings not in YourListing table
- The Mark table empty (adoption gap)
- QUARRY queries wrong data source (frozen Item table)

## Open for Next Session
1. Debug instrumentclusterstore scraper
2. Trigger batch VIN decode for 416 vehicles
3. Import Autolumen active listings
4. The Mark adoption
5. QUARRY data source fix
