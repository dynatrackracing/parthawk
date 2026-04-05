# DarkHawk Database Schema

> Generated 2026-04-04 | 62 tables, 816 columns

## Row Counts

| Table | Rows |
|-------|------|
| scout_alerts | 20,100 |
| YourSale | 14,608 |
| yard_vehicle | 12,075 |
| YourListing | 4,733 |
| SoldItem | 1,285 |
| restock_want_list | 1,145 |
| market_demand_cache | 594 |
| vin_cache | 421 |
| ebay_message_queue | 121 |
| trim_catalog | 116 |
| ebay_messages | 55 |
| trim_catalog_tracked | 23 |
| scrape_log | 22 |
| knex_migrations | 3 |
| knex_migrations_lock | 1 |
| part_fitment_cache | 0 |
| Cron | 0 |
| InterchangeNumber | 0 |
| return_intake | 0 |
| the_cache | 0 |
| pull_session | 0 |
| platform_group | 0 |
| fitment_data | 0 |
| scout_alerts_meta | 0 |
| competitor_alert | 0 |
| sky_watch_research | 0 |
| stale_inventory_action | 0 |
| Competitor | 0 |
| PriceCheck | 0 |
| trim_tier_reference | 0 |
| dismissed_intel | 0 |
| restock_watchlist | 0 |
| fitment_intelligence | 0 |
| CompetitorListing | 0 |
| platform_shared_part | 0 |
| restock_flag | 0 |
| Item | 0 |
| yard_visit_feedback | 0 |
| SoldItemSeller | 0 |
| trim_value_validation | 0 |
| part_location | 0 |
| ebay_message_templates | 0 |
| flyway_trip | 0 |
| PriceSnapshot | 0 |
| MarketResearchRun | 0 |
| ai_vehicle_research | 0 |
| return_transaction | 0 |
| Auto | 0 |
| flyway_trip_yard | 0 |
| trim_intelligence | 0 |
| User | 0 |
| dismissed_opportunity | 0 |
| fitment_scrape_queue | 0 |
| ItemInterchangeNumber | 0 |
| platform_vehicle | 0 |
| dead_inventory | 0 |
| overstock_group_item | 0 |
| programming_reference | 0 |
| overstock_group | 0 |
| instant_research_cache | 0 |
| yard | 0 |
| AutoItemCompatibility | 0 |
| the_mark | 0 |
| vin_scan_log | 0 |

---

### Auto (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | text | NO |  |  |
| year | integer | NO |  | PK |
| make | text | NO |  | PK |
| model | text | NO |  | PK |
| trim | text | NO |  | PK |
| engine | text | NO |  | PK |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### AutoItemCompatibility (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| autoId | text | NO |  | FK -> Auto |
| itemId | text | NO |  | FK -> Item |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** autoId -> Auto.id, itemId -> Item.id

---

### Competitor (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| name | text | NO |  | PK |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| enabled | boolean | YES | false |  |
| isRepair | boolean | YES | false |  |

---

### CompetitorListing (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| researchRunId | uuid | YES |  | FK -> MarketResearchRun |
| yourListingId | uuid | YES |  | FK -> YourListing |
| ebayItemId | character varying(50) | NO |  |  |
| title | text | NO |  |  |
| currentPrice | numeric | NO |  |  |
| originalPrice | numeric | YES |  |  |
| seller | character varying(255) | YES |  |  |
| sellerFeedbackScore | integer | YES |  |  |
| sellerFeedbackPercent | numeric | YES |  |  |
| condition | character varying(100) | YES |  |  |
| shippingCost | numeric | YES |  |  |
| freeShipping | boolean | YES | false |  |
| freeReturns | boolean | YES | false |  |
| location | character varying(255) | YES |  |  |
| isSponsored | boolean | YES | false |  |
| pictureUrl | text | YES |  |  |
| viewItemUrl | text | YES |  |  |
| keywords | text | YES |  |  |
| scrapedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** researchRunId -> MarketResearchRun.id, yourListingId -> YourListing.id

---

### Cron (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | text | NO |  |  |
| total | integer | YES |  |  |
| processed | integer | YES |  |  |
| unprocessed | integer | YES |  |  |
| elapsed | numeric | YES |  |  |
| duplicate | integer | YES |  |  |
| apiCalls | integer | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### InterchangeNumber (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | text | YES |  |  |
| interchangeNumber | text | NO |  | PK |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### Item (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | text | NO |  |  |
| ebayId | text | NO |  | PK |
| price | numeric | NO |  |  |
| quantity | integer | YES |  |  |
| title | text | NO |  |  |
| categoryId | text | NO |  |  |
| categoryTitle | text | NO |  |  |
| seller | text | NO |  |  |
| manufacturerPartNumber | text | YES |  |  |
| manufacturerId | text | YES |  |  |
| pictureUrl | text | YES |  |  |
| processed | boolean | YES | false |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| difficulty | integer | YES |  |  |
| salesEase | integer | YES |  |  |
| notes | text | YES |  |  |
| isRepair | boolean | YES | false |  |
| partNumberBase | text | YES |  |  |

