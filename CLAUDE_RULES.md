# CLAUDE_RULES.md — READ THIS FIRST EVERY SESSION

These are non-negotiable constraints for DarkHawk development. Violating any of these has caused real bugs in production. Read all of them before touching any file.

---

## WORKFLOW RULES

1. **DIAGNOSE BEFORE TOUCHING.** Read the actual deployed code before making changes. Run read-only diagnostics before any writes. No assumptions about what a file contains.

2. **ONE DELIVERABLE PER SESSION.** Fix one thing, test it, commit it. Do not touch files unrelated to the current task.

3. **READ LAST_SESSION.md AND CHANGELOG.md FIRST.** These tell you what the previous session did. Do not overwrite work from previous sessions without understanding it.

4. **COMMIT FORMAT:** `git add -A && git commit -m "descriptive message" && git push origin main`

5. **UPDATE LAST_SESSION.md** at the end of every session with: what was changed, what files were touched, what's still broken, what's next.

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

19. **Engines and transmissions are excluded** from attack list parts via `isExcludedPart()`. Also exclude transfer cases and steering.

20. **Pro-rebuild parts shown as grey reference only,** never scored.

21. **Restock scoring:** Your demand max 35pts, Market demand max 35pts, Ratio max 15pts, Price max 25pts. $300+ parts with any market signal get floor score 75.

---

## TRIM SYSTEM RULES

22. **Four tiers:** BASE (grey) / CHECK (yellow) / PREMIUM (green) / PERFORMANCE (blue).

23. **Independent badges (fire alongside any tier):** CULT (magenta), DIESEL (blue), 4WD (green), MANUAL (cyan), CHECK MT (faded cyan).

24. **Fallback is CONSERVATIVE** — lowest tier when unknown. Never optimistic (caused false PERFORMANCE tags).

25. **BMW model numbers normalize to series** (328I → 3 Series), original preserved as trim. Mercedes model numbers normalize to class (C300 → C-Class).

26. **LKQ body code stripper regex runs ONLY on Stellantis makes** (tighter pattern to avoid eating G35, G6, Q7, X5).

27. **CHECK_MT:** ambiguous-era base trucks where manual was common but not certain. Silverado excluded. Tacoma CHECK_MT limited to V6 trims only.

28. **Trim value validation verdicts:** CONFIRMED (green), WORTH_IT (yellow), MARGINAL (grey), NO_PREMIUM (red), UNVALIDATED (dim). Non-sellable suggestions (NO_PREMIUM with negative delta) are filtered out entirely.

---

## SCRAPING RULES

29. **All market data scraping: search by part number only.** No keyword fallback, no title matching. Parts without OEM part number are skipped entirely.

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
- ScoutAlerts: on startup
- DISABLED: CronWorkRunner, MarketDemandCronRunner (Finding API dead)

---

## KNOWN TECH DEBT (do not make worse)

- Unauthenticated write endpoints (end-item/relist/revise/bulk-end)
- StaleInventoryService has inline ReviseItem separate from TradingAPI.reviseItem()
- CompetitorMonitor reads frozen SoldItem (degraded until Sunday scrape)
- LifecycleService loads all YourSale into memory (fine at 22K, watch at 50K+)
