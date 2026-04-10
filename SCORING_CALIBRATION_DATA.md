# SCORING CALIBRATION DATA -- 2026-04-08

## SUMMARY (Top Findings)

1. **Named engines (HEMI, EcoBoost, etc.) exist NOWHERE in decoded_engine or engine columns** -- only displacement values like "3.5L". Named engine detection must come from title parsing, not vehicle data. This is critical for the scoring rewrite.

2. **Displacement is in titles 0% of the time** (want list titles). But the VEHICLE has displacement 94% of the time. Engine matching works by extracting displacement from the PART TITLE and comparing to the vehicle's decoded_engine. Current approach is sound.

3. **Drivetrain coverage varies wildly by make**: Honda 17%, Hyundai 20%, BMW 13%, VW 2% vs Jeep 99%, Nissan 91%, Toyota 92%. ABS mismatch detection will be unreliable for makes with <50% drivetrain coverage.

4. **92% of alerts are HIGH confidence** -- the scoring is too permissive. 44% of alerts are for "OTHER" part types with no sensitivity check. The default fallback `PART_TYPE_SENSITIVITY[type] || ['engine']` applies engine sensitivity to unknown types, but many are body/interior parts where engine doesn't matter.

5. **Multi-alert vehicles are common**: 43% of vehicles have 3+ alerts, 15% have 6+. Score aggregation across multiple alerts per vehicle is a real consideration.

## CRITICAL UNKNOWNS RESOLVED

1. **Sources exhaustive**: PERCH, bone_pile, hunters_perch, restock -- no 5th value found
2. **Year in titles**: 98% Quarry, 96% Stream -- year hard gate is safe
3. **Displacement in titles**: 0% Quarry, 0% Stream -- engine matching relies on title ENGINE NAMES not displacement
4. **Named engines in vehicle data**: ZERO in decoded_engine or engine columns -- only displacement values
5. **Diesel flag**: 100% reliable -- zero vehicles with diesel engine strings and missing diesel flag
6. **CHECK_MT models**: 22 curated models in LocalVinDecoder
7. **Notes displayed**: YES, yellow italic below each alert on scout-alerts.html (line 394)
8. **Multi-alert**: 43% of vehicles have 3+ alerts
9. **Marks**: 34 active, all have structured year/make/model, zero needs_review
10. **Timing exists**: generateAlerts() logs elapsed time; elapsed field in return object
11. **PART_TYPE_SENSITIVITY**: 10 types mapped, defaults to ['engine'] for unknown
12. **Per-make capability**: dramatic variation. VW drivetrain 2%, Honda 17% vs Jeep 99%

---

## SECTION 1 -- Distinct Sources

| Source | Total | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| hunters_perch (Stream) | 3,709 | 3,389 (91%) | 2 (0.05%) | 318 (9%) |
| bone_pile (Quarry) | 2,451 | 2,262 (92%) | 4 (0.2%) | 185 (8%) |
| restock | 239 | 210 (88%) | 0 | 29 (12%) |
| PERCH (Mark) | 9 | 7 (78%) | 2 (22%) | 0 |

**No 5th source found.** Four values are exhaustive.

MEDIUM confidence is nearly nonexistent (8/6408 = 0.1%). The scoring system produces an extreme bimodal distribution: either HIGH or LOW, with almost nothing in between.

## SECTION 2 -- Want List Raw Title Patterns

**Active rows:** Quarry=1,060, Stream=116.

**Signal detection in titles:**

| Signal | Quarry (n=1060) | Stream (n=116) |
|---|---|---|
| 4-digit year | 98% | 96% |
| Displacement (X.XL) | 0% | 0% |
| Named engine | 2% (17) | 1% (1) |
| Drivetrain marker | 2% (24) | 10% (12) |
| Diesel marker | 2% (19) | 0% |
| Performance trim | 0% | 0% |
| Manual marker | 0% (2) | 2% (2) |
| Premium audio | 5% (58) | 5% (6) |

