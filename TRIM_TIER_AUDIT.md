# TRIM TIER AUDIT — DarkHawk

**Generated:** 2026-03-28
**Scope:** End-to-end trim/tier data flow from LKQ scrape to UI display

---

## 1. SCRAPER (scrape-local.js)

### Columns inserted into yard_vehicle:
```javascript
await knex('yard_vehicle').insert({
  id: uuidv4(), yard_id: yardId,
  year: v.year, make: v.make, model: v.model, trim: null,
  color: v.color || null, row_number: v.row || null,
  vin: hasVin ? v.vin : null, stock_number: v.stock || null,
  date_added: dateAdded,
  active: true, first_seen: now, last_seen: now,
  scraped_at: now, createdAt: now, updatedAt: now,
});
```

### Trim data from LKQ:
**None.** LKQ HTML does not provide trim data. The `trim` column is explicitly set to `null` on every insert. The scraper extracts year, make, model, color, VIN, row, stock number, and date added — but not trim.

---

## 2. VIN DECODE (decode-yard-vins.js)

### NHTSA fields extracted:
```javascript
const decodedTrim = r.Trim || null;
const decodedEngine = r.DisplacementL ? `${r.DisplacementL}L` : null;
const decodedDrivetrain = r.DriveType || null;
```

### Columns updated on yard_vehicle:
```javascript
await db('yard_vehicle').where('id', row.id).update({
  decoded_trim: decodedTrim,
  decoded_engine: decodedEngine,
  decoded_drivetrain: decodedDrivetrain,
  trim_tier: trimTier,
  vin_decoded_at: new Date(),
});
```

### trim_tier assignment logic:

`lookupTrimTier(year, make, model, trimName)` has a two-tier fallback:

1. **trim_catalog table** (eBay Taxonomy API data):
   - Exact match: `WHERE year = ? AND LOWER(make) = ? AND LOWER(model) = ? AND LOWER(trim_name) = ?`
   - Partial match (first word): `WHERE ... AND LOWER(trim_name) LIKE 'firstWord%'`
   - Returns `match.tier` (a string: 'PREMIUM', 'CHECK', or 'BASE')

2. **Static config fallback** (`getTrimTier(make, trim)` from `trim-tier-config.js`):
   - Used when trim_catalog has no matching entry
   - Returns `result.tier` string