---

### ItemInterchangeNumber (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| manufacturerPartNumber | text | NO |  |  |
| interchangePartId | text | NO |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### MarketResearchRun (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| yourListingId | uuid | YES |  | FK -> YourListing |
| keywords | text | NO |  |  |
| status | character varying(50) | YES | 'pending'::character varying |  |
| startedAt | timestamp with time zone | YES |  |  |
| completedAt | timestamp with time zone | YES |  |  |
| activeListingsFound | integer | YES | 0 |  |
| soldItemsFound | integer | YES | 0 |  |
| errorMessage | text | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** yourListingId -> YourListing.id

---

### PriceCheck (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| listingId | uuid | YES |  | FK -> YourListing |
| title | text | NO |  |  |
| yourPrice | numeric | YES |  |  |
| marketMedian | numeric | YES |  |  |
| marketMin | numeric | YES |  |  |
| marketMax | numeric | YES |  |  |
| marketAvg | numeric | YES |  |  |
| compCount | integer | YES |  |  |
| salesPerWeek | numeric | YES |  |  |
| verdict | text | YES |  |  |
| priceDiffPercent | numeric | YES |  |  |
| partType | text | YES |  |  |
| make | text | YES |  |  |
| model | text | YES |  |  |
| years | text | YES |  |  |
| searchQuery | text | YES |  |  |
| topComps | jsonb | YES |  |  |
| checkedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** listingId -> YourListing.id

---

### PriceSnapshot (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| keywords | text | NO |  |  |
| categoryId | character varying(50) | YES |  |  |
| soldCount | integer | YES | 0 |  |
| soldPriceMin | numeric | YES |  |  |
| soldPriceMax | numeric | YES |  |  |
| soldPriceAvg | numeric | YES |  |  |
| soldPriceMedian | numeric | YES |  |  |
| activeCount | integer | YES | 0 |  |
| activePriceMin | numeric | YES |  |  |
| activePriceMax | numeric | YES |  |  |
| activePriceAvg | numeric | YES |  |  |
| activePriceMedian | numeric | YES |  |  |
| periodStart | timestamp with time zone | NO |  |  |
| periodEnd | timestamp with time zone | NO |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| part_number_base | text | YES |  |  |
| ebay_median_price | numeric | YES |  |  |
| ebay_min_price | numeric | YES |  |  |
| ebay_max_price | numeric | YES |  |  |
| source | text | YES |  |  |
| snapshot_date | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### SoldItem (1,285 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| ebayItemId | text | NO |  |  |
| title | text | NO |  |  |
| soldPrice | numeric | NO |  |  |
| soldDate | timestamp with time zone | NO |  |  |
| categoryId | text | YES |  |  |
| categoryTitle | text | YES |  |  |
| seller | text | YES |  |  |
| condition | text | YES |  |  |
| pictureUrl | text | YES |  |  |
| compatibility | jsonb | YES |  |  |
| manufacturerPartNumber | text | YES |  |  |
| interchangeNumbers | ARRAY | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| researchRunId | uuid | YES |  | FK -> MarketResearchRun |
| yourListingId | uuid | YES |  | FK -> YourListing |
| keywords | text | YES |  |  |
| originalPrice | numeric | YES |  |  |
| sellerFeedbackScore | integer | YES |  |  |
| sellerFeedbackPercent | numeric | YES |  |  |
| shippingCost | numeric | YES |  |  |
| freeShipping | boolean | YES | false |  |
| location | character varying(255) | YES |  |  |
| scrapedAt | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| partNumberBase | text | YES |  |  |
| partType | text | YES |  |  |
| extractedMake | text | YES |  |  |
| extractedModel | text | YES |  |  |

**FK:** researchRunId -> MarketResearchRun.id, yourListingId -> YourListing.id

---

### SoldItemSeller (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| name | text | NO |  | PK |
| enabled | boolean | YES | true |  |
| itemsScraped | integer | YES | 0 |  |
| lastScrapedAt | timestamp with time zone | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| type | text | NO | 'competitor'::text |  |

---

### User (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('"User_id_seq"'::regclass) | PK |
| firstName | text | NO |  |  |
| lastName | text | NO |  |  |
| email | text | NO |  |  |
| imageUrl | text | YES |  |  |
| isAdmin | boolean | YES |  |  |
| isVerified | boolean | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| canSeePrice | boolean | YES | true |  |

---