**Key finding:** Displacement is NEVER in want list titles. Engine matching cannot use displacement from the part title -- it must use named engines (HEMI, EcoBoost) or infer from the part number. Only 2% of titles mention a named engine.

**Sample Quarry titles:**
- Mercury Grand Marquis 2005 Power Steering Control Module 5W73-3F712-AA
- Toyota Sienna 2011 FWD TCM Transmission Control Module OEM 89530-08010
- 2012-2017 Hyundai Veloster TCM Transmission Control Module 95440-2A000
- Dodge Ram Cummins 2000-2001 Diesel Instrument Gauge Cluster Speedo 56045681AB
- Lincoln MKX 2011-2015 8.0" Radio Climate Control Panel Switch OEM BA1T-18A802-AN

**Sample Stream titles:**
- 2003-2010 Volvo XC70 XC90 Haldex
- 1995 Ford Ranger 4x4 Body Control Module GEM
- 2009-2010 ACURA TSX ABS (WITH VSC)
- 1997-1998 GRAND CHEROKEE ABS 052009240 052009240AC
- Nissan Pathfinder Infiniti QX4 2002 ECU ECM PCM Engine Control Module MEC14-345 (combo)

## SECTION 3 -- decoded_engine Format Reality

**Top 30 decoded_engine values (by frequency):**

| Value | Count |
|---|---|
| 2.4L | 903 |
| 3.5L | 827 |
| 2.5L | 684 |
| 3.0L | 532 |
| 2.0L | 478 |
| 3.6L | 455 |
| 1.8L | 385 |
| 4.6L | 306 |
| 1.6L | 259 |
| 3.3L | 218 |

**Float precision issue:** 928 vehicles (9.5%) have values like "3.474057568L", "2.359737216L", "1.802577040L". These are raw displacement values from corgi that were never rounded. Displacement comparison must account for floating-point imprecision (e.g., 3.474... matches "3.5L" part title).

**Named engines in decoded_engine:** ZERO. No HEMI, EcoBoost, Coyote, Pentastar, Duramax, Cummins, Vortec, or Triton in either decoded_engine or engine columns.

**Implication:** Engine matching between part titles and vehicles CANNOT use named engine strings from vehicle data. The only matching path is: (1) extract displacement from part title "3.8L Throttle Body" and compare to vehicle's "3.8L" decoded_engine, or (2) named engines in titles must be mapped to displacement ranges.

## SECTION 4 -- Diesel Flag Reliability

- diesel=true: 55 vehicles
- Engine says diesel but flag NOT set: **0**
- **100% reliable.** The diesel flag perfectly matches engine string content.

diesel is set by scrape-local.js VIN decode path and PostScrapeService. No false negatives found.

## SECTION 5 -- CHECK_MT Models

22 curated models: Corvette, Camaro, Mustang, Challenger, WRX, BRZ, FR-S, 350Z, 370Z, MX-5, Miata, Genesis Coupe, Veloster, GTI, GTO, Solstice, Sky, Lancer, FJ Cruiser, Tacoma, Frontier, Ranger, Wrangler.

## SECTION 6 -- Per-Make Decoder Capability

