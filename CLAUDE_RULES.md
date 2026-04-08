# CLAUDE_RULES.md — READ THIS FIRST EVERY SESSION

These are non-negotiable constraints for DarkHawk development. Violating any of these has caused real bugs in production. Read all of them before touching any file.

---

## WORKFLOW RULES

1. **DIAGNOSE BEFORE TOUCHING.** Read the actual deployed code before making changes. Run read-only diagnostics before any writes. No assumptions about what a file contains.

2. **ONE DELIVERABLE PER SESSION.** Fix one thing, test it, commit it. Do not touch files unrelated to the current task.

3. **READ LAST_SESSION.md AND CHANGELOG.md FIRST.** These tell you what the previous session did. Do not overwrite work from previous sessions without understanding it.

4. **COMMIT FORMAT:** `git add -A && git commit -m "descriptive message" && git push origin main`

5. **UPDATE LAST_SESSION.md** at the end of every session with: what was changed, what files were touched, what's still broken, what's next. **LAST_SESSION.md is append-only.** Never delete old entries. Append `## HH:MM UTC — Description` for each build. Date headers separate days.

6. **APPEND TO CHANGELOG.md** at the end of every session with: date, summary, files touched.

---

## DATABASE RULES

7. **Part lookup MUST use Auto + AIC JOIN** (`autoId`, `itemId` — lowercase). NEVER use ILIKE on `Item.title` for part matching. The Auto+AIC path is the only correct way to match parts to vehicles.

8. **`Item.price` is FROZEN.** 21K items with stale prices. NEVER use `Item.price` as a display price or scoring input. It is a last-resort fallback only in `priceResolver.js`.

9. **`market_demand_cache` is the pricing source of truth.** Price resolution priority: `market_demand_cache` → `PriceCheck` → `Item.price` (last resort only, with `estimate` source tag).

10. **`priceResolver.js` is the single price resolution point.** All scoring and display prices flow through it. Do not invent alternate price lookups.

11. **Cherokee ≠ Grand Cherokee.** Transit ≠ Transit Connect. Use word-boundary matching (`\b`), not substring matching.

12. **PN-specific parts (ECM/BCM/TIPM) require exact year range matching.** Generational parts allow ±1 year tolerance. 

13. **Engine filter must always include N/A/null records** alongside engine-specific matches. Many yard vehicles and items have no engine data.

14. **Both apps share one database.** DarkHawk (`parthawk-production.up.railway.app`) and the original app (`dynatrack.up.railway.app`) read/write the same Postgres on `switchyard.proxy.rlwy.net:12023`. Never touch the original app's deployment.

---

## SCORING RULES

15. **Attack list vehicle colors:** green = $800+, yellow = $500-799, orange = $250-499, red = <$250.

16. **Part badges:** GREAT = $250+, GOOD = $150-249, FAIR = $100-149, POOR = <$100.

17. **Price freshness:** ✅ within 60d, ⚠️ 60-90d, ❌ over 90d.

18. **Price source display:** `sold` and `market` sources display normally. `estimate` source displays as grey `~$XXX EST`.

19. **Excluded from attack list:** engines, transmissions, internal engine components, body panels, airbags/SRS modules. Steering IS sellable (racks, EPS modules, steering wheels). Sunroof glass IS sellable. Clock springs ARE sellable — do not exclude. Do not exclude these.

20. **Pro-rebuild parts shown as grey reference only, never scored — EXCEPT ECM/ECU/PCM which display as normal scored parts on the attack list.**

21. **Restock scoring:** Your demand max 35pts, Market demand max 35pts, Ratio max 15pts, Price max 25pts. $300+ parts with any market signal get floor score 75.

21b. **Vehicle rarity scoring:** Generation-aware `vehicle_frequency` table (gen_start/gen_end from trim_tier_reference). Frequency tiers by avg_days_between: LEGENDARY (180+d or 1 sighting) +30%, RARE (90+d) +20%, UNCOMMON (45+d) +10%, NORMAL (15+d) 0%, COMMON (7+d) -5%, SATURATED (<7d) -15%. Trim-driven FLOOR overrides: PERFORMANCE trim → LEGENDARY, PREMIUM trim → RARE, 4WD+MT → RARE, DIESEL → RARE. Overrides only raise, never lower. Score uncapped. Cron at 6:30 AM UTC.

21c. **Part novelty scoring:** NOVEL (zero stock AND zero sales) +20% scoring boost. RESTOCK (sold before, zero stock) +10%. STOCKED: no boost. Boosts apply to scoring value only, not display price.

