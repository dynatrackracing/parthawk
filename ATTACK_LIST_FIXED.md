# Attack List Fixed — 2026-03-18

## What was broken
The `/admin/pull` UI showed "No vehicles found" because the `/attack-list` API returned `{ yards: [] }`.

## Root cause
The `AttackListService.getAllYardsAttackList()` query filtered yards with:
```js
.where('flagged', false)
```
But the LKQ yards seeded by the migration had `flagged: null` (not `false`). In PostgreSQL, `WHERE flagged = false` does NOT match `NULL` values. All 4 LKQ yards were silently excluded.

## Fix
Changed the query to:
```js
.where(function() {
  this.where('flagged', false).orWhereNull('flagged');
})
```
Same fix applied in `routes/cogs.js` which had the same pattern.

## Current status
All 4 LKQ yards returning vehicles via `/attack-list`:

| Yard | Vehicles | Hot | Top Score |
|------|----------|-----|-----------|
| LKQ Durham | 24 | 22 | 70 |
| LKQ Raleigh | 25 | 24 | 70 |
| LKQ East NC | 25 | 23 | 70 |
| LKQ Greensboro | 24 | 18 | 70 |

## LKQ Scraper status
The scraper correctly parses all pages (Raleigh has 1011 vehicles across 40+ pages confirmed locally). Current production counts are from a single-page test scrape. The nightly 2am cron will pull full inventory.

Note: Railway's server IP may get CloudFlare challenges from pyp.com. If the nightly scrape returns 0, the fallback is to run the scrape from a non-datacenter IP.
