Generated 2026-04-04

# PartHawk Services & Managers Snapshot

## Core Services

### PostScrapeService.js
**Purpose:** Universal post-scrape enrichment pipeline — runs after any yard scraper completes.
**Key methods:**
- `async enrichYard(yardId)` — orchestrates decode + trim tier + scout alerts for a yard
- `async decodeBatch(vins)` — batch VIN decode via LocalVinDecoder (offline, not NHTSA)
- `async lookupTrimTier(year, make, model, trimName, engineDisplacement, transmission, drivetrain)`
**Requires:** logger, database, TrimTierService, trim-tier-config, LocalVinDecoder
**Clean Pipe:** `decodeBatch` calls `decodeBatchLocal` from `../lib/LocalVinDecoder` — no external NHTSA calls.

### AttackListService.js
**Purpose:** Scores yard vehicles against inventory/sales data to prioritize what to pull.
**Key methods:**
- `async getAttackList(yardId, options)` — main entry, returns scored vehicle list
- `async buildInventoryIndex()` — indexes your_listing by make/model/PN
- `async buildSalesIndex(cutoff)` — indexes sold_item with Clean Pipe columns first
- `async buildStockIndex()` — indexes your_listing using partNumberBase + extractedMake/Model
- `async buildPlatformIndex()` — platform compatibility cross-reference
- `async scoreManualVehicles(vehicles, options)` — score ad-hoc vehicle list
- `async getAllYardsAttackList(options)` — attack list across all active yards
- `async loadValidationCache()` — caches validation data
**Requires:** logger, database, platformMatch, partIntelligence, trim-tier-config, TrimTierService, priceResolver
**Clean Pipe:** `buildStockIndex` and `buildSalesIndex` read `partNumberBase`, `extractedMake`, `extractedModel` columns first, fall back to title parsing. PN_EXACT_YEAR_TYPES enforces exact year for ECM/PCM/BCM/TIPM etc.

### CacheService.js
**Purpose:** Full claim lifecycle for parts — from claim through resolution to history.
**Key methods:**
- `async claim({ partType, partDescription, partNumber, vehicle, yard, ... })` — sources: daily_feed, scout_alert, hawk_eye, flyway, manual
- `async returnToAlerts(cacheId, reason)` — unclaim and return to alert pool
- `async deleteClaim(cacheId)` — hard delete
- `async manualResolve(cacheId, ebayItemId)` — link claim to eBay listing
- `async resolveFromListings()` — batch auto-resolve claims against your_listing
- `async getActiveClaims({ source, claimedBy, sortBy })` / `async getHistory({ days, limit })`
- `async getStats()` — counts by status/source
- `async checkCacheStock({ partNumber, make, model, year, partType })` — duplicate check
**Requires:** logger, database, uuid, partNumberUtils

### VinDecodeService.js
**Purpose:** VIN decoding with caching — delegates to LocalVinDecoder (offline corgi + VDS).
**Key methods:**
- `async decode(vin)` — returns {year, make, model, trim, engine, engineType, drivetrain, bodyStyle}
- `async decodeAllUndecoded()` — batch decode un-decoded VINs in DB
**Requires:** logger, database, LocalVinDecoder
**Clean Pipe:** No NHTSA dependency. axios removed. All decoding offline via LocalVinDecoder.

### AutolumenImportService.js
**Purpose:** CSV import for Autolumen eBay store — active listings, sales history, transactions.
**Key methods:**
- `async importActiveListings(csvText)` — parse CSV, extract structured fields, upsert
- `async importSalesHistory(csvText)` — import sold items
- `async importTransactions(csvText)` — import payment transactions
- `async getStats()` — counts for autolumen store
**Requires:** logger, database, csv-parse/sync, partIntelligence.extractStructuredFields
**Clean Pipe:** Uses `extractStructuredFields` on titles to populate partNumberBase, partType, extractedMake, extractedModel.

### ItemLookupService.js
**Purpose:** CRUD for inventory items with eBay compatibility.
**Key methods:**
- `async getItemsForAuto({ year, make, model, trim, engine })` / `async getAutosForItem({ partNumber })`
- `async createItem({ body })` / `async update({ body })` / `async deleteItemById({ id })`
- `async searchItems({ constraints })` / `async getFilter({ field })`
**Requires:** logger, objection, Auto, Item, uuid, AutoService, CacheManager, partNumberUtils