### YourListing (4,733 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| ebayItemId | text | NO |  |  |
| title | text | YES |  |  |
| sku | text | YES |  |  |
| quantityAvailable | integer | YES |  |  |
| currentPrice | numeric | YES |  |  |
| listingStatus | text | YES |  |  |
| startTime | timestamp with time zone | YES |  |  |
| viewItemUrl | text | YES |  |  |
| syncedAt | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| priceCheckOmitted | boolean | NO | false |  |
| store | text | YES | 'dynatrack'::text |  |
| isProgrammed | boolean | YES | false |  |
| partNumberBase | text | YES |  |  |
| partType | text | YES |  |  |
| extractedMake | text | YES |  |  |
| extractedModel | text | YES |  |  |

---

### YourSale (14,608 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| ebayOrderId | text | NO |  |  |
| ebayItemId | text | YES |  |  |
| title | text | YES |  |  |
| sku | text | YES |  |  |
| quantity | integer | YES |  |  |
| salePrice | numeric | YES |  |  |
| soldDate | timestamp with time zone | YES |  |  |
| buyerUsername | text | YES |  |  |
| shippedDate | timestamp with time zone | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| store | text | YES | 'dynatrack'::text |  |
| partNumberBase | text | YES |  |  |
| partType | text | YES |  |  |
| extractedMake | text | YES |  |  |
| extractedModel | text | YES |  |  |

---

### ai_vehicle_research (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('ai_vehicle_research_id_seq | PK |
| year | integer | YES |  |  |
| make | character varying(50) | YES |  |  |
| model | character varying(100) | YES |  |  |
| engine | character varying(50) | YES |  |  |
| research | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### competitor_alert (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| competitor_seller | text | YES |  |  |
| part_number_base | text | YES |  |  |
| title | text | YES |  |  |
| alert_type | text | NO |  |  |
| our_price | numeric | YES |  |  |
| competitor_price | numeric | YES |  |  |
| market_avg | numeric | YES |  |  |
| recommendation | text | YES |  |  |
| dismissed | boolean | YES | false |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### dead_inventory (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_number_exact | text | YES |  |  |
| part_number_base | text | YES |  |  |
| description | text | YES |  |  |
| vehicle_application | text | YES |  |  |
| date_pulled | date | YES |  |  |
| date_listed | date | YES |  |  |
| days_listed | integer | YES |  |  |
| sold | boolean | YES | false |  |
| final_price | numeric | YES |  |  |
| market_avg_at_time | numeric | YES |  |  |
| price_vs_market | numeric | YES |  |  |
| condition_grade | text | YES |  |  |
| failure_reason | text | YES |  |  |
| notes | text | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### dismissed_intel (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| normalizedTitle | text | NO |  | PK |
| originalTitle | text | YES |  |  |
| dismissedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### dismissed_opportunity (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('dismissed_opportunity_id_s | PK |
| opportunity_key | text | NO |  |  |
| original_title | text | YES |  |  |
| dismissed_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### ebay_message_queue (121 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| order_id | character varying(64) | NO |  |  |
| item_id | character varying(64) | NO |  |  |
| buyer_user_id | character varying(128) | NO |  |  |
| template_key | character varying(32) | NO |  |  |
| scheduled_at | timestamp with time zone | NO |  |  |
| status | character varying(16) | NO | 'pending'::character varying |  |
| claimed_by | character varying(64) | YES |  |  |
| claimed_at | timestamp with time zone | YES |  |  |
| return_id | character varying(64) | YES |  |  |
| ebay_store | character varying(64) | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### ebay_message_templates (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('ebay_message_templates_id_ | PK |
| template_key | character varying(32) | NO |  |  |
| subject | text | YES |  |  |
| body | text | NO |  |  |
| is_active | boolean | YES | true |  |
| api_target | character varying(32) | NO | 'trading'::character varying |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### ebay_messages (55 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| order_id | character varying(64) | NO |  |  |
| item_id | character varying(64) | NO |  |  |
| buyer_user_id | character varying(128) | NO |  |  |
| template_key | character varying(32) | NO |  |  |
| subject | text | YES |  |  |
| body | text | NO |  |  |
| rendered_body | text | YES |  |  |
| sent_at | timestamp with time zone | YES |  |  |
| status | character varying(16) | NO | 'pending'::character varying |  |
| error_code | character varying(32) | YES |  |  |
| error_detail | text | YES |  |  |
| api_response | text | YES |  |  |
| retry_count | integer | YES | 0 |  |
| ebay_store | character varying(64) | YES |  |  |
| trigger_source | character varying(32) | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### fitment_data (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('fitment_data_id_seq'::regc | PK |
| part_number | character varying(100) | NO |  |  |
| part_number_base | character varying(100) | YES |  |  |
| part_name | character varying(200) | YES |  |  |
| category | character varying(50) | YES |  |  |
| year_start | integer | YES |  |  |
| year_end | integer | YES |  |  |
| makes | ARRAY | YES |  |  |
| models | ARRAY | YES |  |  |
| engines | ARRAY | YES |  |  |
| fits_vehicles | jsonb | YES |  |  |
| does_not_fit | text | YES |  |  |
| does_not_fit_vehicles | jsonb | YES |  |  |
| drivetrain_specific | text | YES |  |  |
| transmission_specific | text | YES |  |  |
| engine_specific | text | YES |  |  |
| programming_required | character varying(20) | YES |  |  |
| programming_note | text | YES |  |  |
| programming_tool | text | YES |  |  |
| installation_notes | text | YES |  |  |
| installation_warning | text | YES |  |  |
| confidence | character varying(20) | YES | 'low'::character varying |  |
| source | character varying(50) | YES |  |  |
| sources_checked | ARRAY | YES |  |  |
| confirmed_by | character varying(50) | YES |  |  |
| confirmed_count | integer | YES | 0 |  |
| created_at | timestamp without time zone | YES | now() |  |
| updated_at | timestamp without time zone | YES | now() |  |
| last_scraped_at | timestamp without time zone | YES |  |  |

