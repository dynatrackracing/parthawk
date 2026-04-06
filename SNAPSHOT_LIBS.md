# SNAPSHOT_LIBS.md
Generated 2026-04-06

## service/utils/

### partIntelligence.js
**Purpose:** Unified matching engine for DarkHawk. Single source for PN extraction, stock counting, model matching, year parsing. Used by DAILY FEED, HAWK EYE, THE QUARRY, SCOUR STREAM, SCOUT ALERTS.
**Exports:** `extractPartNumbers`, `stripRevisionSuffix`, `parseYearRange`, `vehicleYearMatchesPart`, `modelMatches`, `buildStockIndex`, `lookupStockFromIndex`, `extractStructuredFields`, `detectPartType`, `sanitizePartNumberForSearch`, `deduplicatePNQueue`
**Dependencies:** `./partMatcher` (for `normalizePartNumber` used by `computeBase`).
**Key behavior:**
- `extractPartNumbers(text)` — Ford 3-segment dash patterns (`/\b[A-Z0-9]{3,5}-[A-Z0-9]{4,7}-[A-Z]{1,3}\b/`) + dashless Ford + 2-segment Ford + Chrysler, GM, Toyota, Honda, Nissan, VW, BMW, Mercedes, Hyundai, generic. Returns `{raw, normalized, base}` where `base` is computed via internal `computeBase()`. Filters via SKIP_WORDS + MAKES_MODELS sets. Rejects concatenated year ranges (`/^(19|20)\d{2}(19|20)\d{2}$/`).
- `computeBase(raw)` — Internal (not exported). Uses `normalizePartNumber()` from partMatcher.js for dashed PNs (Ford: 7L3A-12A650-GJH → 7L3A-12A650 → 7L3A12A650), falls back to `stripRevisionSuffix()` for dashless PNs.
- `extractStructuredFields(title)` — Clean Pipe Phase A. Returns `{partNumberBase, partType, extractedMake, extractedModel}`. Uses `pns[0].base` for partNumberBase.
- `sanitizePartNumberForSearch(pn)` — Clean Pipe Phase E1. Intentionally aggressive — for search queries, NOT for storage. Strips Ford ECU suffixes (12A650, 14A067).
- `deduplicatePNQueue(entries)` — Phase E1. Sanitizes, dedupes by base, keeps highest-price entry per PN.
- `detectPartType(title)` — Keyword detection for 40+ part types: TCM, BCM, ECM, ABS, TIPM, AMP, CLUSTER, RADIO, THROTTLE, STEERING, REGULATOR, MIRROR, SUNROOF, FUEL_MODULE, CAMERA, HVAC, HEADLIGHT, TAILLIGHT, BLIND_SPOT, PARK_SENSOR, AIR_RIDE, CLOCK_SPRING, LOCK, IGNITION, LIFTGATE, ALTERNATOR, STARTER, BLOWER, NAV, VISOR, ROLLOVER_SENSOR, YAW_SENSOR, OCCUPANT_SENSOR, SEAT_MODULE, DOOR_MODULE, WIPER_MODULE, BLEND_DOOR, TRAILER_MODULE, LANE_ASSIST, ADAPTIVE_CRUISE.
- `MAKE_NORMALIZE` — Map of ~50 lowercase make strings to title-case canonical names (matches corgi VIN decoder output). Includes aliases: chevy→Chevrolet, vw→Volkswagen, merc→Mercury.
- `MODEL_PATTERNS` — Ordered array of ~220 model strings. Multi-word models first (Grand Cherokee, Transit Connect, Explorer Sport Trac). Includes vans (Express, Savana, Econoline, Transit, Sprinter, Astro, Safari, NV200, ProMaster, Metris), tonnage variants (Express 2500/3500, Savana 1500/2500/3500, Sprinter 2500/3500), trucks with tonnage (Silverado 1500/2500/3500, F-150/F-250/F-350), Lexus/Infiniti/Acura/BMW model numbers.
- `stripRevisionSuffix(pn)` — Strips trailing revision suffix from dashless PNs. Chrysler 56044691AA → 56044691, GM A12345678AA → A12345678.
- `modelMatches(partModel, vehicleModel)` — Prefix-based model comparison with normalization. Returns true if shorter model is prefix of longer model and extra words are digits.
- `extractMake(titleLower)` — Multi-word makes first (land rover, mercedes-benz), then word-boundary single-word. Returns title-case from MAKE_NORMALIZE.
- `extractModel(title, make)` — Searches full title for MODEL_PATTERNS matches (word-boundary). Returns first match.

