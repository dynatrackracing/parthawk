# LAST SESSION — 2026-04-04

## Attack List Scoring Upgrades (DEPLOYED)
- **Stock penalty scaling**: 5% (1 in stock) → 70% (5+ in stock) multiplicative reduction
- **Fresh arrival bonus**: +10% for ≤3 days, +5% for ≤7, +2% for ≤14 days old
- **COGS yard factor**: cheap yards (low entry fee + tax) get +5%, expensive get -5%
- All 3 factors applied multiplicatively after additive scoring
- Yard profiles loaded once per getAllYardsAttackList() call (entry_fee + tax_rate)
- _yardCostFactor attached to vehicles before scoreVehicle() is called
- Verified: 0 NaN scores, healthy G/Y/O/R distribution across 1,500 vehicles

## Sniper Upgrades (DEPLOYED)
- Batch size 15→35 (70 weeks full coverage vs 163 at old rate)
- Queue priority: never-checked first, highest price, oldest check
- Single LEFT JOIN SQL replaces ORM two-query approach
- GET /pricing/sniper-preview for dry-run queue inspection
- 2,449 active listings, all never-checked (22 total price checks ever)

## Also done this session
- Clean Pipe Phases A-E5 complete (see previous LAST_SESSION for details)
- Active Inventory CSV Import (368 Autolumen listings)
- Zero quantity = Ended universal rule

## What's next
- Run sniper again to validate improved hit rate (Clean Pipe E1)
- Monitor stock penalty impact on puller behavior
- Intelligence tuning (5 diagnostic items from 4/3 session)

## Open items
- instrumentclusterstore scraper returning 0 items
- The Mark table empty
- Unauthenticated write endpoints
- QUARRY data source needs rethink (queries frozen Item table)

## Architecture reminders
- Stock penalty uses max in_stock across all parts on the vehicle
- Fresh arrival uses vehicle.date_added (when yard first listed it), not last_seen
- COGS factor only applies in getAllYardsAttackList() (multi-yard), not getAttackList() (single-yard)
- _yardCostFactor is a transient property set on vehicle objects before scoring — not persisted
- Score still capped at 0-100 after all multiplicative factors
- Color codes driven by totalValue, not score (green=$800+, yellow=$500+, orange=$250+)
