# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-03
**Session type:** Fix — VIN decoder trim filtering + engine fallback

## What was done
- Expanded tonnage-to-model logic: catches "1500 (1/2 Ton)", "3/4 Ton", pure numbers
- All corgi series values now run through cleanDecodedTrim() before storing as trim
- Filters chassis codes (MCX20L), junk strings (NFA), cab types, drivetrain strings
- Added engine fallback: if corgi returns null engine, checks old vin_cache for NHTSA data
- Verified on 6 production VINs: tonnage and chassis code fixes confirmed working
- Yukon XL now gets VDS trim enrichment (SL) since tonnage moved to model

## What files were touched
- service/lib/LocalVinDecoder.js (tonnage regex, cleanDecodedTrim, engine fallback)
- LAST_SESSION.md, CHANGELOG.md

## What is still broken / needs attention
- Honda/Acura engine data: corgi returns null for some models (MDX, Pilot), no old cache to fall back to
- VDS trim seed data gaps: Honda uses numeric pos8 chars (0-9), not R/S/T/U/V/W from our seed
- Ford engine code coverage: most common chars (2, N, L, E) not in seed data
- Chrysler price_class: most common chars (4, 5, 1, 2) not in seed data
- EST badge styling still needs gray treatment
- Mark icons not appearing (marks lack partNumber)

## What's next
- Fix Honda/Acura VDS seed data to use numeric chars from real inventory
- Expand Ford engine code coverage for missing chars
- Expand Chrysler price_class for actual inventory chars
- EST badge gray styling

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- LocalVinDecoder is a SINGLETON — one instance for app lifetime
- cleanDecodedTrim() is copied in LocalVinDecoder (not imported from PostScrapeService)
- Engine fallback only works when old vin_cache entries exist — won't help fresh VINs with no NHTSA history
- Zero NHTSA API calls remain in the codebase
