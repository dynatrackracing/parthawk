# Dynatrack Sales Intelligence & Dashboard Rewrite

## Implementation Status

**Phase 1: Backend Foundation - COMPLETE**
- [x] Database migrations (your_sale, your_listing, sold_item)
- [x] Objection.js models (YourSale, YourListing, SoldItem)
- [x] SellerAPI.js (GetOrders, GetMyeBaySelling)
- [x] YourDataManager.js (sync orchestration)
- [x] SoldItemsScraper.js (Puppeteer-based)
- [x] SoldItemsManager.js (scrape orchestration)
- [x] Sync routes (/sync/*)
- [x] Lazy-loading firebase auth fix

**Phase 2: Business Intelligence Services - COMPLETE**
- [x] WhatToPullService.js
- [x] PricingService.js
- [x] DeadInventoryService.js
- [x] OpportunityService.js
- [x] Intelligence routes (/intelligence/*)

**Phase 3: Frontend Rewrite - PENDING**
- [ ] Modern React dashboard
- [ ] Component library setup
- [ ] Integration testing

**Phase 4: Machine Learning Enhancement - FUTURE**
- [ ] Price Predictor model (regression)
- [ ] Days-to-Sell Predictor model
- [ ] Trend detection for demand forecasting
- [ ] Part similarity clustering via embeddings

### ML Implementation Notes

**Training Data Sources:**
- Your 3-4 years of sales history (from eBay GetOrders API)
- Competitor sold items (from scraper)
- Market pricing data

**Priority Models:**

1. **Price Predictor** - Predict optimal selling price
   - Features: category, compatibility (year/make/model), condition, competitor prices
   - Training: Your historical sales + market sold items
   - Model: Start with linear regression, upgrade to gradient boosting (XGBoost)

2. **Days-to-Sell Predictor** - Predict time to sale at given price
   - Features: part type, price delta vs market, competition level, seasonality
   - Training: Your historical sales with listing duration
   - Business value: Optimize for turnover vs margin

**Implementation Path:**
- Option A: TensorFlow.js (keep in Node.js codebase)
- Option B: Python microservice with scikit-learn/XGBoost (more powerful)
- Option C: External ML service (AWS SageMaker, etc.)

**Data Requirements:**
- Sync full historical data first (3-4 years)
- Build sufficient scraped sold items dataset
- Then train models on combined data

---

## Overview

Transform dynatrack from a competitor tracking tool into a full business intelligence platform for a used car parts eBay business. Combines three data sources (your sales, competitor listings, market-wide sold items) to drive four key business decisions.

## Data Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DYNATRACK (unified)                         │
├─────────────────────────────────────────────────────────────────────┤
│  EXISTING:                                                          │
│  ├── Competitor listings (BrowseAPI) → item table                   │
│  ├── Item compatibility (TradingAPI) → auto_item_compatibility      │
│  └── Vehicle taxonomy (TaxonomyAPI)                                 │
│                                                                     │
│  NEW - YOUR DATA (from eBay Trading API):                           │
│  ├── Your orders/sales (GetOrders) → your_sale table                │
│  └── Your active listings (GetMyeBaySelling) → your_listing table   │
│                                                                     │
│  NEW - MARKET DATA (scraper):                                       │
│  └── Market sold items (scrape eBay) → sold_item table              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Backend Foundation

### 1.1 Database Migrations

**New Tables:**

```sql
-- Your sales history from eBay
CREATE TABLE your_sale (
  id UUID PRIMARY KEY,
  ebay_order_id VARCHAR(255) UNIQUE NOT NULL,
  ebay_item_id VARCHAR(255),
  title TEXT,
  sku VARCHAR(255),
  quantity INTEGER,
  sale_price DECIMAL(10,2),
  sold_date TIMESTAMP,
  buyer_username VARCHAR(255),
  shipped_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Your current eBay listings
CREATE TABLE your_listing (
  id UUID PRIMARY KEY,
  ebay_item_id VARCHAR(255) UNIQUE NOT NULL,
  title TEXT,
  sku VARCHAR(255),
  quantity_available INTEGER,
  current_price DECIMAL(10,2),
  listing_status VARCHAR(50),
  start_time TIMESTAMP,
  days_listed INTEGER GENERATED ALWAYS AS (EXTRACT(DAY FROM NOW() - start_time)) STORED,
  view_item_url TEXT,
  synced_at TIMESTAMP DEFAULT NOW()
);

-- Market-wide sold items (scraped)
CREATE TABLE sold_item (
  id UUID PRIMARY KEY,
  ebay_item_id VARCHAR(255) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  sold_price DECIMAL(10,2) NOT NULL,
  sold_date TIMESTAMP NOT NULL,
  category_id VARCHAR(50),
  category_title TEXT,
  seller VARCHAR(255),
  condition VARCHAR(50),
  picture_url TEXT,
  compatibility JSONB,  -- [{year, make, model, trim, engine}, ...]
  manufacturer_part_number VARCHAR(255),
  interchange_numbers TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_your_sale_sold_date ON your_sale(sold_date);
CREATE INDEX idx_your_sale_item_id ON your_sale(ebay_item_id);
CREATE INDEX idx_your_listing_item_id ON your_listing(ebay_item_id);
CREATE INDEX idx_your_listing_days ON your_listing(days_listed);
CREATE INDEX idx_sold_item_category ON sold_item(category_id);
CREATE INDEX idx_sold_item_seller ON sold_item(seller);
CREATE INDEX idx_sold_item_sold_date ON sold_item(sold_date);
CREATE INDEX idx_sold_item_compatibility ON sold_item USING GIN(compatibility);
```

### 1.2 Your Data Integration (from eBay Trading API)

**Files to create:**
- `service/ebay/SellerAPI.js` - GetOrders and GetMyeBaySelling calls
- `service/models/YourSale.js` - Objection.js model
- `service/models/YourListing.js` - Objection.js model
- `service/managers/YourDataManager.js` - Sync logic

**Reference:** Copy patterns from `~/dev/warehouse-wms/apps/api/src/services/ebay/tradingApi.ts`

**API Calls:**
1. `GetOrders` - Fetch your sales history (configurable days back, default 365 for initial load)
2. `GetMyeBaySelling` - Fetch your current active listings

### 1.3 Market Data Scraper

**Files to create:**
- `service/ebay/SoldItemsScraper.js` - Puppeteer-based scraper
- `service/models/SoldItem.js` - Objection.js model
- `service/managers/SoldItemsManager.js` - Scrape orchestration

**Scrape Target:**
```
https://www.ebay.com/sch/i.html?_nkw=&_sacat=35596&LH_Sold=1&LH_Complete=1&_ssn={sellerName}
```

**Scraper Features:**
- Puppeteer for dynamic content
- Rate limiting (2-3 sec random delays)
- User-Agent rotation
- Parse: title, soldPrice, soldDate, itemId, condition, seller
- Enrich with TradingAPI for compatibility data (reuse existing)

**Data Sources:**
- All enabled competitors (from Competitor table)
- Category: 35596 (ECU) initially, expandable

---

## Phase 2: Four Parallel Feature Tracks

Each track is independently buildable and testable.

### Track 1: "What to Pull" Intelligence

**Purpose:** Rank parts to prioritize when at the junkyard

**Data Inputs:**
- `sold_item` - Market demand (what's selling, velocity)
- `your_sale` - Your historical success (what you've sold well)
- `item` - Competition saturation (how many competitors listing this)

**API Endpoint:** `GET /api/intelligence/what-to-pull`

**Query Parameters:**
- `?make=Honda` - Filter by vehicle make
- `?model=Civic` - Filter by model
- `?year=2015` - Filter by year
- `?limit=50` - Number of results

**Output:**
```json
{
  "recommendations": [
    {
      "partCategory": "ECU",
      "compatibility": [{"year": 2015, "make": "Honda", "model": "Civic"}],
      "marketDemand": 47,
      "avgSoldPrice": 185.50,
      "yourHistoricalSales": 12,
      "yourAvgPrice": 175.00,
      "competitorCount": 8,
      "score": 92,
      "recommendation": "HIGH PRIORITY"
    }
  ]
}
```

**Files:**
- `service/services/WhatToPullService.js`
- `service/routes/intelligence.js`

---

### Track 2: "How to Price" Optimizer

**Purpose:** Suggest optimal prices for your current inventory

**Data Inputs:**
- `your_listing` - Your current listings
- `sold_item` - Market price range
- `item` - Competitor current prices
- `your_sale` - Your historical pricing

**API Endpoint:** `GET /api/intelligence/pricing`

**Query Parameters:**
- `?ebayItemId=123456` - Specific listing
- `?all=true` - All your listings

**Output:**
```json
{
  "pricingRecommendations": [
    {
      "ebayItemId": "123456",
      "title": "2015 Honda Civic ECU",
      "yourCurrentPrice": 150.00,
      "marketPriceRange": {"min": 125, "max": 225, "avg": 175, "median": 170},
      "competitorPrices": [145, 160, 175, 180],
      "yourHistoricalAvg": 165.00,
      "suggestedPrice": 169.99,
      "reasoning": "Priced below market median, recommend increase"
    }
  ]
}
```

**Files:**
- `service/services/PricingService.js`
- `service/routes/intelligence.js`

---

### Track 3: "Dead Inventory" Identifier

**Purpose:** Identify stale listings to discount or scrap

**Data Inputs:**
- `your_listing` - Your listings with days_listed
- `sold_item` - Market demand (is this part even selling?)
- `your_sale` - Your sell-through history

**API Endpoint:** `GET /api/intelligence/dead-inventory`

**Query Parameters:**
- `?daysThreshold=90` - Days listed threshold
- `?includeMarketData=true`

**Output:**
```json
{
  "deadInventory": [
    {
      "ebayItemId": "789012",
      "title": "Rare ECU Module",
      "daysListed": 127,
      "currentPrice": 350.00,
      "marketSalesLast90Days": 2,
      "competitorCount": 1,
      "recommendation": "DEEP DISCOUNT",
      "suggestedAction": "Reduce to $199 or scrap",
      "reasoning": "Low market demand, overpriced vs comps"
    }
  ]
}
```

**Files:**
- `service/services/DeadInventoryService.js`
- `service/routes/intelligence.js`

---

### Track 4: "Opportunity Finder"

**Purpose:** Find high-demand parts you're NOT stocking

**Data Inputs:**
- `sold_item` - Market demand by category/compatibility
- `your_listing` - What you currently have
- `your_sale` - What you've sold before
- `item` - Competition level

**API Endpoint:** `GET /api/intelligence/opportunities`

**Query Parameters:**
- `?minDemand=10` - Minimum market sales
- `?maxCompetition=5` - Maximum competitors

**Output:**
```json
{
  "opportunities": [
    {
      "partCategory": "Transmission Control Module",
      "compatibility": [{"year": 2018, "make": "Toyota", "model": "Camry"}],
      "marketSalesLast30Days": 34,
      "avgSoldPrice": 245.00,
      "competitorCount": 3,
      "youHaveInStock": false,
      "youHaveSoldBefore": true,
      "opportunityScore": 88,
      "recommendation": "Source this part - high demand, low competition"
    }
  ]
}
```

**Files:**
- `service/services/OpportunityService.js`
- `service/routes/intelligence.js`

---

## Phase 3: Frontend Rewrite

Modern React dashboard with clean, professional design.

### Tech Stack
- React 18+ with hooks
- React Router v6
- TailwindCSS for styling
- React Query (TanStack Query) for data fetching
- Recharts or Chart.js for visualizations
- React Table for data grids

### Dashboard Pages

1. **Home/Overview**
   - Key metrics cards (total inventory, sales velocity, margin trends)
   - Quick action buttons for each BI feature

2. **What to Pull**
   - Filterable table of recommended parts
   - Vehicle selector (year/make/model)
   - Score visualization

3. **Pricing Optimizer**
   - List of your inventory with price recommendations
   - Market price charts
   - Bulk price update actions

4. **Dead Inventory**
   - Sortable list by days listed
   - Action buttons (discount, relist, scrap)
   - Market demand indicators

5. **Opportunities**
   - High-demand parts you're missing
   - Competition analysis
   - Sourcing suggestions

6. **Competitor Monitor** (existing, enhanced)
   - Competitor listings with new market context

7. **Settings/Admin**
   - Competitor management
   - Sync controls
   - API status

---

## Implementation Order

### Foundation (Sequential)
1. Database migrations (all new tables)
2. SellerAPI.js + YourDataManager.js (your eBay data)
3. SoldItemsScraper.js + SoldItemsManager.js (market data)
4. Initial data load (scrape + sync)

### Features (Parallel - 4 Agents)
- **Agent 1:** What to Pull service + API + tests
- **Agent 2:** Pricing Optimizer service + API + tests
- **Agent 3:** Dead Inventory service + API + tests
- **Agent 4:** Opportunity Finder service + API + tests

### Frontend (After Backend Validated)
- Component library setup
- Dashboard layout
- Feature pages
- Integration testing

---

## Verification

### Backend
```bash
# Run migrations
npm run migrate

# Sync your eBay data
curl -X POST http://localhost:3000/api/sync/your-data

# Run scraper
curl -X POST http://localhost:3000/api/sync/sold-items

# Test each intelligence endpoint
curl http://localhost:3000/api/intelligence/what-to-pull?make=Honda
curl http://localhost:3000/api/intelligence/pricing?all=true
curl http://localhost:3000/api/intelligence/dead-inventory?daysThreshold=90
curl http://localhost:3000/api/intelligence/opportunities?minDemand=10
```

### Frontend
```bash
cd client && npm run dev
# Navigate to each dashboard page
# Verify data loads and displays correctly
```

---

## Key Files to Modify/Create

### New Files
- `service/database/migrations/XXXXXX_create_your_sale.js`
- `service/database/migrations/XXXXXX_create_your_listing.js`
- `service/database/migrations/XXXXXX_create_sold_item.js`
- `service/ebay/SellerAPI.js`
- `service/ebay/SoldItemsScraper.js`
- `service/models/YourSale.js`
- `service/models/YourListing.js`
- `service/models/SoldItem.js`
- `service/managers/YourDataManager.js`
- `service/managers/SoldItemsManager.js`
- `service/services/WhatToPullService.js`
- `service/services/PricingService.js`
- `service/services/DeadInventoryService.js`
- `service/services/OpportunityService.js`
- `service/routes/intelligence.js`
- `service/routes/sync.js`

### Modify
- `service/lib/CronWorkRunner.js` - Add sold items scraping to cron
- `service/index.js` - Register new routes
- `client/` - Full rewrite

---

## Testing Strategy

### Layer 1: Unit Tests (Jest)

Each service has isolated unit tests with mocked dependencies.

**Files:**
- `service/spec/test/services/WhatToPullService.spec.js`
- `service/spec/test/services/PricingService.spec.js`
- `service/spec/test/services/DeadInventoryService.spec.js`
- `service/spec/test/services/OpportunityService.spec.js`
- `service/spec/test/managers/YourDataManager.spec.js`
- `service/spec/test/managers/SoldItemsManager.spec.js`

**What to Mock:**
- Database queries (use in-memory SQLite or mock Objection.js)
- eBay API responses (use fixtures from `service/spec/data/`)

**Example Test (WhatToPullService):**
```javascript
describe('WhatToPullService', () => {
  it('ranks parts by composite score', async () => {
    // Mock sold_item, your_sale, item data
    const result = await service.getRecommendations({ make: 'Honda' });
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('filters by vehicle compatibility', async () => {
    const result = await service.getRecommendations({ make: 'Honda', model: 'Civic' });
    expect(result.every(r => r.compatibility.some(c => c.make === 'Honda'))).toBe(true);
  });
});
```

### Layer 2: API Integration Tests (Jest + Supertest)

Test HTTP endpoints with real database (test PostgreSQL instance).

**Files:**
- `service/spec/test/routes/intelligence.spec.js`
- `service/spec/test/routes/sync.spec.js`

**Setup:**
```javascript
beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run(); // Load test fixtures
});

afterAll(async () => {
  await knex.destroy();
});
```

**Example Test:**
```javascript
describe('GET /api/intelligence/what-to-pull', () => {
  it('returns 200 with recommendations', async () => {
    const res = await request(app)
      .get('/api/intelligence/what-to-pull?make=Honda')
      .expect(200);

    expect(res.body.recommendations).toBeInstanceOf(Array);
    expect(res.body.recommendations[0]).toHaveProperty('score');
  });
});
```

### Layer 3: eBay API Integration Tests

Test real eBay API calls (run manually or in CI with credentials).

**Files:**
- `service/spec/test/ebay/SellerAPI.integration.spec.js`
- `service/spec/test/ebay/SoldItemsScraper.integration.spec.js`

**Guard with environment check:**
```javascript
const SKIP_EBAY_INTEGRATION = !process.env.RUN_EBAY_TESTS;

describe('SellerAPI Integration', () => {
  (SKIP_EBAY_INTEGRATION ? it.skip : it)('fetches real orders from eBay', async () => {
    const api = new SellerAPI();
    const orders = await api.getOrders({ daysBack: 7 });
    expect(orders).toBeInstanceOf(Array);
    expect(orders[0]).toHaveProperty('orderId');
  });
});
```

**Run manually:**
```bash
RUN_EBAY_TESTS=true npm test -- --grep "Integration"
```

### Layer 4: Scraper Tests

**A. Unit tests with mocked HTML:**
```javascript
describe('SoldItemsScraper', () => {
  it('parses sold item from HTML', () => {
    const html = fs.readFileSync('service/spec/fixtures/ebay-sold-page.html');
    const items = scraper.parseItems(html);
    expect(items[0].soldPrice).toBe(185.50);
    expect(items[0].title).toContain('ECU');
  });
});
```

**B. Visual regression (optional):**
Save snapshots of parsed data to detect when eBay changes HTML structure.

### Layer 5: E2E Tests (Playwright)

Full browser tests for the React frontend.

**Files:**
- `client/e2e/dashboard.spec.ts`
- `client/e2e/what-to-pull.spec.ts`
- `client/e2e/pricing.spec.ts`
- `client/e2e/dead-inventory.spec.ts`
- `client/e2e/opportunities.spec.ts`

**Setup (playwright.config.ts):**
```typescript
export default defineConfig({
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
});
```

**Example Test:**
```typescript
test('What to Pull page displays recommendations', async ({ page }) => {
  await page.goto('/what-to-pull');

  // Select vehicle
  await page.selectOption('[data-testid="make-select"]', 'Honda');
  await page.selectOption('[data-testid="model-select"]', 'Civic');
  await page.click('[data-testid="search-btn"]');

  // Verify results
  await expect(page.locator('[data-testid="recommendation-row"]')).toHaveCount.greaterThan(0);
  await expect(page.locator('[data-testid="score-badge"]').first()).toBeVisible();
});

test('Pricing page shows price recommendations', async ({ page }) => {
  await page.goto('/pricing');

  // Wait for data
  await expect(page.locator('[data-testid="pricing-table"]')).toBeVisible();

  // Verify columns
  await expect(page.locator('text=Current Price')).toBeVisible();
  await expect(page.locator('text=Suggested Price')).toBeVisible();
  await expect(page.locator('text=Market Range')).toBeVisible();
});
```

### Layer 6: Data Validation Tests

Sanity checks to ensure scraped/synced data makes sense.

**Files:**
- `service/spec/test/validation/data-integrity.spec.js`

**Example:**
```javascript
describe('Data Integrity', () => {
  it('sold prices are within reasonable range', async () => {
    const items = await SoldItem.query();
    items.forEach(item => {
      expect(item.soldPrice).toBeGreaterThan(0);
      expect(item.soldPrice).toBeLessThan(10000); // ECUs rarely exceed this
    });
  });

  it('sold dates are not in the future', async () => {
    const items = await SoldItem.query();
    const now = new Date();
    items.forEach(item => {
      expect(new Date(item.soldDate)).toBeLessThanOrEqual(now);
    });
  });

  it('your sales match your listings where applicable', async () => {
    // Cross-reference validation
  });
});
```

### Test Fixtures

**Location:** `service/spec/fixtures/`

**Files to create:**
- `ebay-sold-page.html` - Sample eBay sold items HTML
- `ebay-orders-response.xml` - Sample GetOrders XML response
- `ebay-listings-response.xml` - Sample GetMyeBaySelling XML response
- `sold-items.json` - Sample sold_item records
- `your-sales.json` - Sample your_sale records
- `your-listings.json` - Sample your_listing records

### CI Pipeline

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_DB: dynatrack_test
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3

      - name: Install dependencies
        run: npm ci

      - name: Run migrations
        run: npm run migrate:test

      - name: Run unit tests
        run: npm test

      - name: Run API integration tests
        run: npm run test:integration

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Run E2E tests
        run: npm run test:e2e
```

### Test Commands

```bash
# All unit tests
npm test

# API integration tests
npm run test:integration

# eBay API tests (manual, requires credentials)
RUN_EBAY_TESTS=true npm run test:ebay

# E2E tests
npm run test:e2e

# Full test suite
npm run test:all
```

---

## Notes

- **Scraping Risk:** eBay prohibits scraping. Implement rate limiting, user-agent rotation, and be prepared for blocks.
- **Data Volume:** Start with ECU category (35596), expand categories later.
- **Parallel Development:** All 4 intelligence features can be built independently once the foundation tables exist.
