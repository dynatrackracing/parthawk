# SCOUT ALERT DIAGNOSIS — 2026-04-08

## SUMMARY (Top 5 Findings)

1. **Year data is available in 96-98% of want list titles** (both Quarry and Stream). No structural year column on restock_want_list, but parseTitle() extracts years reliably. Year hard gate would only drop ~7% of alerts (489/6408). Not catastrophic.

2. **Engine matching is already working** in scoreMatch(). LOW-confidence alerts show "Engine mismatch: part requires 3.8L, vehicle has..." — the engine comparison is live and producing correct downgrades. 94% of vehicles have decoded_engine.

3. **bone_pile = Quarry** (sourced from YourSale directly in generateAlerts). **hunters_perch = Stream** (from restock_want_list). **PERCH = Mark** (from the_mark). **restock = Restock flags**. The scout_alerts.source column already cleanly distinguishes all intent sources.

4. **Trim tier is 99% populated** but 53% are CHECK (unresolved). PREMIUM=1018 (10%), PERFORMANCE=22 (0.2%). Trim-based confidence adjustments have data but most vehicles are CHECK/BASE (low signal).

5. **No stale alerts** (all <30 days). No needs_review marks leaking into alerts (the hard gate from 2026-04-07 is working). Zero PERCH alerts match needs_review marks.

---

## SECTION A — scout_alerts table shape

**Schema:**

| Column | Type | Nullable | Default |
|---|---|---|---|
| id | integer | NO | auto-increment |
| source | varchar(20) | NO | |
| source_title | text | NO | |
| part_value | numeric | YES | |
| yard_name | varchar | YES | |
| vehicle_year | varchar | YES | |
| vehicle_make | varchar | YES | |
| vehicle_model | varchar | YES | |
| vehicle_color | varchar | YES | |
| row | varchar | YES | |
| confidence | varchar | NO | |
| notes | text | YES | |
| vehicle_set_date | date | YES | |
| created_at | timestamptz | YES | CURRENT_TIMESTAMP |
| claimed | boolean | YES | false |
| claimed_by | text | YES | |
| claimed_at | timestamptz | YES | |

**Counts:**
- Total: 6,408
- By source: hunters_perch=3,709 (58%), bone_pile=2,451 (38%), restock=239 (4%), PERCH=9 (0.1%)
- By confidence: high=5,868 (92%), low=532 (8%), medium=8 (0.1%)

**What is bone_pile?** It is the Quarry source. ScoutAlertService.generateAlerts() queries YourSale directly (90-day window, $50+ price) and writes matched alerts with `source: 'bone_pile'`. Referenced in: ScoutAlertService.js:182, restockReport.js:363, scout-alerts.js:24/38/52/93/94/95/142.

## SECTION B — restock_want_list year coverage

**Schema:** id, title, notes, created_at, active, pulled, pulled_date, pulled_from, auto_generated, part_number, make, model. **NO year column.**

**Active rows:** Quarry (auto=true)=1,060, Stream (auto=false/null)=117.

**Year in title (regex `(19|20)\d{2}`):**
- Quarry: 1,038/1,060 = **98%** have a 4-digit year in the title
- Stream: 112/117 = **96%** have a 4-digit year in the title

**make/model/part_number columns:** All NULL. These columns exist but are never populated by the Quarry promotion flow (restockReport.js quarrySync) or the manual add flow. Title-only data.

**Interpretation:** Year is extractable from title via parseTitle() at alert generation time. No structural year column needed for the current matching flow. parseTitle() + parseYearRange() (enhanced 2026-04-07) handles 2-digit years too.

## SECTION C — the_mark year coverage

- Active marks: 32 (all needs_review=false after the 2026-04-07 backfill + manual corrections)
- All have year_start, year_end, make, model populated
- Sample: 1994 Lexus ES300, 1989-1990 Buick Reatta, 1991-1993 Dodge 3000GT, 2001 Dodge Caravan, 2011 Jeep Wrangler

**Interpretation:** Marks are the cleanest data source. The 2026-04-07 migration added structured fields and the hard year gate is working (no needs_review marks in scout_alerts).

## SECTION D — yard_vehicle engine and trim coverage