### partMatcher.js
**Purpose:** Shared part number recognition and matching. Canonical source for `normalizePartNumber()`.
**Exports:** `extractPartNumbers`, `extractYearsFromTitle`, `normalizePartNumber`, `parseTitle`, `findSimilarPartNumbers`, `matchPartToListings`, `matchPartToSales`, `matchPartToYardVehicles`, `loadModelsFromDB`, `MAKES`, `MODELS`, `PART_PHRASES`
**Dependencies:** `../database/database`, `../lib/logger`
**Key behavior:**
- `normalizePartNumber(pn)` — Canonical OEM revision suffix stripper. Ford dash-style with 1-3 char suffix (AL3T-15604-BD → AL3T-15604, 7L3A-12A650-GJH → 7L3A-12A650), Chrysler/GM trailing alpha (68269652AA → 68269652), Honda sub-revision, Toyota revision, generic 2-alpha tail. **Used by CacheService for dedup, computeBase() in partIntelligence.js, and frontend normalizePN() for matching.**
- `extractPartNumbers(title)` — OEM-specific regex patterns (chrysler, ford, honda, toyota, nissan, gm, bosch, bmw). Returns `{raw, base, format}`. Deduplicates by base, keeps longer raw match.
- `parseTitle(title)` — Extracts year range, make, models from any eBay/listing title. Used by ScoutAlertService for want-list matching.
- `loadModelsFromDB()` — Loads Auto table models into cache organized by make. Sorted longest-first. Falls back to FALLBACK_MODELS (~120 entries).

### partNumberExtractor.js
**Purpose:** DEPRECATED. Original OEM part number extractor. Kept for backward compatibility; use partIntelligence.js.
**Exports:** `extractPartNumbers`, `stripRevisionSuffix`
**Dependencies:** None (pure logic).

---

## service/lib/

### LocalVinDecoder.js
**Purpose:** Offline VIN decoding via @cardog/corgi + VDS enrichment + vPIC fallback + EPA transmission. Replaces all NHTSA API calls. Singleton pattern.
**Exports:** `decode`, `decodeBatchLocal`, `getDecoder`, `close`
**Dependencies:** `./logger`, `../database/database`, `@cardog/corgi`

**Decode pipeline (6 steps):**

1. **Step 1: vin_cache check** — SELECT from `vin_cache` by VIN. If cached, return immediately with trim, engine, drivetrain, transmission_style, trans_speeds, trans_sub_type, trans_source. Source: `vin_cache`.

2. **Step 2: Corgi offline decode** (<15ms, zero network) — `@cardog/corgi` SQLite-based VIN pattern matching. Returns year, make, model, series, bodyStyle, driveType, fuelType, engine displacement/cylinders. Series processed: tonnage patterns (1500, 3/4 ton) folded into model; non-tonnage run through `cleanDecodedTrim()` and used as trim. Engine fallback: if corgi has no engine data, checks old vin_cache for NHTSA-era engine strings.

3. **Step 3: VDS trim enrichment** — `identifyManufacturer(vin)` → `resolveTrimFromVDS(mfr.id, vin, year, model)`. Uses `vin_decoder.vds_trim_lookup` table. Only seeded for 3 manufacturers (GM=41 entries, Chrysler=26, Honda=20). If VDS has a match AND trim is still null, sets trim. Source: `+vds_trim`.

4. **Step 3.5: vPIC trim+transmission fallback** — `vpicTrimFallback(vin)` queries `vpic.spvindecode(vin)` stored procedure. Parses key-value rows for Trim, Series, Transmission Style, Transmission Speeds. Only fills trim if still null after VDS. Trim cleaned via `cleanDecodedTrim()`. Also fills transHint if still null. Source: `+vpic_trim`, `+vpic_series`, `+vpic_trans`. **This is the main trim source for non-VDS makes (Toyota, Nissan, BMW, Mercedes, Hyundai, Kia, Lexus, etc.).**

5. **Step 4: Engine code enrichment** — `resolveEngineCode(mfr.id, mfr.name, vin, year, model)`. Uses `vin_decoder.engine_codes` table. Returns displacement, cylinders, fuelType, forcedInduction, transHint. Honda exception: position 8 = trim not engine. Source: `+engine_code`.