---

### fitment_intelligence (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_type | text | NO |  |  |
| make | text | NO |  |  |
| model | text | NO |  |  |
| year_start | integer | NO |  |  |
| year_end | integer | NO |  |  |
| fits_trims | jsonb | YES | '[]'::jsonb |  |
| fits_engines | jsonb | YES | '[]'::jsonb |  |
| fits_transmissions | jsonb | YES | '[]'::jsonb |  |
| does_not_fit_trims | jsonb | YES | '[]'::jsonb |  |
| does_not_fit_engines | jsonb | YES | '[]'::jsonb |  |
| does_not_fit_transmissions | jsonb | YES | '[]'::jsonb |  |
| part_number_variants | jsonb | YES | '{}'::jsonb |  |
| negation_text | text | YES |  |  |
| part_number_warning | text | YES |  |  |
| source_seller | text | YES |  |  |
| source_listings | jsonb | YES | '[]'::jsonb |  |
| confidence | text | YES | 'low'::text |  |
| scraped_at | timestamp without time zone | YES | now() |  |
| created_at | timestamp without time zone | YES | now() |  |
| updated_at | timestamp without time zone | YES | now() |  |

---

### fitment_scrape_queue (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('fitment_scrape_queue_id_se | PK |
| part_number | character varying(100) | NO |  |  |
| part_number_base | character varying(100) | YES |  |  |
| category | character varying(50) | YES |  |  |
| priority | integer | YES | 50 |  |
| sales_count | integer | YES | 0 |  |
| status | character varying(20) | YES | 'pending'::character varying |  |
| attempts | integer | YES | 0 |  |
| last_attempt_at | timestamp without time zone | YES |  |  |
| completed_at | timestamp without time zone | YES |  |  |
| error_message | text | YES |  |  |
| created_at | timestamp without time zone | YES | now() |  |

---

### flyway_trip (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('flyway_trip_id_seq'::regcl | PK |
| name | character varying(255) | NO |  |  |
| start_date | date | NO |  |  |
| end_date | date | NO |  |  |
| status | character varying(20) | NO | 'planning'::character varying |  |
| notes | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| trip_type | character varying(20) | NO | 'road_trip'::character varying |  |
| completed_at | timestamp with time zone | YES |  |  |
| cleaned_up | boolean | YES | false |  |

---

### flyway_trip_yard (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('flyway_trip_yard_id_seq':: | PK |
| trip_id | integer | NO |  | FK -> flyway_trip |
| yard_id | uuid | NO |  | FK -> yard |
| scrape_enabled | boolean | YES | true |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

**FK:** trip_id -> flyway_trip.id, yard_id -> yard.id

---

### instant_research_cache (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('instant_research_cache_id_ | PK |
| vehicle_key | character varying(200) | NO |  |  |
| vehicle_display | character varying(200) | YES |  |  |
| results | jsonb | YES |  |  |
| last_updated | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### market_demand_cache (594 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_number_base | text | NO |  |  |
| ebay_sold_90d | integer | YES | 0 |  |
| ebay_avg_price | numeric | YES |  |  |
| ebay_active_listings | integer | YES | 0 |  |
| market_score | numeric | YES |  |  |
| last_updated | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| ebay_sold_30d | numeric | YES | '0'::numeric |  |
| seasonal_weight | numeric | YES | '1'::numeric |  |
| source | character varying(20) | YES | 'playwright'::character varying |  |
| search_query | text | YES |  |  |
| ebay_median_price | numeric | YES |  |  |
| ebay_min_price | numeric | YES |  |  |
| ebay_max_price | numeric | YES |  |  |
| market_velocity | character varying(20) | YES |  |  |
| sales_per_week | numeric | YES |  |  |
| top_comps | jsonb | YES |  |  |
| key_type | character varying(10) | YES | 'pn'::character varying |  |

---

