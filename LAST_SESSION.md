# LAST SESSION — READ THIS BEFORE DOING ANYTHING

**Date:** 2026-04-03
**Session type:** Feature — Phase 9: Local VIN Decoder (eliminate all NHTSA API calls)

## What was done
- Installed @cardog/corgi for offline VIN decoding (sub-15ms, zero network)
- Added python3 + build-essential to nixpacks.toml for better-sqlite3 native build on Railway
- Created vin_decoder schema with 4 tables: manufacturers, vds_trim_lookup, engine_codes, name_aliases
- Seeded GM, Chrysler/Stellantis, Honda, Ford trim and engine lookup data
- Built LocalVinDecoder singleton service (service/lib/LocalVinDecoder.js)
- Rewired PostScrapeService.decodeBatch() to use local decode (was NHTSA batch API)
- Rewired VinDecodeService.decode() to use local decode (was NHTSA single VIN API)
- Rewired /vin/decode-photo route to use local decode
- Rewired /vin/scan route to use local decode
- Rewired attack-list manual VIN decode to use local decode
- Added /vin/test-local/:vin diagnostic endpoint
- Pre-initializes decoder on app startup in index.js
- Removed all axios imports that were only used for NHTSA calls
- Removed NHTSA rate limit sleeps (200ms, 1000ms, 2000ms) — no longer needed

## What files were touched
- package.json, package-lock.json (@cardog/corgi dependency)
- nixpacks.toml (python3, build-essential for native build)
- service/database/migrations/20260403000000_create_vin_decoder_schema.js (NEW)
- service/lib/LocalVinDecoder.js (NEW)
- service/services/PostScrapeService.js (decodeBatch → local, removed axios, removed sleeps)
- service/services/VinDecodeService.js (decode → local, removed axios, removed sleep)
- service/routes/vin.js (decode-photo + scan → local, added test-local endpoint)
- service/routes/attack-list.js (manual VIN decode → local)
- service/index.js (decoder init on startup)
- CHANGELOG.md, LAST_SESSION.md

## What is still broken / needs attention
- EST badge styling: estimate prices show red verdict-poor instead of gray
- buildInventoryIndex Item.price>0 filter may exclude parts with no Item.price but valid market cache data
- OTHER chips still appear for some parts — more detectPartType patterns needed
- Mark icons (target) not appearing — marks lack partNumber, byTitle matching not wired up
- VDS trim data coverage: only GM trucks, Chrysler, Honda, Ford seeded so far — other makes use corgi base only
- better-sqlite3 native build may need verification on Railway deploy

## What's next
- Verify Railway deploy succeeds (better-sqlite3 native build)
- Test /vin/test-local/:vin with known VINs on production
- Expand VDS trim data for more makes/models
- EST badge gray styling

## Critical reminders for next session
- DO NOT modify AttackListService.js without reading it completely first
- Item.price is FROZEN — never use as display/scoring price
- YourDataManager deactivation sweep is scoped to store='dynatrack' — DO NOT remove this
- LocalVinDecoder is a SINGLETON — one instance for app lifetime, pre-inited on startup
- vin_decoder schema is in Postgres, corgi SQLite is bundled in node_modules
- VinDecodeService still exists but now delegates to LocalVinDecoder internally
- better-sqlite3 requires native build tools — python3 + build-essential in nixpacks.toml
- Zero NHTSA API calls remain in the codebase (verified via grep)