### AutoService.js
**Purpose:** Vehicle (Auto) CRUD and eBay taxonomy compatibility lookups.
**Key methods:**
- `async getDistinctList({ constraints })` / `async getCompatibilityTaxonomy({ constraints })`
- `async createAuto({ body })` / `async updateAuto({ id, body })` / `async getOrCreateAutos({ autos })`
**Requires:** logger, Joi, lodash, TaxonomyAPI, Auto model, CacheManager, EbayQueryCacheManager

## Intelligence Services

### PhoenixService.js
**Purpose:** SoldItem matching — finds rebuild/relist opportunities from competitor sold data.
**Key methods:**
- `async getRebuildSellers()` / `async addRebuildSeller(name)` / `async removeRebuildSeller(name)`
- `async getPhoenixStats({ days, seller })` — summary stats
- `async getPhoenixList({ days, limit, seller })` — scored relist candidates
**Requires:** database
**Clean Pipe:** Groups by `partNumberBase`. Fast path: direct `partNumberBase` column lookup on sold_item. Slow path: title scan fallback for records without it.

### ListingIntelligenceService.js
**Purpose:** Aggregates intelligence for a single listing — programming, trim tier, fitment, sales.
**Key methods:**
- `async getIntelligence({ partNumber, year, make, model, engine, trim, partType })`
- `async lookupProgramming(make, year, partType, trim)` / `async lookupTrimTier(...)`
- `async lookupFitmentCache(pnBase, pnExact)` / `async lookupSalesHistory(pnBase, pnExact)`
**Requires:** database, partNumberUtils, TrimTierService

### FitmentIntelligenceService.js
**Purpose:** Deduces fitment negations — what is in taxonomy but NOT in compatibility = does not fit.
**Key methods:**
- `async fetchItemCompatibility(ebayItemId)` / `async fetchTaxonomy(make, model, year)`
- `async buildFitmentProfile(compatEntries, make, model, yearStart, yearEnd)`
- `async lookupFitment({ partType, make, model, year, partNumber })` / `async storeFitmentProfile(data)`
**Requires:** database, TradingAPI, TaxonomyAPI, xml2js

### CompetitorMonitorService.js
**Purpose:** Advisory alerts when competitors undercut, drop out, or we are underpriced.
**Key methods:**
- `async scan()` / `async createAlert(...)` / `async getAlerts({ limit, dismissed })` / `async dismiss(id)`
**Requires:** logger, database, partNumberUtils

### DemandAnalysisService.js
**Purpose:** Market demand analytics — sell-through rates, velocity, stale detection.
**Key methods:**
- `async calculateSellThroughRate(daysBack)` / `async analyzeSalesVelocity(daysBack)`
- `async findStaleInventory(daysThreshold, limit)` / `async getTopPerformers(limit, daysBack)`
- `async analyzeCompetition(keywords)` / `async getMarketHealthDashboard()`
**Requires:** logger, SoldItem, CompetitorListing, YourSale, YourListing

### PricePredictionService.js
**Purpose:** ML-based pricing from historical sales, competitors, and market data.
**Key methods:**
- `async predictOptimalPrice(listingId)` / `async batchPredictPrices(limit)`
- `async findUnderpricedItems(limit)` / `async findOverpricedItems(limit)`
- `async analyzePriceVelocity(keywords)`
**Requires:** logger, SoldItem, CompetitorListing, YourSale, YourListing

### TrimIntelligenceService.js
**Purpose:** One-time Claude API + web_search to research premium parts for a trim package.
**Key methods:** `async getTrimIntelligence({ year, make, model, trim })` / `async researchTrim(...)`
**Requires:** logger, database

### ReturnIntelligenceService.js
**Purpose:** Return analytics — rates by part type, problem parts, repeat returners, INAD stats.
**Key methods:**
- `async getSummary()` / `async getReturnRateByPartType({ months })`
- `async getProblemParts(...)` / `async getRepeatReturners(...)` / `async getReturnsByMake(...)`
- `async getMonthlyTrend({ months })` / `async getINADStats({ months })`
**Requires:** logger, database

### OpportunityService.js
**Purpose:** Surfaces parts with strong market demand we have NEVER sold. Max score 100.
**Requires:** database (reads market_demand_cache, YourListing, YourSale)

### LearningsService.js
**Purpose:** Aggregates patterns from dead inventory, returns, and stale outcomes.
**Key methods:** `async getLearnings()` / `async getDeadPatterns()` / `async getReturnPatterns()` / `async getStaleOutcomes()`