### overstock_group (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('overstock_group_id_seq'::r | PK |
| name | character varying(256) | NO |  |  |
| part_type | character varying(128) | YES |  |  |
| restock_target | integer | NO | 1 |  |
| current_stock | integer | YES | 0 |  |
| initial_stock | integer | NO |  |  |
| group_type | character varying(32) | YES | 'multi'::character varying |  |
| status | character varying(32) | YES | 'watching'::character varying |  |
| triggered_at | timestamp with time zone | YES |  |  |
| acknowledged_at | timestamp with time zone | YES |  |  |
| notes | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### overstock_group_item (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('overstock_group_item_id_se | PK |
| group_id | integer | NO |  | FK -> overstock_group |
| ebay_item_id | character varying(64) | NO |  |  |
| title | character varying(512) | YES |  |  |
| current_price | numeric | YES |  |  |
| is_active | boolean | YES | true |  |
| added_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

**FK:** group_id -> overstock_group.id

---

### part_fitment_cache (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('part_fitment_cache_id_seq' | PK |
| part_number_exact | character varying(50) | NO |  |  |
| part_number_base | character varying(50) | NO |  |  |
| part_name | text | YES |  |  |
| part_type | character varying(30) | YES |  |  |
| year | integer | YES |  |  |
| year_range | character varying(20) | YES |  |  |
| make | character varying(50) | YES |  |  |
| model | character varying(50) | YES |  |  |
| engine | character varying(50) | YES |  |  |
| trim | character varying(50) | YES |  |  |
| drivetrain | character varying(30) | YES |  |  |
| does_not_fit | text | YES |  |  |
| programming_required | character varying(20) | YES |  |  |
| programming_note | text | YES |  |  |
| source | character varying(30) | YES | 'listing_tool'::character varying |  |
| confirmed_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### part_location (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_type | text | NO |  |  |
| year_start | integer | YES |  |  |
| year_end | integer | YES |  |  |
| make | text | YES |  |  |
| model | text | YES |  |  |
| trim | text | YES |  |  |
| location_text | text | YES |  |  |
| removal_steps | jsonb | YES | '[]'::jsonb |  |
| tools | text | YES |  |  |
| hazards | text | YES |  |  |
| avg_pull_minutes | integer | YES |  |  |
| photo_url | text | YES |  |  |
| confirmed_count | integer | YES | 0 |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| body_style | text | YES |  |  |
| confidence | text | YES | 'researched'::text |  |

---

### platform_group (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('platform_group_id_seq'::re | PK |
| name | character varying(100) | NO |  |  |
| platform | character varying(100) | NO |  |  |
| year_start | integer | NO |  |  |
| year_end | integer | NO |  |  |
| notes | text | YES |  |  |
| created_at | timestamp without time zone | YES | now() |  |

---

### platform_shared_part (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('platform_shared_part_id_se | PK |
| platform_group_id | integer | NO |  | FK -> platform_group |
| part_type | character varying(50) | NO |  |  |
| confidence | character varying(20) | YES | 'high'::character varying |  |
| notes | text | YES |  |  |

**FK:** platform_group_id -> platform_group.id

---

### platform_vehicle (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('platform_vehicle_id_seq':: | PK |
| platform_group_id | integer | NO |  | FK -> platform_group |
| make | character varying(50) | NO |  |  |
| model | character varying(100) | NO |  |  |
| year_start | integer | YES |  |  |
| year_end | integer | YES |  |  |
| created_at | timestamp without time zone | YES | now() |  |

**FK:** platform_group_id -> platform_group.id

---

### programming_reference (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('programming_reference_id_s | PK |
| brand_group | text | NO |  |  |
| module_type | text | NO |  |  |
| year | integer | NO |  |  |
| required | character varying(10) | NO |  |  |
| notes | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### pull_session (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| yard_id | uuid | YES |  | FK -> yard |
| puller_id | text | YES |  |  |
| date | date | NO |  |  |
| parts_cost | numeric | YES | '0'::numeric |  |
| gate_fee | numeric | YES | '0'::numeric |  |
| tax_paid | numeric | YES | '0'::numeric |  |
| mileage | numeric | YES | '0'::numeric |  |
| mileage_cost | numeric | YES | '0'::numeric |  |
| total_true_cogs | numeric | YES | '0'::numeric |  |
| total_market_value | numeric | YES | '0'::numeric |  |
| blended_cogs_pct | numeric | YES | '0'::numeric |  |
| yield_rating | integer | YES |  |  |
| notes | text | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** yard_id -> yard.id

---