6. **Step 4.5: EPA transmission resolution** — `resolveTransmission(year, make, model, displacement, cylinders, trim)`. Queries `vin_decoder.epa_transmission` table (36,035 EPA FuelEconomy.gov records). Runs if transHint is null OR came from vPIC (EPA CHECK_MT logic is smarter than vPIC's raw data). **3-tier resolution:**
   - **Tier 1 (epa_definitive):** Only one trans type in EPA data → use it (e.g., "4-speed Automatic" or "5-speed Manual")
   - **Tier 2 (epa_check_mt):** Both Manual and Automatic offered → check CHECK_MT model list (22 models: Corvette, Camaro, Mustang, Challenger, WRX, BRZ, FR-S, 350Z, 370Z, MX-5, Miata, Genesis Coupe, Veloster, GTI, GTO, Solstice, Sky, Lancer, FJ Cruiser, Tacoma, Frontier, Ranger, Wrangler) → mark as CHECK_MT. Also checks PERFORMANCE_TRIMS override (`/\b(ST|Si|Type R|Type S|SRT|SS|RS|Nismo|TRD|Sport|S\b|R-Line|GT(?:\s|$)|Turbo)\b/i`).
   - **Tier 3 (epa_default_auto):** Both offered, not a CHECK_MT model → default to Automatic with speeds.
   - Model matching via `epaModelMatches()`: normalization, containment, GM tonnage aliases (K15→1500), suffix stripping.
   - Source: `+epa`.

7. **Step 5: Write to vin_cache** — INSERT with all resolved fields (trim, engine, drivetrain, transmission_style, transmission_speeds, trans_sub_type, trans_source). ON CONFLICT IGNORE.

8. **Step 6: Return result** — Standardized object with vin, year, make, model, trim, engine, engineCode, engineType, displacement, cylinders, fuelType, forcedInduction, drivetrain, bodyStyle, transHint, transSpeeds, transSubType, transSource, source, cached, ms.

**Priority order for trim:** VDS (GM/Chrysler/Honda) > corgi series > vPIC Trim > vPIC Series > null
**Priority order for transmission:** engine_codes.transHint > vPIC transmissionStyle > EPA resolution > null (EPA overrides vPIC)

**Other functions:**
- `cleanDecodedTrim(raw)` — Filters junk (NFA, std, cab types, drivetrain strings, chassis codes, Middle-level/High-level Korean strings). Strips parenthetical content, engine specs, leather/nav suffixes. Returns null if <2 or >30 chars.
- `decodeBatchLocal(vins)` — Sequential decode loop. Returns array shaped like NHTSA batch response for backward compat (VIN, Make, Model, ModelYear, Trim, DisplacementL, DriveType, TransmissionStyle, TransmissionSpeeds, etc.).
- `parseDrivetrain(driveType)` — Normalizes to 4WD/AWD/FWD/RWD.
- `parseEngineType(fuelType)` — Returns Gas/Diesel/Hybrid/Electric/Flex Fuel.
- `formatEngineString(disp, cyl, corgiEngine)` — Returns "3.6L V6" format.
- Singleton: `getDecoder()` caches one corgi instance for app lifetime.

### priceResolver.js
**Purpose:** Resolve best available price for a part number from tiered sources.
**Exports:** `resolvePrice`, `resolvePricesBatch`, `getFreshness`
**Dependencies:** `../database/database`
**Key behavior:**
- `resolvePricesBatch(partNumbers, options)` — Normalizes keys (strip spaces/dashes/dots, uppercase). Priority: market_demand_cache (fresh/aging/stale) > Item.price (frozen reference). Freshness tiers: fresh <=30d, aging 30-60d, stale 60-90d, expired >90d (treated as missing).
- Returns Map of `{price, source, freshness, details}`. Details include median, min, max, soldCount for cache hits.

### FlywayScrapeRunner.js
**Purpose:** Cron runner for non-LKQ Flyway yard scraping + post-scrape enrichment.
**Exports:** `FlywayScrapeRunner` (class)
**Dependencies:** `./logger`, `../database/database`, `../services/FlywayService`, `../services/PostScrapeService.enrichYard`, scrapers (PullAPart, Foss, CarolinaPNP, UPullAndSave, Chesterfield, PickAPartVA)
**Key behavior:**
- `work()` — (1) auto-complete expired Flyway trips, (2) cleanup expired trip vehicles, (3) get active non-LKQ yards, deduplicate, (4) scrape each with 5min timeout and 3s inter-yard delay, (5) delegates post-scrape to `PostScrapeService.enrichYard(yardId)` for VIN decode + trim tier + scout alerts.
- `scrapeYard(yard)` — Routes to chain-specific scraper by method/chain field. Skips Foss on Sundays (PriceCheck Playwright conflict). Skips Carolina PNP on Railway (datacenter IPs blocked).

### logger.js
**Purpose:** Bunyan logger singleton. Writes to service/lib/logs/dynatrack.log at debug level.
**Exports:** `log`
**Dependencies:** `bunyan`, `fs-extra`

### partNumberUtils.js
**Purpose:** Backward-compatibility re-export. Proxies `normalizePartNumber` and `extractPartNumbers` from `../utils/partMatcher`.
**Exports:** `normalizePartNumber`, `extractPartNumbers`

### platformMatch.js
**Purpose:** Platform cross-reference engine. Resolves shared-platform vehicles (e.g., Chrysler 300 matches Dodge Charger ECM sales).
**Exports:** `getPlatformMatches`, `getExpandedSalesQuery`, `applyPlatformBonus`, `normalizeMake`, `normalizeModel`, `MAKE_ALIASES`, `MODEL_ALIASES`
**Dependencies:** `../database/database` (via platform_vehicle, platform_group, platform_shared_part tables)
**Key behavior:**
- `getPlatformMatches(db, make, model, year)` — SQL join across platform tables. Returns sibling vehicles with shared part_types.
- `applyPlatformBonus(baseScore, platformMatches, salesData)` — Up to 20% score boost based on sibling sales volume.