### LifecycleService.js
**Purpose:** Part lifecycle metrics — time-to-sell, seasonal patterns.
**Key methods:** `async getLifecycleMetrics({ daysBack })` / `async getSeasonalPatterns({ yearsBack })`

## Managers

### YourDataManager.js
**Purpose:** Syncs YOUR eBay seller data (orders + listings) to database.
**Key methods:**
- `async syncAll({ daysBack })` / `async syncOrders({ daysBack })` / `async syncListings()` / `async getStats()`
**Requires:** logger, SellerAPI, YourSale, YourListing, partIntelligence.extractStructuredFields
**Note:** syncListings uses Clean Pipe structured fields. Triggers OverstockCheckService + CacheService.resolveFromListings after sync.

### MarketResearchManager.js
**Purpose:** Orchestrates market research — scrapes competitors and sold items, calculates price snapshots.
**Key methods:**
- `async researchAllInventory(...)` / `async researchSingleItem(...)` / `async researchByKeywords(...)`
- `async storeActiveListings(...)` / `async storeSoldItems(...)` / `async calculatePriceSnapshot(...)`
**Requires:** MarketResearchScraper, MarketResearchRun, CompetitorListing, SoldItem, YourListing, PriceSnapshot

### SoldItemsManager.js
**Purpose:** Scrapes competitor sold items via Playwright. Uses extractStructuredFields on store.
**Key methods:**
- `async scrapeAllCompetitors(...)` / `async scrapeCompetitor({ seller, ... })`
- `async enrichWithCompatibility(ebayItemId)` / `async scrapeByKeywords({ keywords, ... })`
**Requires:** SoldItemsScraper, TradingAPI, SoldItemSeller, SoldItem, partIntelligence

### ItemDetailsManager.js
**Purpose:** Fetches eBay item details — compatibility tables, specifics, duplicate detection.
**Key methods:**
- `async getDetailsForItem({ itemId })` / `async checkForDuplicate(item)` / `async processItems()`
- `async getItemCompatibility(...)` / `async getItemSpecifics(...)`
**Requires:** TradingAPI, Auto, Item, uuid, lodash

### SellerItemManager.js
**Purpose:** Fetches competitor seller listings from eBay via FindingsAPI/BrowseAPI.
**Key methods:** `async getItemsForSellers(sellers)` / `async getItemsForSeller({ seller })` / `async processResponse(...)`
**Requires:** FindingsAPI, BrowseAPI, Item

### UserManager.js
**Purpose:** Firebase user CRUD — get/create/modify/delete.
**Key methods:** `async getOrCreateUser(...)` / `async getUser(...)` / `async getAllUsers()` / `async modifyUser(...)` / `async deleteUser(...)`
**Requires:** User model, CacheManager

### CompetitorManager.js
**Purpose:** Returns all enabled competitor sellers. Single method wrapper.
**Key methods:** `async getAllCompetitors()`

## Utility Services

### PriceCheckService.js (V1)
**Purpose:** Playwright-based eBay sold comp scraper. Persistent browser with stealth plugin.
**Key methods:** `async checkPrice(listingId, title, currentPrice, forceRefresh)` / `async runPipeline(title, yourPrice)` / `async scrapeSoldItems(searchQuery)`
**Requires:** playwright-extra, stealth, smart-query-builder, relevance-scorer, PriceCheck model, database

### PriceCheckServiceV2.js
**Purpose:** Lightweight eBay sold comp scraper — axios+cheerio, no Chromium. Same pipeline as V1.
**Requires:** axios, cheerio, smart-query-builder, relevance-scorer

### MarketPricingService.js
**Purpose:** Batch market pricing for daily feed — dedupes by PN, checks cache, scrapes uncached.
**Requires:** logger, database, partIntelligence. Primary: V2; fallback: V1.

### PricingService.js
**Purpose:** Optimal price suggestions from market, competitor, and historical data.
**Key methods:** `async getRecommendations({ ebayItemId, all, daysBack })` / `async getMarketPriceData(...)` / `async getCompetitorPrices()` / `async getYourHistoricalPrices(...)`

### COGSService.js
**Purpose:** True COGS = parts cost + gate fee. No tax, no mileage. Color-coded spend tracking.
**Key methods:** `static async getYardProfile(yardId)` / `static async calculateGateMax(yardId, plannedParts)` / `static async calculateSession(session)`