### restock_flag (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_number_base | text | NO |  |  |
| title | text | YES |  |  |
| category | text | YES |  |  |
| sold_90d | integer | YES | 0 |  |
| sold_30d | integer | YES | 0 |  |
| active_stock | integer | YES | 0 |  |
| avg_sold_price | numeric | YES |  |  |
| avg_days_to_sell | numeric | YES |  |  |
| restock_score | numeric | YES |  |  |
| store | text | YES | 'all'::text |  |
| acknowledged | boolean | YES | false |  |
| last_checked | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### restock_want_list (1,145 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('restock_want_list_id_seq': | PK |
| title | text | NO |  |  |
| notes | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| active | boolean | YES | true |  |
| pulled | boolean | YES | false |  |
| pulled_date | timestamp with time zone | YES |  |  |
| pulled_from | text | YES |  |  |
| auto_generated | boolean | YES | false |  |

---

### restock_watchlist (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('restock_watchlist_id_seq': | PK |
| part_number_base | character varying(50) | NO |  |  |
| part_description | text | YES |  |  |
| target_stock | integer | YES | 1 |  |
| priority | character varying(20) | YES | 'normal'::character varying |  |
| notes | text | YES |  |  |
| added_at | timestamp without time zone | YES | now() |  |
| active | boolean | YES | true |  |

---

### return_intake (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| ebay_item_id | text | YES |  |  |
| listing_id | text | YES |  |  |
| title | text | YES |  |  |
| part_number | text | YES |  |  |
| sku | text | YES |  |  |
| puller_name | text | YES |  |  |
| yard_name | text | YES |  |  |
| vehicle_info | text | YES |  |  |
| condition_grade | text | NO |  |  |
| condition_notes | text | YES |  |  |
| original_price | numeric | YES |  |  |
| relist_price | numeric | YES |  |  |
| relist_status | text | YES | 'pending'::text |  |
| relist_ebay_item_id | text | YES |  |  |
| returned_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| relisted_at | timestamp with time zone | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### return_transaction (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('return_transaction_id_seq' | PK |
| transaction_date | date | NO |  |  |
| order_number | character varying(80) | YES |  |  |
| legacy_order_id | character varying(80) | YES |  |  |
| buyer_username | character varying(80) | YES |  |  |
| buyer_name | character varying(120) | YES |  |  |
| ship_city | character varying(80) | YES |  |  |
| ship_state | character varying(80) | YES |  |  |
| ship_zip | character varying(30) | YES |  |  |
| ship_country | character varying(30) | YES |  |  |
| net_amount | numeric | YES |  |  |
| gross_amount | numeric | YES |  |  |
| ebay_item_id | character varying(80) | YES |  |  |
| transaction_id | character varying(80) | YES |  |  |
| item_title | character varying(300) | YES |  |  |
| custom_label | character varying(80) | YES |  |  |
| item_subtotal | numeric | YES |  |  |
| shipping_handling | numeric | YES |  |  |
| fvf_fixed | numeric | YES |  |  |
| fvf_variable | numeric | YES |  |  |
| regulatory_fee | numeric | YES |  |  |
| inad_fee | numeric | YES |  |  |
| international_fee | numeric | YES |  |  |
| reference_id | character varying(80) | YES |  |  |
| payout_id | character varying(80) | YES |  |  |
| part_type | character varying(40) | YES |  |  |
| make | character varying(30) | YES |  |  |
| is_formal_return | boolean | YES | false |  |
| has_inad_fee | boolean | YES | false |  |
| abs_gross | numeric | YES |  |  |
| created_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### scout_alerts (20,100 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('scout_alerts_id_seq'::regc | PK |
| source | character varying(20) | NO |  |  |
| source_title | text | NO |  |  |
| part_value | numeric | YES |  |  |
| yard_name | character varying(255) | YES |  |  |
| vehicle_year | character varying(10) | YES |  |  |
| vehicle_make | character varying(100) | YES |  |  |
| vehicle_model | character varying(100) | YES |  |  |
| vehicle_color | character varying(100) | YES |  |  |
| row | character varying(50) | YES |  |  |
| confidence | character varying(10) | NO |  |  |
| notes | text | YES |  |  |
| vehicle_set_date | date | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| claimed | boolean | YES | false |  |
| claimed_by | text | YES |  |  |
| claimed_at | timestamp with time zone | YES |  |  |

---

### scout_alerts_meta (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| key | character varying(50) | NO |  | PK |
| value | text | YES |  |  |

---

### scrape_log (22 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| yard_id | uuid | YES |  | FK -> yard |
| scraped_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| vehicles_found | integer | YES | 0 |  |
| new_vehicles | integer | YES | 0 |  |
| pages_scraped | integer | YES | 0 |  |
| termination_reason | text | YES |  |  |
| source | text | YES | 'local'::text |  |

**FK:** yard_id -> yard.id

---