21d. **Attack list sort order:** Vehicles sorted by est_value DESC (total yield with all multipliers), max_part_value DESC tiebreaker. Parts within vehicles sorted by price DESC, novelty tier tiebreaker.

---

## TRIM SYSTEM RULES

22. **Four tiers:** BASE (grey) / CHECK (yellow) / PREMIUM (green) / PERFORMANCE (blue).

23. **Independent badges (fire alongside any tier):** CULT (magenta), DIESEL (blue), 4WD (green), MANUAL (cyan), CHECK MT (faded cyan).

24. **Fallback is CONSERVATIVE** — lowest tier when unknown. Never optimistic (caused false PERFORMANCE tags).

25. **BMW model numbers normalize to series** (328I → 3 Series), original preserved as trim. Mercedes model numbers normalize to class (C300 → C-Class).

26. **LKQ body code stripper regex runs ONLY on Stellantis makes** (tighter pattern to avoid eating G35, G6, Q7, X5).

27. **CHECK_MT:** 22 models where manual genuinely shows up in junkyards: Corvette, Camaro, Mustang, Challenger, WRX, BRZ, FR-S, 350Z, 370Z, MX-5/Miata, Genesis Coupe, Veloster, GTI, GTO, Solstice, Sky, Lancer, FJ Cruiser, Tacoma, Frontier, Ranger, Wrangler. Performance trim override: if decoded_trim matches ST/Si/Type R/SRT/SS/RS/Nismo/TRD/Sport/GT, upgrade to CHECK_MT regardless of model. All other "both offered" models default to Automatic.

28. **Trim value validation verdicts:** CONFIRMED (green), WORTH_IT (yellow), MARGINAL (grey), NO_PREMIUM (red), UNVALIDATED (dim). Non-sellable suggestions (NO_PREMIUM with negative delta) are filtered out entirely.

---

## SCRAPING RULES

29. **Market data scraping priority:** Part number search first. Parts with OEM PN always searched by PN. Parts WITHOUT PN searched by keyword (smart-query-builder: part type + make + model + year) with relevance-scorer filter — minimum 3 relevant results required or data is discarded. Make AND model must both be present for keyword search. Parts under $100 and excluded parts (engines, transmissions, body panels, airbags) are skipped entirely.

30. **LKQ scraper runs locally only** (CloudFlare blocks Railway). Run via `run-scrape.bat`, Windows Task Scheduler 5am daily.

31. **Playwright browser singleton pattern** prevents Railway OOM. Never share browser instance with PriceCheckService.

32. **Competitor scraping uses Playwright intentionally** — no eBay API exists for competitor sold data. Rate limit to avoid blocks.

---

## UI RULES

33. **Background is black.** Do not change it.

34. **Listing tool output: no em dashes** (AI-generated red flag to buyers).

35. **Score badge uses 0-100 numeric format.**

36. **Badge order on vehicle cards:** YMM · engine · [TRIM] [CULT] [4WD/AWD] [MANUAL/CVT] · age.

37. **Drivetrain display:** 4WD/AWD = yellow badge, FWD = grey, RWD = hidden. **Transmission:** MANUAL = cyan, CVT = grey, AUTO = hidden.

---

## CRON SCHEDULE (UTC)

- YourDataManager.syncAll: 4x/day (1am, 7am, 1pm, 7pm)
- PriceCheckCronRunner: Sunday 2am
- StaleInventoryService: Wednesday 3am
- DeadInventoryService: Monday 4am
- RestockService: Tuesday 4am
- CompetitorMonitor: Thursday 4am
- CompetitorDripRunner: 4x/day (5am, noon, 6pm, midnight — random 0-45min jitter)
- FlywayScrapeRunner: daily 6am
- VinDecodeService: daily 3am + 8:40am (post-scrape VIN decode + trim tier)
- ScoutAlerts: on startup
- DISABLED: CronWorkRunner, MarketDemandCronRunner (Finding API dead)

---

## BLOCKED COMPS RULE

33. **blocked_comps has two block types:** (1) COMP — keyed on source_item_id (Item.id UUID). Filters chips with priceSource='item_reference'. Whack-a-mole by design — each block is a precision strike on one Item row. (2) SOLD — keyed on (part_type, year, make, model) UPPERCASE. Filters chips with priceSource='sold'. Year-exact, make/model-exact — no fuzzy matching. Both filters apply to AttackListService AND FlywayService (via shared scoreVehicle). Use `BlockedCompsService.getBlockedSet()` → `{ compIds, soldKeys }`. No exceptions.