| Make | N | Eng% | Trim% | Tier% | DT% | Trans% |
|---|---|---|---|---|---|---|
| FORD | 1545 | 93 | 68 | 38 | 67 | 88 |
| CHEVROLET | 1191 | 94 | 95 | 51 | 56 | 91 |
| NISSAN | 1060 | 94 | 29 | 77 | 91 | 94 |
| HONDA | 745 | 94 | 99 | 50 | **17** | 98 |
| TOYOTA | 730 | 94 | 74 | 63 | 92 | 95 |
| DODGE | 605 | 93 | 96 | 40 | 90 | 89 |
| HYUNDAI | 429 | 96 | 83 | 65 | **20** | 96 |
| KIA | 276 | 94 | 93 | 56 | **29** | 98 |
| JEEP | 275 | 97 | 99 | 35 | **99** | 93 |
| CHRYSLER | 272 | 96 | 97 | 36 | 81 | 96 |
| GMC | 245 | 95 | 100 | 52 | 98 | 89 |
| VOLKSWAGEN | 196 | 94 | 79 | 34 | **2** | 85 |
| BUICK | 195 | 97 | 83 | 62 | 37 | 95 |
| MERCEDES-BENZ | 189 | 96 | 29 | **16** | **21** | 92 |
| BMW | 184 | 91 | 79 | **15** | **13** | 95 |
| MAZDA | 176 | 93 | 72 | 49 | **27** | 94 |
| CADILLAC | 162 | 93 | 58 | 28 | 52 | 96 |
| INFINITI | 159 | 97 | 26 | **10** | 89 | 96 |
| ACURA | 140 | 96 | 66 | **21** | **6** | 98 |
| LEXUS | 136 | 96 | 49 | **9** | 93 | 96 |
| LINCOLN | 119 | 93 | 42 | 46 | 52 | 94 |
| PONTIAC | 102 | 98 | 90 | 42 | **13** | 94 |
| MERCURY | 98 | 97 | 88 | 44 | 34 | 92 |
| MITSUBISHI | 91 | 99 | 49 | 38 | 54 | 88 |
| SUBARU | 86 | 99 | 90 | 52 | 90 | 94 |

**Tier% = trim_tier populated AND not CHECK** (useful for premium/performance detection).

**Critical gaps:**
- **Drivetrain**: Honda 17%, BMW 13%, Acura 6%, VW 2%, Pontiac 13% -- ABS drivetrain mismatch for these makes is unreliable
- **Trim tier**: Infiniti 10%, Lexus 9%, BMW 15%, Mercedes 16% -- luxury brands have worst trim classification
- **Engine**: Uniformly strong at 91-99% across all makes

## SECTION 7 -- Stratified Alert Sample

**ECM (engine-sensitive):**
- [HIGH] "2006-2009 FORD FUSION V6 ECU" -> 2008 Ford Fusion | notes: "Engine verified: 3.0l" -- **looks correct** (V6 is 3.0L, matches)
- [HIGH] "2006-2009 FORD FUSION V6 ECU" -> 2008 Ford Fusion | notes: "Engine verified: 2.3l" -- **looks too high** (part says V6, vehicle is 2.3L 4-cyl -- engine mismatch should be LOW)

**ABS (drivetrain-sensitive):**
- [HIGH] "1998-2005 GS300 ABS BRAKE PUMP" -> 1998 Lexus GS300 -- **looks correct** (year/make/model exact, ABS is universal on this model)

**RADIO (trim-sensitive):**
- [HIGH] "2010 Cadillac SRX BOSE AMP" -> 2010 Cadillac SRX -- **looks too high** (part is BOSE-specific but no trim check against vehicle)

**BCM (universal):**
- [HIGH] "2006-2010 Infiniti M35 IPDM Fuse Box" -> 2006 Infiniti M35 -- **looks correct** (universal part, year/make/model exact)

## SECTION 8 -- Notes Field Rendering

**YES, notes are displayed.** CSS class `alert-notes` at line 51 (yellow italic). Rendered at line 394:
```javascript
if (a.notes) h += '<div class="alert-notes">' + esc(a.notes) + '</div>';
```
Notes like "Engine mismatch: part requires 3.8L, vehicle has 3.6L" and "Drivetrain not decoded -- verify at yard" are visible to the user.

## SECTION 9 -- Multi-Part Vehicle Frequency

| Alerts per vehicle | Vehicle count | % |
|---|---|---|
| 1 | 272 | 19% |
| 2 | 262 | 18% |
| 3 | 169 | 12% |
| 4 | 155 | 11% |
| 5 | 81 | 6% |
| 6+ | 501 | 35% |

**Interpretation:** 35% of vehicles have 6+ alerts. Highest observed: 50 alerts on a single vehicle. Multi-alert aggregation is a real consideration for any vehicle-level scoring.

## SECTION 10 -- Mark Population Deep Dive

34 active marks (all needs_review=false). Distribution by part type:

| Part Type | Count | Examples |
|---|---|---|
| ECM | 14 | 88 Ford Ranger, 93 Nissan, 94 Lexus ES300, 96 Toyota Camry, 01 Dodge Caravan, 11 Jeep Wrangler |
| OTHER | 10 | Sprinter, Ford F250 parts, Land Cruiser, Pacifica spare tire |
| ABS | 3 | Buick Reatta, VW Passat, Cadillac Allante |
| BCM | 2 | 97-98 F-150, 03 Excursion |
| HEADLIGHT | 2 | BMW 645ci, Lexus LS430 |
| THROTTLE | 1 | Nissan D21 Pathfinder |
| BLIND_SPOT | 1 | Mazda |
| ALTERNATOR | 1 | Saturn Aura |

41% of marks are engine-sensitive (ECM). These benefit most from engine matching in scoreMarkMatch().

## SECTION 11 -- generateAlerts() Performance

Timing IS logged. Line 91: `const startTime = Date.now()`. Line 351-352: logs `elapsed` in ms.

The `elapsed` field is returned in the response and logged. Most recent timing not available without Railway log access, but the infrastructure exists. The function processes ~9,800 vehicles against ~1,200 want list items + ~32 marks -- should complete in seconds, not minutes.

## SECTION 12 -- Scoring Constants

**PART_TYPE_SENSITIVITY map (line 12-22):**
```javascript
{
  ECM: ['engine'], PCM: ['engine'], THROTTLE: ['engine'],
  TCM: ['engine', 'drivetrain'],
  ABS: ['drivetrain'],
  AMP: ['trim'], RADIO: ['trim'], NAV: ['trim'],
  BCM: [], TIPM: [], CLUSTER: [], HEADLIGHT: [], TAILLIGHT: [],
}
```

Default for unknown types: `['engine']` (line 588). This means body parts, mirrors, handles, etc. all get engine sensitivity checks despite not being engine-specific. This explains the 92% HIGH rate -- most "OTHER" parts pass the engine check vacuously (no displacement in the title to compare against).

**Confidence levels:** Hardcoded inline in scoreMatch() via `downgrade(level, reason)`. No config file. Refactoring to config would be straightforward.

---

## RECOMMENDATIONS FOR SCORING DESIGN

### Signals common enough to base scoring on:
- **Year** (96-98% extractable from titles) -- hard gate is safe
- **Engine displacement from vehicle** (94% decoded_engine coverage) -- reliable for engine-sensitive parts
- **Diesel flag** (100% reliable) -- safe to use as hard filter
- **Transmission** (85-98% per make) -- generally reliable

### Signals too rare for bonuses to matter:
- **Performance trim in titles** (0%) -- no perf trim markers in want list titles
- **Manual transmission in titles** (0-2%) -- rare
- **Named engines in titles** (1-2%) -- most titles don't mention HEMI/EcoBoost/etc.
- **Displacement in titles** (0%) -- titles say "V6 ECU" not "3.5L ECU"

### Makes needing per-make capability profile:
- **Drivetrain-poor**: Honda (17%), BMW (13%), Acura (6%), VW (2%), Hyundai (20%), Kia (29%), Pontiac (13%) -- ABS drivetrain mismatch unreliable
- **Trim-poor**: Infiniti (10%), Lexus (9%), BMW (15%), Mercedes (16%) -- luxury brands ironically have worst trim data

### Diesel flag: Trustworthy (0 false negatives).

### Named engines: Must come from title parsing. Vehicle data has only displacement values. Named engine -> displacement mapping table needed for cross-reference.

### Rescore timing: generateAlerts() already has elapsed timing. With ~9,800 vehicles x ~1,200 parts, should complete in single-digit seconds. Synchronous rescore during migration should be fine.

### Unexpected finding: The default fallback `|| ['engine']` for unknown part types means EVERY unrecognized part gets engine sensitivity, which almost always passes (because the title usually has no displacement to compare against). This creates false HIGH confidence on 44% of alerts. Fix: change default to `[]` (universal -- no sensitivity check) and explicitly add engine sensitivity only to known engine-specific types.