### FlywayService.js
**Purpose:** Multi-yard trip planning — CRUD trips, attach yards, generate trip-specific attack lists.
**Key methods:**
- `static async getTrips(status)` / `static async createTrip(...)` / `static async updateTrip(...)` / `static async deleteTrip(id)`
- `static async getFlywayAttackList(tripId)` / `static async getActiveScrapableYards()`
- `static async cleanupExpiredTripVehicles()` / `static async autoCompleteExpiredTrips()`
**Requires:** database, AttackListService

### TrimTierService.js
**Purpose:** Trim tier lookup — maps trim names to BASE/CHECK/PREMIUM/PERFORMANCE (tiers 1-4).
**Key methods:** `async lookup(year, make, model, trimName, engineDisplacement, transmission, drivetrain)`
**Note:** Handles make aliases (Dodge/Ram, Chevy/Chevrolet, Mercedes variants).

### PartNumberService.js
**Purpose:** Part number normalization — strips revision suffixes (AA/AB/AC map to same base).
**Key methods:** `static normalize(pn)` / `static areEquivalent(pn1, pn2)` / `static getSuffix(pn)` / `static groupByBase(pns)` / `static deduplicateKey(pn, vehicleApp)`
**Note:** Pure utility, no dependencies.

### ScoutAlertService.js
**Purpose:** Generates scout alerts from yard inventory matched against sales/inventory data.
**Key methods:** `async generateAlerts()` — concurrency-guarded, one-at-a-time.
**Alert sources:** Hunters Perch (want list), Bone Pile (recent sales), The Mark (priority marks).
**Requires:** database, logger, partMatcher, partIntelligence

### PartLocationService.js
**Purpose:** Where to find a part on a vehicle — research-backed location tips for pullers.
**Key methods:** `async getLocation(...)` / `async findRecord(...)` / `async researchLocation(...)` / `async confirmLocation(id, ...)` / `async flagWrong(id)`

### EbayMessagingService.js
**Purpose:** Queue-based post-purchase eBay buyer messaging with templates and retry logic.
**Key methods:** `async queuePostPurchase(order, ebayStore)` / `async processQueue()` / `async pollNewOrders()` / `async getQueueStatus()` / `async getTemplates()`
**Requires:** logger, database, SellerAPI

### StaleInventoryService.js
**Purpose:** Automated price reductions via TradingAPI. Standard: 60d=-10% through 270d=-30%. Programmed listings use slower schedule.
**Key methods:** `async runAutomation()` / `async checkCompsExist(listing)` / `async revisePrice(ebayItemId, newPrice)`
**Note:** No comps = hold and flag, do not reduce.

### DeadInventoryService.js
**Purpose:** Identifies dead inventory with market demand cross-reference.
**Key methods:** `async getDeadInventory(...)` / `async getMarketDemandData()` / `async getCompetitorData()` / `async scanAndLog()` / `async getWarning(pn)`

### RestockService.js
**Purpose:** Flags parts needing restock — sold >= 2x active stock in 90 days.
**Key methods:** `async scanAndFlag()` / `async getFlags({ acknowledged, limit })` / `async acknowledge(id)`

### ReturnIntakeService.js
**Purpose:** Auto-relist returned parts by grade (A=full, B=discount, C=review/scrap).
**Key methods:** `async intakeReturn(...)` / `async getPendingRelists()` / `async markRelisted(id, newEbayItemId)` / `async markScrapped(id)`

### OverstockCheckService.js
**Purpose:** Monitors overstock groups and flags when stock exceeds thresholds.
**Key methods:** `async checkAll()`

### WhatToPullService.js
**Purpose:** Recommends parts to pull based on demand, history, and competition.
**Key methods:** `async getRecommendations(...)` / `async getMarketDemand(...)` / `async getYourSalesHistory(...)` / `async getCompetitionData(...)`

### InstantResearchService.js
**Purpose:** On-demand vehicle research — scrapes eBay sold for a YMM to discover sellable parts.
**Key methods:** `async researchVehicle({ year, make, model, engine, drivetrain, refresh })`

### ApifyResearchService.js
**Purpose:** Vehicle research via PriceCheckServiceV2 (primary) or Apify actor (optional).
**Key methods:** `async researchVehicle(vehicle, options)` / `async _scrapeViaPriceCheck(...)` / `async _scrapeViaApify(...)` / `async _enrichMarketCache(parts)` / `async _saveToSkyWatch(...)`