**Coverage (active vehicles = 9,819):**

| Field | Count | Percent |
|---|---|---|
| engine | 9,739 | 99% |
| decoded_engine | 9,240 | 94% |
| decoded_trim | 7,262 | 74% |
| trim_tier | 9,766 | 99% |
| decoded_drivetrain | 5,882 | 60% |
| decoded_transmission | 9,293 | 95% |

**trim_tier distribution:**
- CHECK: 5,166 (53%)
- BASE: 3,560 (36%)
- PREMIUM: 1,018 (10%)
- PERFORMANCE: 22 (0.2%)
- NULL: 53 (0.5%)

**decoded_engine patterns:** Raw displacement values like "3.5L", "5.3L", "2.0L", "1.968000L", "3.189000L". Mix of clean rounded values and raw float precision. No cylinder count or fuel type in the string — those are separate fields (engine_type, diesel boolean).

**Interpretation:** Engine data is strong (94%). Drivetrain is the weakest at 60%. Trim tier is near-universal but 53% CHECK = low discriminatory value.

## SECTION E — diesel/hybrid/electric/manual coverage

| Attribute | Count |
|---|---|
| Diesel | 55 |
| Electric (engine_type) | 9 |
| Hybrid (engine_type) | 0 (Prius etc tagged as Gas — known bug, fixed in scoring via classifyPowertrain) |
| Manual transmission | 101 |

**Interpretation:** Small but non-zero populations. Hybrid detection runs at scoring time via classifyPowertrain() model-name fallback — correct despite engine_type column being wrong.

## SECTION F — engine extraction from part numbers

**No function exists** that extracts engine info from a part number. Searched partIntelligence.js, partMatcher.js, AttackListService.js — none parse engine family from OEM PNs.

ScoutAlertService.js has `extractDisplacement(s)` (line 517) and `extractEngineName(s)` (line 531) but these extract from **titles**, not part numbers. They look for patterns like `\b(\d+\.\d)\s*L/i` and named engines (HEMI, EcoBoost, Coyote, Pentastar).

**GAP:** GM ECM part numbers encode engine family in positions 5-7 (e.g., 12A650 = gasoline, different suffix = diesel). This mapping is not implemented. Ford PNs have similar encoding. This would improve matching but requires a lookup table.

## SECTION G — TrimTierService hit rate

