# 2007 Honda Pilot -- Scout Alert to Attack List Gap

## Vehicle
- **id:** 5e19c2d0-5680-49ed-8a09-91a903a7b921
- **Yard:** LKQ Durham
- **YMM:** 2007 Honda Pilot LX (White)
- **VIN:** 5FNYF28167B030562
- **Set date:** 2026-04-09
- **Active:** true
- No duplicate rows (second Durham Pilot is inactive, different VIN)

## Scout alerts on this vehicle
3 alerts found (composite key match on vehicle_year=2007, vehicle_make=HONDA, vehicle_model=PILOT, yard_name LIKE '%Durham%'):

| Confidence | Score | Source | Title |
|---|---|---|---|
| **high** | **85** | hunters_perch | 2006-2008 Honda Pilot FWD ABS 57110-STW-A03 |
| low | 50 | hunters_perch | 2005-2008 HONDA PILOT IGNITION LOCK W/KEYS & IMMOBILIZER |
| low | 50 | hunters_perch | 2005-2008 honda pilot ignition switch with key |

The HIGH alert is on ABS with PN 57110-STW-A03.

## Attack List parts response
`scoreVehicle()` returns **1 part** for this vehicle:

| partType | partNumber | price | priceSource | title |
|---|---|---|---|---|
| OTHER | 12310-RCA-A03 | $200 | item_reference | 05-10 Honda Odyssey / 06-08 Pilot Ridgeline V... |

**ABS PART NOT FOUND in scored.parts.**

The only part is an "OTHER" type item_reference row. No ABS chip exists for the scout alert to attach to.

## Inventory + YourSale lookup for the alerted part

### YourSale for Honda Pilot ABS (90 days)
3 sales found, but they are all for **2012-2015 Pilot** ABS pumps, not 2006-2008:
- $305 -- "2012-2015 Honda Pilot VSA Anti Lock Brake ABS Pump Module"
- $300 -- "2012-2015 Honda Pilot ABS Anti Lock Brake Pump Module"
- $315 -- "Honda Pilot 2012-2015 Anti-Lock Brake Pump Assembly SZB"

These do NOT match the 2007 Pilot's year range. The salesIndex year filter (lines 1003-1018 in AttackListService) rejects them because 2007 is outside the 2012-2015 range on each sale title.

### YourSale for PN 57110-STW-A03 specifically
**0 results.** We have never sold this specific ABS pump PN.

### Want list entries
- auto=true: "Honda Pilot 2012-2015 ABS Anti Lock Brake Pump Module" (Quarry -- wrong generation)
- auto=false: **"2006-2008 Honda Pilot FWD ABS 57110-STW-A03"** (Stream -- this is the source of the scout alert)

The Stream want list entry IS for the right generation (2006-2008). The scout alert was generated from this want list entry and correctly matched to the 2007 Pilot at Durham. But the Attack List has no ABS part to display because:
1. We've never sold a 2006-2008 Pilot ABS pump (0 YourSale rows for that generation)
2. The Auto+AIC inventory join doesn't produce an ABS chip for this vehicle (only 1 "OTHER" item_reference part)
3. Therefore scoreVehicle() has no ABS row in its parts[] array
4. The /vehicle/:id/parts handler merges alerts ONTO existing parts -- it doesn't inject new parts from alerts

## Join code

**File:** `service/routes/attack-list.js:238-267`

The join is a nested loop: outer loop over `scored.parts`, inner loop over `alerts`. For each part, it checks if any alert's source_title contains the part's partType or partNumber. If a match is found, the alert is attached to the part via `part.alertMatch`.

**Critical: there is no reverse path.** If an alert exists but no part exists to attach it to, the alert is silently dropped. The code only iterates parts that already exist from the inventory/YourSale scoring pipeline.

```javascript
// Line 246-264: merge loop
for (const part of (scored.parts || [])) {       // <-- only iterates existing parts
  for (const alert of alerts) {
    const typeMatch = partType.length >= 3 && alertTitle.includes(partType);
    const pnMatch = partNumber.length >= 5 && alertTitle.toUpperCase().includes(partNumber);
    if (typeMatch || pnMatch) {
      part.scoutAlertMatch = true;                // <-- attaches to existing part
    }
  }
}
// There is no "for (const alert of alerts) { if (no matching part) inject one }" path
```

## Diagnosis

**B) INJECTION GAP** -- scout_alert exists (ABS, score=85, hunters_perch source) but no inventory part exists to attach to. Root cause chain:

1. The want list has "2006-2008 Honda Pilot FWD ABS 57110-STW-A03" (Stream entry)
2. ScoutAlertService correctly generates a HIGH confidence alert for this part on the 2007 Pilot at Durham
3. AttackListService.scoreVehicle() produces parts from two sources: YourSale (sales indexed by make|model, filtered by year) and Auto+AIC inventory
4. YourSale has 3 Honda Pilot ABS sales but all are 2012-2015 generation -- year filter rejects them for a 2007 vehicle
5. Auto+AIC inventory has only 1 "OTHER" item for this vehicle (no ABS item)
6. scoreVehicle() returns 0 ABS parts
7. The /vehicle/:id/parts handler loads 3 scout alerts, loops over the 1 scored part (OTHER), finds no type/PN match for the ABS alert, silently drops it
8. The puller sees the vehicle on Scout Alerts with HIGH ABS confidence but when they open the same vehicle on Daily Feed, no ABS chip appears

## Recommended fix (one paragraph, no code yet)

The /vehicle/:id/parts handler needs an injection path: after the existing merge loop, iterate remaining unattached alerts and CREATE synthetic part chips for them. These synthetic chips would have partType extracted from the alert's source_title (via detectPartType), partNumber extracted from source_title (via extractPartNumbers), price from the alert's part_value field, priceSource='scout_alert', and the scout alert badge pre-attached. They would sort to the top of the parts list (scout-alert-first sort already handles this). This ensures every scout alert on a vehicle is visible on the Daily Feed expanded view, even when no inventory or YourSale data exists for that part type on that vehicle. The synthetic chip makes the puller aware that this specific part is on their want list and matched this vehicle, even though it has never been sold or stocked.