34. **Item table columns:** `id` (UUID primary key) and `ebayId` (eBay item number). The codebase uses `itemId` as an alias for `Item.id` in JOINs (e.g. `Item.id as itemId`). When querying Item directly, use `id`. When working with already-built part objects, use `itemId`.

---

35. **BlockedCompsService.getBlockedSet() must log errors, not silently swallow.** The catch block returns empty sets on failure — this hid a broken migration for an entire day. Any future changes to getBlockedSet must log the exception before returning the fallback.

36. **ON CONFLICT with partial unique indexes: always use database.raw() for the entire INSERT.** Knex's `.onConflict(raw(...)).ignore()` builder puts the WHERE clause inside the conflict target parens, which is invalid Postgres SQL. Use raw `INSERT INTO ... ON CONFLICT (col) WHERE condition DO NOTHING` instead.

37. **scoreVehicle() is SYNCHRONOUS. Do NOT add await inside it.** The sold filter loads soldKeys from its async callers (getAttackList, getAllYardsAttackList, scoreManualVehicles) and passes it as a parameter. Any inline `await` crashes Node at parse time with SyntaxError. This caused 6 hours of silent boot failures on 2026-04-07.

38. **All vehicle age/recency/freshness math reads date_added via service/utils/dateHelpers.js.** createdAt is forensic-only and never appears in display, filter, sort, or scoring paths. All TZ math runs in America/New_York server-side. Frontend never parses dates — server ships pre-computed `daysSinceSet` (int) and `setDateLabel` (string). (2026-04-08 doctrine)

39. **Hybrid, PHEV, and Electric are distinct powertrain classifications with distinct scoring boosts** (+15/+20/+25, stacking multiplicatively with other attribute boosts). Mild 48V hybrids (eTorque, EQ Boost) are classified as Gas because mechanical parts share with pure-gas variants. Badge render order on vehicle cards is strict score-priority sorted — leftmost badge = largest score contributor. Order: ELECTRIC→PHEV→PERFORMANCE→HYBRID→DIESEL→4WD+MT→PREMIUM→MANUAL→4WD→CHECK_MT→CVT→TRIM.

40. **VAG (VW/Audi/Skoda/Seat/Porsche) part numbers matching `^[0-9][A-Z][0-9][0-9]{6}[A-Z]{0,3}$` must NEVER have their trailing letter suffix stripped.** Those letters are variant identity (different hydraulic units, different programming), not revision codes. Guard lives at the top of both `stripRevisionSuffix()` in partIntelligence.js and `normalizePartNumber()` in partMatcher.js.

41. **Short model-name VIN matches (BMW i3/i4/iX, Tesla Model 3/Y/S/X, any ≤3-char model token) require exact word-boundary match — never substring match.** Prevents I30→i3, Matrix→ix, Grand Prix→i-series false positives. Enforced in `classifyPowertrain()` in LocalVinDecoder.js.

---

## EBAY WRITE POLICY

42. **No automated or exposed writes to eBay listings.** DarkHawk is a pulling optimization and intel tool. The listing tool draws from its data. Active inventory management (price revisions, ending, relisting) happens OUTSIDE this app. The following are permanently disabled as of 2026-04-08 by owner directive:
- POST /stale-inventory/revise-price (returns 410 Gone)
- POST /stale-inventory/end-item (returns 410 Gone)
- POST /stale-inventory/relist-item (returns 410 Gone)
- POST /stale-inventory/bulk-end (returns 410 Gone)
- POST /stale-inventory/run (returns 410 Gone)
- StaleInventoryService Wed 3am cron (commented out in index.js)
Any future feature that needs to write to eBay listings requires explicit owner approval and re-authorization of this rule. Carcass page (/admin/carcass) remains as read-only diagnostic.

---

## KNOWN TECH DEBT (do not make worse)

- Unauthenticated write endpoints (end-item/relist/revise/bulk-end)
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitor reads frozen SoldItem (degraded until Sunday scrape)
- LifecycleService loads all YourSale into memory (fine at 22K, watch at 50K+)
- TradingAPI.js write methods (reviseItem, endItem, relistItem) and StaleInventoryService.js inline ReviseItem call are dead code with no callers. Rediscovery risk. Delete or hard-throw when convenient. See LAST_SESSION.md 2026-04-08 entry for cleanup options.