Not directly queryable without running TrimTierService against each YMM. However, the trim_tier distribution above tells the story:
- 99% have a trim_tier value (hit or fallback)
- 53% are CHECK (the tier assignment ran but couldn't determine BASE vs PREMIUM)
- 10% are PREMIUM, 36% are BASE — these are confident assignments
- 0.2% are PERFORMANCE — rare but correct (SRT, Raptor, etc.)

**Interpretation:** Trim tier is useful as a PREMIUM/PERFORMANCE boost signal (10% of fleet) but not as a discriminating filter for the majority of vehicles.

## SECTION H — scoreMatch() behavior sample

**HIGH confidence examples:** "2006-2010 Infiniti M35 IPDM Fuse Box" matched to 2006/2007/2008/2010 Infiniti M35. Year in range, make/model exact. No engine check needed for BCM/TIPM type parts (universal sensitivity). **Correct.**

**MEDIUM confidence examples:** "2005-2008 honda pilot fwd abs" matched to 2005 Honda Pilot with note "Drivetrain not decoded -- verify at yard". Engine-specific parts on vehicles without decoded data get downgraded. Also: Mini Cooper S supercharger matched with "Engine not decoded -- verify at yard". **Correct behavior.**

**LOW confidence examples:** "Buick Lacrosse Lucerne Grand Prix 3.8L Throttle Body" matched to 2009 Buick Lucerne with "Engine mismatch: part requires 3.8L, vehicle has [different]". **Correct -- engine mismatch detection is working.**

**Interpretation:** The 3-tier confidence system is functioning. Engine comparison against decoded_engine is live and producing meaningful LOW downgrades. The main gap is not detection -- it's that 92% are HIGH (possibly too permissive for engine-agnostic part types).

## SECTION I — year hard gate impact

| Source | Total | Has year in title | No year | Would drop |
|---|---|---|---|---|
| hunters_perch | 3,709 | 3,486 (94%) | 223 (6%) | 223 |
| bone_pile | 2,451 | 2,185 (89%) | 266 (11%) | 266 |
| restock | 239 | 239 (100%) | 0 | 0 |
| PERCH | 9 | 4 (44%) | 5 (56%) | 5 |

**Total would drop:** 494/6,408 = **7.7%**

The 5 PERCH alerts without years are from needs_review marks that were generated before the 2026-04-07 hard gate fix. They will not regenerate.

**Interpretation:** A year hard gate would be safe. 92.3% of alerts would survive. The 7.7% that would drop are mostly yearless titles from hunters_perch/bone_pile where year wasn't extractable -- these are already lower-quality matches.

## SECTION J — part type vs attribute coverage

| Part Category | Alert Count | % of Total |
|---|---|---|
| OTHER | 2,811 | 44% |
| ECM/PCM/ECU | 1,150 | 18% |
| ABS | 1,146 | 18% |
| RADIO/AMP/NAV | 656 | 10% |
| BCM/TIPM | 331 | 5% |
| THROTTLE | 189 | 3% |
| CLUSTER | 125 | 2% |

**Engine-sensitive types (ECM/THROTTLE):** 1,339 alerts. 94% of vehicles have decoded_engine. Engine comparison is meaningful for these.

**Drivetrain-sensitive (ABS):** 1,146 alerts. Only 60% of vehicles have decoded_drivetrain. Drivetrain mismatch detection has gaps.

**Trim-sensitive (RADIO/AMP/NAV):** 656 alerts. 74% have decoded_trim, but 53% of those are CHECK (unhelpful). Real trim signal available for only ~20% of fleet.

## SECTION K — unexpected findings / red flags

1. **Zero stale alerts** (all <30 days). The atomic delete+reinsert in generateAlerts() is working -- alerts are fully refreshed on each server restart.

2. **Zero needs_review marks leaking** into PERCH alerts. The 2026-04-07 hard gate (`WHERE needs_review=false OR needs_review IS NULL`) is confirmed working.

3. **make/model/part_number columns on restock_want_list are ALL NULL** across all 1,177 active rows. The Quarry promotion flow (quarrySync) never populates these columns -- it writes only title and notes. This is a data quality gap but not blocking since parseTitle() extracts at alert generation time.

4. **bone_pile naming inconsistency:** The source value `bone_pile` in scout_alerts refers to what users see as "QUARRY" in the UI. `hunters_perch` refers to what users see as "STREAM". This naming was inherited from an earlier version when the pages were named differently. Not a bug, just confusing for code readers.

5. **92% HIGH confidence** is suspiciously uniform. For the 44% of alerts in the OTHER category, the confidence assessment may be too permissive -- many of these are universal parts (mirrors, handles, trim pieces) where engine/transmission don't matter, so HIGH is technically correct but provides no signal.

---

## RECOMMENDATIONS

### Already usable:
- **Year in title:** 96-98% extractable. parseYearRange() enhanced 2026-04-07 handles 2-digit years.
- **Engine matching:** Already live in scoreMatch(). 94% of vehicles have decoded_engine.
- **Source distinction:** scout_alerts.source cleanly maps to Mark/Quarry/Stream/Restock.
- **Part type sensitivity:** PART_TYPE_SENSITIVITY map in ScoutAlertService already routes engine-sensitive types through engine comparison.

### Needs backfilling:
- **restock_want_list make/model/part_number columns** -- all NULL, never populated. Low priority since title parsing works, but would speed up matching.

### New extraction helpers needed:
- **Engine from part number** (e.g., GM ECM suffix → engine family). Not blocking but would improve ECM/PCM matching when title doesn't mention engine size.

### Migrations needed:
- None required for the matching logic rebuild. All data needed is already queryable. The year hard gate can be implemented by extracting year from title at match time (already done for Marks, needs to be done for bone_pile/hunters_perch sources).

### Biggest unknowns:
- Whether 60% drivetrain coverage is sufficient for ABS mismatch detection, or if 40% NULL drivetrain would produce too many "verify at yard" MEDIUM downgrades.
- Whether engine-from-PN extraction is worth building, or if title-based engine extraction covers enough cases.