If `decodedTrim` is null (NHTSA didn't return trim), `trim_tier` is set to `null`.

---

## 3. TRIM TIER CONFIG (service/config/trim-tier-config.js)

### Tier values and multipliers:
```javascript
const TIER = { PREMIUM: 1.0, CHECK: 0.5, BASE: 0.0 };
```

### Trim mapping (73 entries):

**BASE (multiplier 0.0) — 23 trims:**
xl, s, work truck, express, tradesman, willys, special service, hfe, enforcer, l, le, ce, dx, lx, lx-s, lx-p, ls, wt, fleet, value edition, blue, es, gls

**CHECK (multiplier 0.5) — 30 trims:**
xlt, se, sel, sxt, sport, titanium, ssv, slt, big horn, lone star, rt, r/t, gt, touring, latitude, altitude, trailhawk, sahara, laredo, xle, xse, sr5, trd sport, trd off-road, ex, ex-l, lt, z71, rst, at4, trail boss, custom, sv, n line, sx, preferred, select, pursuit, daytona, eco, gl, outdoorsman, sr, st (default CHECK, overridden to BASE for Ram)

**PREMIUM (multiplier 1.0) — 34 trims:**
lariat, king ranch, platinum, limited, raptor, tremor, laramie, laramie limited, laramie longhorn, longhorn, rebel, citadel, overland, summit, rubicon, srt, srt 392, srt hellcat, high altitude, trackhawk, trd pro, 1794, capstone, elite, type r, ltz, high country, denali, premier, at4x, sl, calligraphy, grand touring, signature, f sport, luxury, premium, prestige

### Make-specific overrides (7 makes):
```javascript
const MAKE_TRIM_OVERRIDES = {
  ram:    { 'st': TIER.BASE, 'sport': TIER.CHECK, 'outdoorsman': TIER.CHECK },
  honda:  { 'touring': TIER.PREMIUM },
  acura:  { 'touring': TIER.PREMIUM },
  subaru: { 'premium': TIER.CHECK, 'touring': TIER.PREMIUM, 'base': TIER.BASE },
  mazda:  { 'sport': TIER.BASE, 'gt': TIER.PREMIUM },
  nissan: { 'sv': TIER.CHECK, 'sr': TIER.CHECK },
  toyota: { 'sr': TIER.BASE },
};
```

### Premium brand floor (15 brands):
lexus, acura, infiniti, cadillac, lincoln, bmw, mercedes, mercedes-benz, audi, volvo, buick, porsche, jaguar, land rover, mini

Rule: if make is in PREMIUM_BRANDS and resolved tier is BASE, upgrade to CHECK. Premium brands never get fully suppressed.

### Part classification:

**Trim-dependent parts** (20 categories — score multiplied by tier):
amplifier, amp, premium radio, camera, parking sensor, blind spot, heated seat, cooled seat, ventilated seat, power liftgate, power running board, heads up display, premium cluster, lane departure, adaptive cruise, wireless charging, power folding mirror, memory seat, surround view, trailer brake controller, panoramic sunroof

**Universal parts** (19 categories — always 1.0x regardless of trim):
ecm, ecu, pcm, bcm, tcm, abs, tipm, fuse box, fuse relay, throttle body, throttle, steering module, steering control, power steering, airbag, hvac, climate control, ignition, window regulator, window motor, door lock, seat belt, wiper

### Exported functions:
- `getTrimTier(make, trim)` → `{ tier, multiplier, badge, color }`
- `isTrimDependent(partType)` → boolean
- `getPartScoreMultiplier(make, trim, partType)` → `{ multiplier, reason, badge, color }`

---

## 4. YARD_VEHICLE TABLE — All Columns

From migrations (cumulative):

| Column | Type | Migration | Purpose |
|--------|------|-----------|---------|
| id | uuid PK | 20260317000001 | Primary key |
| yard_id | uuid FK | 20260317000001 | Links to yard table |
| year | string(10) | 20260317000001 | Vehicle year |
| make | string(100) | 20260317000001 | Vehicle make |
| model | string(100) | 20260317000001 | Vehicle model |
| trim | string(100) | 20260317000001 | **Always NULL** (LKQ doesn't provide) |
| color | string(100) | 20260317000001 | Vehicle color |
| row_number | string(50) | 20260317000001 | Location in yard |
| vin | string(20) | 20260317000001 | VIN (if available) |
| date_added | date | 20260317000001 | LKQ "set date" |
| scraped_at | timestamp | 20260317000001 | Last scrape time |
| active | boolean | 20260317000001 | Still on yard |
| createdAt | timestamp | 20260317000001 | Record creation |
| updatedAt | timestamp | 20260317000001 | Record update |
| first_seen | timestamp | 20260318200000 | First scrape detection |
| last_seen | timestamp | 20260318200000 | Last scrape confirmation |
| stock_number | string(30) | 20260319200000 | LKQ stock number |
| engine | string(50) | 20260319200000 | Engine (from NHTSA or scraper) |
| engine_type | string(20) | 20260319200000 | Gas/Diesel/Hybrid/Electric |
| drivetrain | string(20) | 20260319200000 | 4WD/AWD/FWD/RWD |
| trim_level | string(100) | 20260319200000 | NHTSA decoded trim (older column) |
| body_style | string(50) | 20260319200000 | NHTSA body style |
| vin_decoded | boolean | 20260319200000 | Old decode flag |
| decoded_trim | text | 20260327000004 | NHTSA Trim field (newer, used by tier logic) |
| decoded_engine | text | 20260327000004 | NHTSA displacement |
| decoded_drivetrain | text | 20260327000004 | NHTSA drive type |
| trim_tier | text | 20260327000004 | Tier classification (PREMIUM/CHECK/BASE/null) |
| vin_decoded_at | timestamp | 20260327000004 | When VIN was decoded |

### Columns NOT present:
- No `audio_brand` column
- No `expected_parts` column
- No `cult` column

### Redundancy note:
Two sets of VIN decode columns exist:
- **Older set** (20260319200000): `engine`, `engine_type`, `drivetrain`, `trim_level`, `body_style`, `vin_decoded`
- **Newer set** (20260327000004): `decoded_trim`, `decoded_engine`, `decoded_drivetrain`, `trim_tier`, `vin_decoded_at`

The scoring logic uses `decoded_trim` (newer) with fallback to `trim_level` (older) then `trim` (always null).

---

## 5. ATTACK LIST SERVICE (scoreVehicle)

### Import:
```javascript
const { getPartScoreMultiplier } = require('../config/trim-tier-config');
```

### Trim resolution in scoreVehicle():
```javascript
const vehicleTrim = vehicle.decoded_trim || vehicle.trim_level || vehicle.trim || null;
```
Priority: `decoded_trim` > `trim_level` > `trim` (always null) > null

### Trim multiplier application (per part):
```javascript
for (const p of filteredParts) {
  const trimResult = getPartScoreMultiplier(make, vehicleTrim, p.partType);
  p.trimMultiplier = trimResult.multiplier;
  p.trimNote = trimResult.reason;
  if (trimResult.badge) p.trimBadge = trimResult.badge;
  if (trimResult.multiplier < 1.0 && p.price) {
    p.originalPrice = p.price;
    p.price = Math.round(p.price * trimResult.multiplier);
  }
}
```

### Trim fields in scored vehicle output:
```javascript
{
  trim_level: vehicle.trim_level || null,
  decoded_trim: vehicle.decoded_trim || null,
  trim_tier: vehicle.trim_tier || null,
  trimBadge: vehicle.trim_tier ? {
    tier: vehicle.trim_tier,
    label: vehicle.trim_tier === 'PREMIUM' ? 'PREMIUM TRIM' : vehicle.trim_tier === 'BASE' ? 'BASE TRIM' : 'CHECK TRIM',
    color: vehicle.trim_tier === 'PREMIUM' ? 'green' : vehicle.trim_tier === 'BASE' ? 'red' : 'yellow',
    decodedTrim: vehicle.decoded_trim,
  } : null,
}
```

### Key behavior:
- `trimBadge` is ONLY set when `vehicle.trim_tier` is non-null (i.e., VIN was decoded AND trim was classified)
- If `trim_tier` is null (no VIN, VIN decode failed, or NHTSA didn't return trim), no badge is shown
- The trim multiplier adjusts the `p.price` BEFORE totalValue is calculated, directly affecting the vehicle score

---

## 6. FRONTEND (attack-list.html)

### Vehicle card — trim badge display:
```html
${v.trimBadge ? ` <span class="chip" style="font-size:9px;font-weight:700;padding:1px 6px;
  background:${v.trimBadge.color === 'green' ? '#22c55e' : v.trimBadge.color === 'red' ? '#ef4444' : '#f59e0b'};
  color:${v.trimBadge.color === 'yellow' ? '#000' : '#fff'}"
  title="${v.trimBadge.decodedTrim || ''}">${v.trimBadge.label}</span>` : ''}
```
- Green pill (#22c55e, white text): PREMIUM TRIM
- Yellow pill (#f59e0b, black text): CHECK TRIM
- Red pill (#ef4444, white text): BASE TRIM
- Tooltip shows `decodedTrim` (e.g., "Laramie")
- No badge shown when trim_tier is null

### Expanded part view — trim warning:
```html
${p.trimMultiplier !== undefined && p.trimMultiplier < 1.0 ?
  (p.trimMultiplier === 0 ?
    ' <span style="color:#ef4444;font-weight:600">· Not expected on this trim</span>' :
    ' <span style="color:#f59e0b;font-weight:600">· ⚠️ Verify on vehicle</span>')
  : ''}
```
- `trimMultiplier === 0` (BASE): "Not expected on this trim" in red
- `trimMultiplier === 0.5` (CHECK): "Verify on vehicle" in yellow
- `trimMultiplier === 1.0` (PREMIUM) or undefined: no warning

---

## 7. PASTE SET LIST (POST /attack-list/manual)

### Trim parsing:
- Recognizes "trim:" metadata lines in the regex but **does NOT extract them** into the vehicle object
- Sets `trim_level: null` explicitly on all manual vehicles
- VIN decode via NHTSA sets `trim_level` from VariableId 38 (if VIN provided)
- **Does NOT call any trim tier lookup** — no `trim_tier`, no `decoded_trim` set
- Trim handling is deferred to `scoreVehicle()` which reads `vehicle.decoded_trim || vehicle.trim_level || vehicle.trim`

### Gap:
Manual paste vehicles with VINs get `trim_level` from NHTSA decode but NOT `trim_tier`. The `trimBadge` will be null because `trim_tier` is not set. The trim MULTIPLIER still works because `scoreVehicle()` resolves trim from `trim_level` and calls `getPartScoreMultiplier()` directly — but the UI badge won't show.

---

## 8. SCOUT ALERTS (ScoutAlertService.js)

### Trim references:
- Selects `yard_vehicle.trim_level` in vehicle query
- Uses `trim_level` for confidence scoring: if a match needs trim verification and `vehicle.trim_level` is null, confidence is set to 'medium' with note "Verify trim/hybrid at yard"
- **Does NOT reference:** `trim_tier`, `decoded_trim`, `trimBadge`, or `getPartScoreMultiplier()`
- No trim-based score adjustment in alert generation

---

## FULL DATA FLOW

```
LKQ HTML scrape (scrape-local.js)
  └─ INSERT yard_vehicle: trim=NULL (LKQ doesn't provide trim)
       │
       ├─ build-trim-catalog.js (eBay Taxonomy API)
       │    └─ Populates trim_catalog table: year/make/model/trim_name/tier
       │
       └─ decode-yard-vins.js (NHTSA API)
            ├─ NHTSA returns: Trim, DisplacementL, DriveType
            ├─ UPDATE yard_vehicle: decoded_trim, decoded_engine, decoded_drivetrain
            ├─ lookupTrimTier():
            │    ├─ Try trim_catalog (exact then partial match) → tier string
            │    └─ Fallback: getTrimTier(make, trim) from trim-tier-config.js → tier string
            └─ UPDATE yard_vehicle: trim_tier = 'PREMIUM'|'CHECK'|'BASE'|null
                    │
                    ▼
            AttackListService.scoreVehicle()
                    │
                    ├─ vehicleTrim = decoded_trim || trim_level || trim (fallback chain)
                    ├─ For each part: getPartScoreMultiplier(make, vehicleTrim, partType)
                    │    ├─ Universal part → multiplier 1.0 (no adjustment)
                    │    └─ Trim-dependent part → multiplier from tier (1.0 / 0.5 / 0.0)
                    ├─ p.price *= trimMultiplier (affects totalValue → vehicle score)
                    ├─ trimBadge built from vehicle.trim_tier (only if non-null)
                    └─ Output: { trim_level, decoded_trim, trim_tier, trimBadge, parts[].trimMultiplier }
                            │
                            ▼
                    attack-list.html
                            │
                            ├─ Vehicle card: colored pill badge (PREMIUM/CHECK/BASE)
                            │    └─ Tooltip shows decoded trim name (e.g., "Laramie")
                            └─ Part details: warning text if trimMultiplier < 1.0
```

---

## GAPS AND INCONSISTENCIES

1. **Redundant trim columns:** `trim` (always null), `trim_level` (NHTSA via older script), `decoded_trim` (NHTSA via newer script). Three columns for the same concept. The scoring uses all three in a fallback chain.

2. **Manual paste vehicles:** VIN-decoded trim_level is populated but trim_tier is not. The multiplier still applies (via `getPartScoreMultiplier` which resolves trim inline), but the UI badge won't display because it requires `vehicle.trim_tier` to be set.

3. **ScoutAlerts:** Uses `trim_level` but ignores `decoded_trim` and `trim_tier`. No trim-based score adjustment.

4. **trim_catalog vs static config:** Two sources of truth with different coverage. trim_catalog has eBay Taxonomy data (more comprehensive but needs API calls to populate). Static config has ~73 hand-curated entries. They can disagree on tier assignment.

5. **No trim_tier on older vehicles:** Vehicles decoded before the `trim_tier` column was added (migration 20260327000004) have `trim_level` set but `trim_tier = null`. The badge won't show even though the multiplier still works.