### sky_watch_research (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('sky_watch_research_id_seq' | PK |
| vehicle_year | integer | NO |  |  |
| vehicle_make | character varying(64) | NO |  |  |
| vehicle_model | character varying(128) | NO |  |  |
| vehicle_engine | character varying(128) | YES |  |  |
| vehicle_trim | character varying(128) | YES |  |  |
| source | character varying(32) | NO |  |  |
| source_vin | character varying(17) | YES |  |  |
| results | jsonb | NO |  |  |
| total_estimated_value | numeric | YES |  |  |
| parts_found_count | integer | YES | 0 |  |
| high_value_count | integer | YES | 0 |  |
| status | character varying(32) | YES | 'new'::character varying |  |
| reviewed_at | timestamp with time zone | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### stale_inventory_action (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| ebay_item_id | text | NO |  |  |
| listing_id | text | YES |  |  |
| title | text | YES |  |  |
| action_type | text | NO |  |  |
| old_price | numeric | YES |  |  |
| new_price | numeric | YES |  |  |
| days_listed | integer | YES |  |  |
| tier | text | YES |  |  |
| programmed_listing | boolean | YES | false |  |
| executed | boolean | YES | false |  |
| execution_error | text | YES |  |  |
| notes | text | YES |  |  |
| scheduled_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| executed_at | timestamp with time zone | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### the_cache (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| part_type | character varying(100) | YES |  |  |
| part_description | text | YES |  |  |
| part_number | character varying(100) | YES |  |  |
| vehicle_year | integer | YES |  |  |
| vehicle_make | character varying(100) | YES |  |  |
| vehicle_model | character varying(100) | YES |  |  |
| vehicle_trim | character varying(100) | YES |  |  |
| vehicle_vin | character varying(17) | YES |  |  |
| yard_name | character varying(200) | YES |  |  |
| row_number | character varying(50) | YES |  |  |
| estimated_value | numeric | YES |  |  |
| price_source | character varying(50) | YES |  |  |
| claimed_by | character varying(100) | YES | 'ry'::character varying |  |
| claimed_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| source | character varying(50) | NO |  |  |
| source_id | character varying(255) | YES |  |  |
| status | character varying(30) | YES | 'claimed'::character varying |  |
| resolved_at | timestamp with time zone | YES |  |  |
| resolved_by | character varying(50) | YES |  |  |
| ebay_item_id | character varying(50) | YES |  |  |
| notes | text | YES |  |  |
| created_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |

---

### the_mark (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| normalizedTitle | text | NO |  |  |
| originalTitle | text | NO |  |  |
| partNumber | text | YES |  |  |
| partType | text | YES |  |  |
| medianPrice | integer | YES |  |  |
| sourceSignal | text | YES |  |  |
| sourceSellers | ARRAY | YES |  |  |
| scoreAtMark | integer | YES |  |  |
| notes | text | YES |  |  |
| active | boolean | YES | true |  |
| graduatedAt | timestamp with time zone | YES |  |  |
| graduatedReason | text | YES |  |  |
| markedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| source | character varying(32) | YES | 'PERCH'::character varying |  |
| match_confidence | character varying(16) | YES |  |  |
| matched_yard_vehicle_id | integer | YES |  |  |
| matched_at | timestamp with time zone | YES |  |  |

---

### trim_catalog (116 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('trim_catalog_id_seq'::regc | PK |
| year | integer | NO |  |  |
| make | text | NO |  |  |
| model | text | NO |  |  |
| trim_raw | text | NO |  |  |
| trim_name | text | NO |  |  |
| body_style | text | YES |  |  |
| tier | text | NO |  |  |
| created_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### trim_catalog_tracked (23 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('trim_catalog_tracked_id_se | PK |
| year | integer | NO |  |  |
| make | text | NO |  |  |
| model | text | NO |  |  |
| trim_count | integer | YES | 0 |  |
| cataloged_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### trim_intelligence (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| year | integer | NO |  |  |
| make | text | NO |  |  |
| model | text | NO |  |  |
| trim | text | NO |  |  |
| expected_parts | jsonb | YES | '[]'::jsonb |  |
| confidence | text | YES | 'low'::text |  |
| researched_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### trim_tier_reference (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('trim_tier_reference_id_seq | PK |
| make | text | NO |  |  |
| model | text | NO |  |  |
| gen_start | integer | NO |  |  |
| gen_end | integer | NO |  |  |
| trim | text | NO |  |  |
| tier | integer | NO |  |  |
| tier_name | text | YES |  |  |
| top_engine | text | YES |  |  |
| audio_brand | text | YES |  |  |
| expected_parts | text | YES |  |  |
| notes | text | YES |  |  |
| cult | boolean | YES | false |  |
| transmission | text | YES |  |  |
| diesel | boolean | YES | false |  |

---

### trim_value_validation (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| make | character varying(100) | NO |  |  |
| part_type | character varying(100) | NO |  |  |
| premium_keyword | character varying(200) | NO |  |  |
| premium_avg_price | numeric | YES |  |  |
| base_avg_price | numeric | YES |  |  |
| delta | numeric | NO |  |  |
| n_premium | integer | YES | 0 |  |
| n_base | integer | YES | 0 |  |
| verdict | character varying(20) | NO |  |  |
| source | character varying(20) | NO | 'YOUR_DATA'::character varying |  |
| validated_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| created_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updated_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### vin_cache (421 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO | gen_random_uuid() | PK |
| vin | text | NO |  |  |
| year | integer | YES |  |  |
| make | text | YES |  |  |
| model | text | YES |  |  |
| trim | text | YES |  |  |
| engine | text | YES |  |  |
| drivetrain | text | YES |  |  |
| body_style | text | YES |  |  |
| paint_code | text | YES |  |  |
| raw_nhtsa | jsonb | YES | '{}'::jsonb |  |
| raw_enriched | jsonb | YES | '{}'::jsonb |  |
| decoded_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

---

### vin_scan_log (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | integer | NO | nextval('vin_scan_log_id_seq'::regc | PK |
| vin | character varying(17) | NO |  |  |
| year | integer | YES |  |  |
| make | character varying(50) | YES |  |  |
| model | character varying(100) | YES |  |  |
| trim | character varying(100) | YES |  |  |
| engine | character varying(50) | YES |  |  |
| engine_type | character varying(20) | YES |  |  |
| drivetrain | character varying(20) | YES |  |  |
| paint_code | character varying(20) | YES |  |  |
| scanned_by | character varying(50) | YES |  |  |
| scanned_at | timestamp with time zone | YES | CURRENT_TIMESTAMP |  |
| source | character varying(20) | YES | 'manual'::character varying |  |
| notes | text | YES |  |  |

---

### yard (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| name | character varying(255) | NO |  |  |
| chain | character varying(100) | YES |  |  |
| address | character varying(500) | YES |  |  |
| lat | numeric | YES |  |  |
| lng | numeric | YES |  |  |
| distance_from_base | numeric | YES |  |  |
| entry_fee | numeric | YES | '0'::numeric |  |
| tax_rate | numeric | YES | '0'::numeric |  |
| scrape_url | character varying(1000) | YES |  |  |
| scrape_method | character varying(50) | YES | 'none'::character varying |  |
| last_scraped | timestamp with time zone | YES |  |  |
| last_visited | timestamp with time zone | YES |  |  |
| avg_yield | numeric | YES |  |  |
| avg_rating | numeric | YES |  |  |
| flagged | boolean | YES | false |  |
| flag_reason | text | YES |  |  |
| enabled | boolean | YES | true |  |
| visit_frequency | character varying(50) | YES | 'local'::character varying |  |
| notes | text | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| entry_fee_notes | text | YES |  |  |
| region | character varying(20) | YES | 'nc'::character varying |  |

---

### yard_vehicle (12,075 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| yard_id | uuid | YES |  | FK -> yard |
| year | character varying(10) | YES |  |  |
| make | character varying(100) | YES |  |  |
| model | character varying(100) | YES |  |  |
| trim | character varying(100) | YES |  |  |
| color | character varying(100) | YES |  |  |
| row_number | character varying(50) | YES |  |  |
| vin | character varying(20) | YES |  |  |
| date_added | date | YES |  |  |
| scraped_at | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| active | boolean | YES | true |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| updatedAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |
| first_seen | timestamp with time zone | YES |  |  |
| last_seen | timestamp with time zone | YES |  |  |
| stock_number | character varying(30) | YES |  |  |
| engine | character varying(50) | YES |  |  |
| engine_type | character varying(20) | YES |  |  |
| drivetrain | character varying(20) | YES |  |  |
| trim_level | character varying(100) | YES |  |  |
| body_style | character varying(50) | YES |  |  |
| vin_decoded | boolean | YES | false |  |
| decoded_trim | text | YES |  |  |
| decoded_engine | text | YES |  |  |
| decoded_drivetrain | text | YES |  |  |
| trim_tier | text | YES |  |  |
| vin_decoded_at | timestamp with time zone | YES |  |  |
| audio_brand | text | YES |  |  |
| expected_parts | text | YES |  |  |
| cult | boolean | YES | false |  |
| decoded_transmission | text | YES |  |  |
| transmission_speeds | text | YES |  |  |
| diesel | boolean | YES | false |  |

**FK:** yard_id -> yard.id

---

### yard_visit_feedback (0 rows)

| Column | Type | Nullable | Default | Key |
|--------|------|----------|---------|-----|
| id | uuid | NO |  | PK |
| yard_id | uuid | YES |  | FK -> yard |
| puller_name | character varying(255) | YES |  |  |
| visit_date | date | NO |  |  |
| rating | integer | YES |  |  |
| notes | text | YES |  |  |
| createdAt | timestamp with time zone | NO | CURRENT_TIMESTAMP |  |

**FK:** yard_id -> yard.id

---

