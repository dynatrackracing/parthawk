# DARKHAWK DATABASE SCHEMA

> Generated: 2026-04-04 | Database: Railway PostgreSQL | 64 tables, 822 columns

## Table Summary

| Table | Rows | Columns |
|-------|------|---------|
| Auto | 0 | 8 |
| AutoItemCompatibility | 0 | 3 |
| Competitor | 0 | 5 |
| CompetitorListing | 0 | 21 |
| Cron | 0 | 9 |
| InterchangeNumber | 0 | 4 |
| Item | 0 | 19 |
| ItemInterchangeNumber | 0 | 3 |
| MarketResearchRun | 0 | 10 |
| PriceCheck | 0 | 21 |
| PriceSnapshot | 0 | 22 |
| SoldItem | 1,285 | 29 |
| SoldItemSeller | 0 | 7 |
| User | 0 | 10 |
| YourListing | 4,733 | 19 |
| YourSale | 14,608 | 17 |
| ai_vehicle_research | 0 | 7 |
| competitor_alert | 0 | 11 |
| dead_inventory | 0 | 16 |
| dismissed_intel | 0 | 3 |
| dismissed_opportunity | 0 | 4 |
| ebay_message_queue | 121 | 12 |
| ebay_message_templates | 0 | 8 |
| ebay_messages | 55 | 18 |
| fitment_data | 0 | 29 |
| fitment_intelligence | 0 | 21 |
| fitment_scrape_queue | 0 | 12 |
| flyway_trip | 0 | 11 |
| flyway_trip_yard | 0 | 5 |
| instant_research_cache | 0 | 5 |
| knex_migrations | 3 | 4 |
| knex_migrations_lock | 1 | 2 |
| market_demand_cache | 594 | 19 |
| overstock_group | 0 | 13 |
| overstock_group_item | 0 | 7 |
| part_fitment_cache | 0 | 18 |
| part_location | 0 | 18 |
| platform_group | 0 | 7 |
| platform_shared_part | 0 | 5 |
| platform_vehicle | 0 | 7 |
| programming_reference | 0 | 7 |
| pull_session | 0 | 16 |
| restock_flag | 0 | 14 |
| restock_want_list | 1,145 | 9 |
| restock_watchlist | 0 | 8 |
| return_intake | 0 | 18 |
| return_transaction | 0 | 32 |
| scout_alerts | 20,100 | 17 |
| scout_alerts_meta | 0 | 2 |
| scrape_log | 22 | 8 |
| sky_watch_research | 0 | 16 |
| stale_inventory_action | 0 | 16 |
| the_cache | 0 | 24 |
| the_mark | 0 | 20 |
| trim_catalog | 116 | 9 |
| trim_catalog_tracked | 23 | 6 |
| trim_intelligence | 0 | 9 |
| trim_tier_reference | 0 | 15 |
| trim_value_validation | 0 | 14 |
| vin_cache | 421 | 14 |
| vin_scan_log | 0 | 14 |
| yard | 0 | 24 |
| yard_vehicle | 12,075 | 34 |
| yard_visit_feedback | 0 | 7 |

---

### Auto (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | text | - | NO |
| year | integer | - | NO |
| make | text | - | NO |
| model | text | - | NO |
| trim | text | - | NO |
| engine | text | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) Auto_pkey: "Auto" (year, make, model, "trim", engine)
- (unique) auto_id_unique: "Auto" (id)
- idx_auto_year_make_model: "Auto" (year, make, model)

---

### AutoItemCompatibility (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| autoId | text | - | NO |
| itemId | text | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** autoId → Auto.id, itemId → Item.id

**Indexes:**
- idx_aic_auto_id: "AutoItemCompatibility" ("autoId")
- (unique) idx_aic_auto_item: "AutoItemCompatibility" ("autoId", "itemId")
- idx_aic_item_id: "AutoItemCompatibility" ("itemId")

---

### Competitor (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| name | text | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| enabled | boolean | false | YES |
| isRepair | boolean | false | YES |

**Indexes:**
- (unique) Competitor_pkey: "Competitor" (name)

---

### CompetitorListing (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| researchRunId | uuid | - | YES |
| yourListingId | uuid | - | YES |
| ebayItemId | character varying(50) | - | NO |
| title | text | - | NO |
| currentPrice | numeric | - | NO |
| originalPrice | numeric | - | YES |
| seller | character varying(255) | - | YES |
| sellerFeedbackScore | integer | - | YES |
| sellerFeedbackPercent | numeric | - | YES |
| condition | character varying(100) | - | YES |
| shippingCost | numeric | - | YES |
| freeShipping | boolean | false | YES |
| freeReturns | boolean | false | YES |
| location | character varying(255) | - | YES |
| isSponsored | boolean | false | YES |
| pictureUrl | text | - | YES |
| viewItemUrl | text | - | YES |
| keywords | text | - | YES |
| scrapedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** researchRunId → MarketResearchRun.id, yourListingId → YourListing.id

**Indexes:**
- (unique) CompetitorListing_pkey: "CompetitorListing" (id)
- competitorlisting_currentprice_index: "CompetitorListing" ("currentPrice")
- (unique) competitorlisting_ebayitemid_unique: "CompetitorListing" ("ebayItemId")
- competitorlisting_scrapedat_index: "CompetitorListing" ("scrapedAt")
- competitorlisting_seller_index: "CompetitorListing" (seller)
- competitorlisting_yourlistingid_index: "CompetitorListing" ("yourListingId")

---

### Cron (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | text | - | NO |
| total | integer | - | YES |
| processed | integer | - | YES |
| unprocessed | integer | - | YES |
| elapsed | numeric | - | YES |
| duplicate | integer | - | YES |
| apiCalls | integer | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

---

### InterchangeNumber (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | text | - | YES |
| interchangeNumber | text | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) InterchangeNumber_pkey: "InterchangeNumber" ("interchangeNumber")

---

### Item (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | text | - | NO |
| ebayId | text | - | NO |
| price | numeric | - | NO |
| quantity | integer | - | YES |
| title | text | - | NO |
| categoryId | text | - | NO |
| categoryTitle | text | - | NO |
| seller | text | - | NO |
| manufacturerPartNumber | text | - | YES |
| manufacturerId | text | - | YES |
| pictureUrl | text | - | YES |
| processed | boolean | false | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| difficulty | integer | - | YES |
| salesEase | integer | - | YES |
| notes | text | - | YES |
| isRepair | boolean | false | YES |
| partNumberBase | text | - | YES |

**Indexes:**
- (unique) Item_pkey: "Item" ("ebayId")
- idx_item_part_number_base: "Item" ("partNumberBase")
- (unique) item_id_unique: "Item" (id)

---

### ItemInterchangeNumber (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| manufacturerPartNumber | text | - | NO |
| interchangePartId | text | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

---

### MarketResearchRun (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| yourListingId | uuid | - | YES |
| keywords | text | - | NO |
| status | character varying(50) | 'pending'::character varying | YES |
| startedAt | timestamp with time zone | - | YES |
| completedAt | timestamp with time zone | - | YES |
| activeListingsFound | integer | 0 | YES |
| soldItemsFound | integer | 0 | YES |
| errorMessage | text | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** yourListingId → YourListing.id

**Indexes:**
- (unique) MarketResearchRun_pkey: "MarketResearchRun" (id)
- marketresearchrun_createdat_index: "MarketResearchRun" ("createdAt")
- marketresearchrun_status_index: "MarketResearchRun" (status)
- marketresearchrun_yourlistingid_index: "MarketResearchRun" ("yourListingId")

---

### PriceCheck (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| listingId | uuid | - | YES |
| title | text | - | NO |
| yourPrice | numeric | - | YES |
| marketMedian | numeric | - | YES |
| marketMin | numeric | - | YES |
| marketMax | numeric | - | YES |
| marketAvg | numeric | - | YES |
| compCount | integer | - | YES |
| salesPerWeek | numeric | - | YES |
| verdict | text | - | YES |
| priceDiffPercent | numeric | - | YES |
| partType | text | - | YES |
| make | text | - | YES |
| model | text | - | YES |
| years | text | - | YES |
| searchQuery | text | - | YES |
| topComps | jsonb | - | YES |
| checkedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** listingId → YourListing.id

**Indexes:**
- (unique) PriceCheck_pkey: "PriceCheck" (id)
- idx_price_check_checked_at: "PriceCheck" ("checkedAt")
- idx_price_check_listing_id: "PriceCheck" ("listingId")

---

### PriceSnapshot (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| keywords | text | - | NO |
| categoryId | character varying(50) | - | YES |
| soldCount | integer | 0 | YES |
| soldPriceMin | numeric | - | YES |
| soldPriceMax | numeric | - | YES |
| soldPriceAvg | numeric | - | YES |
| soldPriceMedian | numeric | - | YES |
| activeCount | integer | 0 | YES |
| activePriceMin | numeric | - | YES |
| activePriceMax | numeric | - | YES |
| activePriceAvg | numeric | - | YES |
| activePriceMedian | numeric | - | YES |
| periodStart | timestamp with time zone | - | NO |
| periodEnd | timestamp with time zone | - | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| part_number_base | text | - | YES |
| ebay_median_price | numeric | - | YES |
| ebay_min_price | numeric | - | YES |
| ebay_max_price | numeric | - | YES |
| source | text | - | YES |
| snapshot_date | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) PriceSnapshot_pkey: "PriceSnapshot" (id)
- idx_price_snapshot_date: "PriceSnapshot" (snapshot_date)
- idx_price_snapshot_pn: "PriceSnapshot" (part_number_base)
- pricesnapshot_createdat_index: "PriceSnapshot" ("createdAt")
- pricesnapshot_keywords_periodstart_index: "PriceSnapshot" (keywords, "periodStart")

---

### SoldItem (1,285 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| ebayItemId | text | - | NO |
| title | text | - | NO |
| soldPrice | numeric | - | NO |
| soldDate | timestamp with time zone | - | NO |
| categoryId | text | - | YES |
| categoryTitle | text | - | YES |
| seller | text | - | YES |
| condition | text | - | YES |
| pictureUrl | text | - | YES |
| compatibility | jsonb | - | YES |
| manufacturerPartNumber | text | - | YES |
| interchangeNumbers | ARRAY | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| researchRunId | uuid | - | YES |
| yourListingId | uuid | - | YES |
| keywords | text | - | YES |
| originalPrice | numeric | - | YES |
| sellerFeedbackScore | integer | - | YES |
| sellerFeedbackPercent | numeric | - | YES |
| shippingCost | numeric | - | YES |
| freeShipping | boolean | false | YES |
| location | character varying(255) | - | YES |
| scrapedAt | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| partNumberBase | text | - | YES |
| partType | text | - | YES |
| extractedMake | text | - | YES |
| extractedModel | text | - | YES |

**Foreign Keys:** researchRunId → MarketResearchRun.id, yourListingId → YourListing.id

**Indexes:**
- (unique) SoldItem_pkey: "SoldItem" (id)
- idx_sold_item_category: "SoldItem" ("categoryId")
- idx_sold_item_compatibility: "SoldItem" USING gin (compatibility)
- idx_sold_item_seller: "SoldItem" (seller)
- idx_sold_item_sold_date: "SoldItem" ("soldDate")
- idx_solditem_make: "SoldItem" ("extractedMake")
- idx_solditem_parttype: "SoldItem" ("partType")
- idx_solditem_pnbase: "SoldItem" ("partNumberBase")
- (unique) solditem_ebayitemid_unique: "SoldItem" ("ebayItemId")
- solditem_yourlistingid_index: "SoldItem" ("yourListingId")

---

### SoldItemSeller (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| name | text | - | NO |
| enabled | boolean | true | YES |
| itemsScraped | integer | 0 | YES |
| lastScrapedAt | timestamp with time zone | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| type | text | 'competitor'::text | NO |

**Indexes:**
- (unique) SoldItemSeller_pkey: "SoldItemSeller" (name)
- idx_sold_item_seller_enabled: "SoldItemSeller" (enabled)
- idx_sold_item_seller_type: "SoldItemSeller" (type)

---

### User (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('"User_id_seq"'::regclass) | NO |
| firstName | text | - | NO |
| lastName | text | - | NO |
| email | text | - | NO |
| imageUrl | text | - | YES |
| isAdmin | boolean | - | YES |
| isVerified | boolean | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| canSeePrice | boolean | true | YES |

**Indexes:**
- (unique) User_pkey: "User" (id)

---

### YourListing (4,733 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| ebayItemId | text | - | NO |
| title | text | - | YES |
| sku | text | - | YES |
| quantityAvailable | integer | - | YES |
| currentPrice | numeric | - | YES |
| listingStatus | text | - | YES |
| startTime | timestamp with time zone | - | YES |
| viewItemUrl | text | - | YES |
| syncedAt | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| priceCheckOmitted | boolean | false | NO |
| store | text | 'dynatrack'::text | YES |
| isProgrammed | boolean | false | YES |
| partNumberBase | text | - | YES |
| partType | text | - | YES |
| extractedMake | text | - | YES |
| extractedModel | text | - | YES |

**Indexes:**
- (unique) YourListing_pkey: "YourListing" (id)
- idx_your_listing_item_id: "YourListing" ("ebayItemId")
- idx_your_listing_start_time: "YourListing" ("startTime")
- idx_yourlisting_make: "YourListing" ("extractedMake")
- idx_yourlisting_parttype: "YourListing" ("partType")
- idx_yourlisting_pnbase: "YourListing" ("partNumberBase")
- (unique) yourlisting_ebayitemid_unique: "YourListing" ("ebayItemId")

---

### YourSale (14,608 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| ebayOrderId | text | - | NO |
| ebayItemId | text | - | YES |
| title | text | - | YES |
| sku | text | - | YES |
| quantity | integer | - | YES |
| salePrice | numeric | - | YES |
| soldDate | timestamp with time zone | - | YES |
| buyerUsername | text | - | YES |
| shippedDate | timestamp with time zone | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| store | text | 'dynatrack'::text | YES |
| partNumberBase | text | - | YES |
| partType | text | - | YES |
| extractedMake | text | - | YES |
| extractedModel | text | - | YES |

**Indexes:**
- (unique) YourSale_pkey: "YourSale" (id)
- idx_your_sale_item_id: "YourSale" ("ebayItemId")
- idx_your_sale_sold_date: "YourSale" ("soldDate")
- idx_yoursale_parttype: "YourSale" ("partType")
- idx_yoursale_pnbase: "YourSale" ("partNumberBase")
- (unique) yoursale_ebayorderid_unique: "YourSale" ("ebayOrderId")

---

### ai_vehicle_research (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('ai_vehicle_research_id_seq'::re | NO |
| year | integer | - | YES |
| make | character varying(50) | - | YES |
| model | character varying(100) | - | YES |
| engine | character varying(50) | - | YES |
| research | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) ai_vehicle_research_pkey: ai_vehicle_research (id)
- (unique) ai_vehicle_research_year_make_model_unique: ai_vehicle_research (year, make, model)

---

### competitor_alert (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| competitor_seller | text | - | YES |
| part_number_base | text | - | YES |
| title | text | - | YES |
| alert_type | text | - | NO |
| our_price | numeric | - | YES |
| competitor_price | numeric | - | YES |
| market_avg | numeric | - | YES |
| recommendation | text | - | YES |
| dismissed | boolean | false | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- competitor_alert_alert_type_index: competitor_alert (alert_type)
- competitor_alert_competitor_seller_index: competitor_alert (competitor_seller)
- competitor_alert_dismissed_index: competitor_alert (dismissed)
- (unique) competitor_alert_pkey: competitor_alert (id)

---

### dead_inventory (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_number_exact | text | - | YES |
| part_number_base | text | - | YES |
| description | text | - | YES |
| vehicle_application | text | - | YES |
| date_pulled | date | - | YES |
| date_listed | date | - | YES |
| days_listed | integer | - | YES |
| sold | boolean | false | YES |
| final_price | numeric | - | YES |
| market_avg_at_time | numeric | - | YES |
| price_vs_market | numeric | - | YES |
| condition_grade | text | - | YES |
| failure_reason | text | - | YES |
| notes | text | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) dead_inventory_pkey: dead_inventory (id)
- idx_dead_inventory_part_base: dead_inventory (part_number_base)

---

### dismissed_intel (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| normalizedTitle | text | - | NO |
| originalTitle | text | - | YES |
| dismissedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) dismissed_intel_pkey: dismissed_intel ("normalizedTitle")

---

### dismissed_opportunity (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('dismissed_opportunity_id_seq':: | NO |
| opportunity_key | text | - | NO |
| original_title | text | - | YES |
| dismissed_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) dismissed_opportunity_opportunity_key_unique: dismissed_opportunity (opportunity_key)
- (unique) dismissed_opportunity_pkey: dismissed_opportunity (id)

---

### ebay_message_queue (121 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| order_id | character varying(64) | - | NO |
| item_id | character varying(64) | - | NO |
| buyer_user_id | character varying(128) | - | NO |
| template_key | character varying(32) | - | NO |
| scheduled_at | timestamp with time zone | - | NO |
| status | character varying(16) | 'pending'::character varying | NO |
| claimed_by | character varying(64) | - | YES |
| claimed_at | timestamp with time zone | - | YES |
| return_id | character varying(64) | - | YES |
| ebay_store | character varying(64) | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) ebay_message_queue_pkey: ebay_message_queue (id)
- (unique) idx_message_queue_idempotent: ebay_message_queue (order_id, template_key)
- idx_message_queue_pending: ebay_message_queue (scheduled_at) WHERE ((status)::text = 'pending'::text)

---

### ebay_message_templates (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('ebay_message_templates_id_seq': | NO |
| template_key | character varying(32) | - | NO |
| subject | text | - | YES |
| body | text | - | NO |
| is_active | boolean | true | YES |
| api_target | character varying(32) | 'trading'::character varying | NO |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) ebay_message_templates_pkey: ebay_message_templates (id)
- (unique) ebay_message_templates_template_key_unique: ebay_message_templates (template_key)

---

### ebay_messages (55 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| order_id | character varying(64) | - | NO |
| item_id | character varying(64) | - | NO |
| buyer_user_id | character varying(128) | - | NO |
| template_key | character varying(32) | - | NO |
| subject | text | - | YES |
| body | text | - | NO |
| rendered_body | text | - | YES |
| sent_at | timestamp with time zone | - | YES |
| status | character varying(16) | 'pending'::character varying | NO |
| error_code | character varying(32) | - | YES |
| error_detail | text | - | YES |
| api_response | text | - | YES |
| retry_count | integer | 0 | YES |
| ebay_store | character varying(64) | - | YES |
| trigger_source | character varying(32) | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) ebay_messages_pkey: ebay_messages (id)
- idx_ebay_messages_buyer: ebay_messages (buyer_user_id)
- (unique) idx_ebay_messages_idempotent: ebay_messages (order_id, template_key)
- idx_ebay_messages_order: ebay_messages (order_id)
- idx_ebay_messages_status: ebay_messages (status)
- idx_ebay_messages_template: ebay_messages (template_key, sent_at)

---

### fitment_data (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('fitment_data_id_seq'::regclass) | NO |
| part_number | character varying(100) | - | NO |
| part_number_base | character varying(100) | - | YES |
| part_name | character varying(200) | - | YES |
| category | character varying(50) | - | YES |
| year_start | integer | - | YES |
| year_end | integer | - | YES |
| makes | ARRAY | - | YES |
| models | ARRAY | - | YES |
| engines | ARRAY | - | YES |
| fits_vehicles | jsonb | - | YES |
| does_not_fit | text | - | YES |
| does_not_fit_vehicles | jsonb | - | YES |
| drivetrain_specific | text | - | YES |
| transmission_specific | text | - | YES |
| engine_specific | text | - | YES |
| programming_required | character varying(20) | - | YES |
| programming_note | text | - | YES |
| programming_tool | text | - | YES |
| installation_notes | text | - | YES |
| installation_warning | text | - | YES |
| confidence | character varying(20) | 'low'::character varying | YES |
| source | character varying(50) | - | YES |
| sources_checked | ARRAY | - | YES |
| confirmed_by | character varying(50) | - | YES |
| confirmed_count | integer | 0 | YES |
| created_at | timestamp without time zone | now() | YES |
| updated_at | timestamp without time zone | now() | YES |
| last_scraped_at | timestamp without time zone | - | YES |

**Indexes:**
- (unique) fitment_data_part_number_key: fitment_data (part_number)
- (unique) fitment_data_pkey: fitment_data (id)
- idx_fitment_base: fitment_data (part_number_base)
- idx_fitment_category: fitment_data (category)
- idx_fitment_confidence: fitment_data (confidence)
- idx_fitment_make: fitment_data USING gin (makes)
- idx_fitment_pn: fitment_data (part_number)

---

### fitment_intelligence (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_type | text | - | NO |
| make | text | - | NO |
| model | text | - | NO |
| year_start | integer | - | NO |
| year_end | integer | - | NO |
| fits_trims | jsonb | '[]'::jsonb | YES |
| fits_engines | jsonb | '[]'::jsonb | YES |
| fits_transmissions | jsonb | '[]'::jsonb | YES |
| does_not_fit_trims | jsonb | '[]'::jsonb | YES |
| does_not_fit_engines | jsonb | '[]'::jsonb | YES |
| does_not_fit_transmissions | jsonb | '[]'::jsonb | YES |
| part_number_variants | jsonb | '{}'::jsonb | YES |
| negation_text | text | - | YES |
| part_number_warning | text | - | YES |
| source_seller | text | - | YES |
| source_listings | jsonb | '[]'::jsonb | YES |
| confidence | text | 'low'::text | YES |
| scraped_at | timestamp without time zone | now() | YES |
| created_at | timestamp without time zone | now() | YES |
| updated_at | timestamp without time zone | now() | YES |

**Indexes:**
- (unique) fitment_intelligence_part_type_make_model_year_start_year_e_key: fitment_intelligence (part_type, make, model, year_start, year_end)
- (unique) fitment_intelligence_pkey: fitment_intelligence (id)
- idx_fitment_lookup: fitment_intelligence (make, model, part_type)
- idx_fitment_year: fitment_intelligence (year_start, year_end)

---

### fitment_scrape_queue (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('fitment_scrape_queue_id_seq'::r | NO |
| part_number | character varying(100) | - | NO |
| part_number_base | character varying(100) | - | YES |
| category | character varying(50) | - | YES |
| priority | integer | 50 | YES |
| sales_count | integer | 0 | YES |
| status | character varying(20) | 'pending'::character varying | YES |
| attempts | integer | 0 | YES |
| last_attempt_at | timestamp without time zone | - | YES |
| completed_at | timestamp without time zone | - | YES |
| error_message | text | - | YES |
| created_at | timestamp without time zone | now() | YES |

**Indexes:**
- (unique) fitment_scrape_queue_part_number_key: fitment_scrape_queue (part_number)
- (unique) fitment_scrape_queue_pkey: fitment_scrape_queue (id)
- idx_scrape_queue_pn: fitment_scrape_queue (part_number)
- idx_scrape_queue_status: fitment_scrape_queue (status, priority DESC)

---

### flyway_trip (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('flyway_trip_id_seq'::regclass) | NO |
| name | character varying(255) | - | NO |
| start_date | date | - | NO |
| end_date | date | - | NO |
| status | character varying(20) | 'planning'::character varying | NO |
| notes | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| trip_type | character varying(20) | 'road_trip'::character varying | NO |
| completed_at | timestamp with time zone | - | YES |
| cleaned_up | boolean | false | YES |

**Indexes:**
- (unique) flyway_trip_pkey: flyway_trip (id)
- flyway_trip_status_index: flyway_trip (status)

---

### flyway_trip_yard (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('flyway_trip_yard_id_seq'::regcl | NO |
| trip_id | integer | - | NO |
| yard_id | uuid | - | NO |
| scrape_enabled | boolean | true | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Foreign Keys:** trip_id → flyway_trip.id, yard_id → yard.id

**Indexes:**
- (unique) flyway_trip_yard_pkey: flyway_trip_yard (id)
- flyway_trip_yard_trip_id_index: flyway_trip_yard (trip_id)
- (unique) flyway_trip_yard_trip_id_yard_id_unique: flyway_trip_yard (trip_id, yard_id)

---

### instant_research_cache (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('instant_research_cache_id_seq': | NO |
| vehicle_key | character varying(200) | - | NO |
| vehicle_display | character varying(200) | - | YES |
| results | jsonb | - | YES |
| last_updated | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) instant_research_cache_pkey: instant_research_cache (id)
- (unique) instant_research_cache_vehicle_key_unique: instant_research_cache (vehicle_key)

---

### knex_migrations (3 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('knex_migrations_id_seq'::regcla | NO |
| name | character varying(255) | - | YES |
| batch | integer | - | YES |
| migration_time | timestamp with time zone | - | YES |

**Indexes:**
- (unique) knex_migrations_pkey: knex_migrations (id)

---

### knex_migrations_lock (1 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| index | integer | nextval('knex_migrations_lock_index_seq' | NO |
| is_locked | integer | - | YES |

**Indexes:**
- (unique) knex_migrations_lock_pkey: knex_migrations_lock (index)

---

### market_demand_cache (594 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_number_base | text | - | NO |
| ebay_sold_90d | integer | 0 | YES |
| ebay_avg_price | numeric | - | YES |
| ebay_active_listings | integer | 0 | YES |
| market_score | numeric | - | YES |
| last_updated | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| ebay_sold_30d | numeric | '0'::numeric | YES |
| seasonal_weight | numeric | '1'::numeric | YES |
| source | character varying(20) | 'playwright'::character varying | YES |
| search_query | text | - | YES |
| ebay_median_price | numeric | - | YES |
| ebay_min_price | numeric | - | YES |
| ebay_max_price | numeric | - | YES |
| market_velocity | character varying(20) | - | YES |
| sales_per_week | numeric | - | YES |
| top_comps | jsonb | - | YES |
| key_type | character varying(10) | 'pn'::character varying | YES |

**Indexes:**
- idx_market_demand_part: market_demand_cache (part_number_base)
- idx_market_demand_updated: market_demand_cache (last_updated)
- idx_mdc_key_type: market_demand_cache (key_type)
- (unique) market_demand_cache_part_number_base_unique: market_demand_cache (part_number_base)
- (unique) market_demand_cache_pkey: market_demand_cache (id)

---

### overstock_group (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('overstock_group_id_seq'::regcla | NO |
| name | character varying(256) | - | NO |
| part_type | character varying(128) | - | YES |
| restock_target | integer | 1 | NO |
| current_stock | integer | 0 | YES |
| initial_stock | integer | - | NO |
| group_type | character varying(32) | 'multi'::character varying | YES |
| status | character varying(32) | 'watching'::character varying | YES |
| triggered_at | timestamp with time zone | - | YES |
| acknowledged_at | timestamp with time zone | - | YES |
| notes | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- idx_overstock_group_status: overstock_group (status)
- (unique) overstock_group_pkey: overstock_group (id)

---

### overstock_group_item (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('overstock_group_item_id_seq'::r | NO |
| group_id | integer | - | NO |
| ebay_item_id | character varying(64) | - | NO |
| title | character varying(512) | - | YES |
| current_price | numeric | - | YES |
| is_active | boolean | true | YES |
| added_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Foreign Keys:** group_id → overstock_group.id

**Indexes:**
- idx_overstock_item_ebay_id: overstock_group_item (ebay_item_id)
- idx_overstock_item_group_id: overstock_group_item (group_id)
- (unique) overstock_group_item_group_id_ebay_item_id_unique: overstock_group_item (group_id, ebay_item_id)
- (unique) overstock_group_item_pkey: overstock_group_item (id)

---

### part_fitment_cache (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('part_fitment_cache_id_seq'::reg | NO |
| part_number_exact | character varying(50) | - | NO |
| part_number_base | character varying(50) | - | NO |
| part_name | text | - | YES |
| part_type | character varying(30) | - | YES |
| year | integer | - | YES |
| year_range | character varying(20) | - | YES |
| make | character varying(50) | - | YES |
| model | character varying(50) | - | YES |
| engine | character varying(50) | - | YES |
| trim | character varying(50) | - | YES |
| drivetrain | character varying(30) | - | YES |
| does_not_fit | text | - | YES |
| programming_required | character varying(20) | - | YES |
| programming_note | text | - | YES |
| source | character varying(30) | 'listing_tool'::character varying | YES |
| confirmed_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- idx_pfc_make_model: part_fitment_cache (make, model)
- idx_pfc_pn_base: part_fitment_cache (part_number_base)
- (unique) part_fitment_cache_part_number_base_unique: part_fitment_cache (part_number_base)
- (unique) part_fitment_cache_pkey: part_fitment_cache (id)

---

### part_location (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_type | text | - | NO |
| year_start | integer | - | YES |
| year_end | integer | - | YES |
| make | text | - | YES |
| model | text | - | YES |
| trim | text | - | YES |
| location_text | text | - | YES |
| removal_steps | jsonb | '[]'::jsonb | YES |
| tools | text | - | YES |
| hazards | text | - | YES |
| avg_pull_minutes | integer | - | YES |
| photo_url | text | - | YES |
| confirmed_count | integer | 0 | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| body_style | text | - | YES |
| confidence | text | 'researched'::text | YES |

**Indexes:**
- idx_part_location_lookup: part_location (part_type, make, model)
- (unique) part_location_pkey: part_location (id)

---

### platform_group (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('platform_group_id_seq'::regclas | NO |
| name | character varying(100) | - | NO |
| platform | character varying(100) | - | NO |
| year_start | integer | - | NO |
| year_end | integer | - | NO |
| notes | text | - | YES |
| created_at | timestamp without time zone | now() | YES |

**Indexes:**
- (unique) platform_group_name_key: platform_group (name)
- (unique) platform_group_pkey: platform_group (id)

---

### platform_shared_part (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('platform_shared_part_id_seq'::r | NO |
| platform_group_id | integer | - | NO |
| part_type | character varying(50) | - | NO |
| confidence | character varying(20) | 'high'::character varying | YES |
| notes | text | - | YES |

**Foreign Keys:** platform_group_id → platform_group.id

**Indexes:**
- idx_platform_shared_part_group: platform_shared_part (platform_group_id)
- (unique) platform_shared_part_pkey: platform_shared_part (id)
- (unique) platform_shared_part_platform_group_id_part_type_key: platform_shared_part (platform_group_id, part_type)

---

### platform_vehicle (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('platform_vehicle_id_seq'::regcl | NO |
| platform_group_id | integer | - | NO |
| make | character varying(50) | - | NO |
| model | character varying(100) | - | NO |
| year_start | integer | - | YES |
| year_end | integer | - | YES |
| created_at | timestamp without time zone | now() | YES |

**Foreign Keys:** platform_group_id → platform_group.id

**Indexes:**
- idx_platform_vehicle_group: platform_vehicle (platform_group_id)
- idx_platform_vehicle_make_model: platform_vehicle (make, model)
- (unique) platform_vehicle_pkey: platform_vehicle (id)
- (unique) platform_vehicle_platform_group_id_make_model_key: platform_vehicle (platform_group_id, make, model)

---

### programming_reference (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('programming_reference_id_seq':: | NO |
| brand_group | text | - | NO |
| module_type | text | - | NO |
| year | integer | - | NO |
| required | character varying(10) | - | NO |
| notes | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- idx_prog_ref_group_module: programming_reference (brand_group, module_type)
- (unique) idx_prog_ref_lookup: programming_reference (brand_group, module_type, year)
- (unique) programming_reference_pkey: programming_reference (id)

---

### pull_session (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| yard_id | uuid | - | YES |
| puller_id | text | - | YES |
| date | date | - | NO |
| parts_cost | numeric | '0'::numeric | YES |
| gate_fee | numeric | '0'::numeric | YES |
| tax_paid | numeric | '0'::numeric | YES |
| mileage | numeric | '0'::numeric | YES |
| mileage_cost | numeric | '0'::numeric | YES |
| total_true_cogs | numeric | '0'::numeric | YES |
| total_market_value | numeric | '0'::numeric | YES |
| blended_cogs_pct | numeric | '0'::numeric | YES |
| yield_rating | integer | - | YES |
| notes | text | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** yard_id → yard.id

**Indexes:**
- (unique) pull_session_pkey: pull_session (id)

---

### restock_flag (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_number_base | text | - | NO |
| title | text | - | YES |
| category | text | - | YES |
| sold_90d | integer | 0 | YES |
| sold_30d | integer | 0 | YES |
| active_stock | integer | 0 | YES |
| avg_sold_price | numeric | - | YES |
| avg_days_to_sell | numeric | - | YES |
| restock_score | numeric | - | YES |
| store | text | 'all'::text | YES |
| acknowledged | boolean | false | YES |
| last_checked | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) idx_restock_unique: restock_flag (part_number_base, store)
- restock_flag_acknowledged_index: restock_flag (acknowledged)
- (unique) restock_flag_pkey: restock_flag (id)
- restock_flag_restock_score_index: restock_flag (restock_score)

---

### restock_want_list (1,145 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('restock_want_list_id_seq'::regc | NO |
| title | text | - | NO |
| notes | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| active | boolean | true | YES |
| pulled | boolean | false | YES |
| pulled_date | timestamp with time zone | - | YES |
| pulled_from | text | - | YES |
| auto_generated | boolean | false | YES |

**Indexes:**
- (unique) restock_want_list_pkey: restock_want_list (id)

---

### restock_watchlist (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('restock_watchlist_id_seq'::regc | NO |
| part_number_base | character varying(50) | - | NO |
| part_description | text | - | YES |
| target_stock | integer | 1 | YES |
| priority | character varying(20) | 'normal'::character varying | YES |
| notes | text | - | YES |
| added_at | timestamp without time zone | now() | YES |
| active | boolean | true | YES |

**Indexes:**
- (unique) restock_watchlist_part_number_base_key: restock_watchlist (part_number_base)
- (unique) restock_watchlist_pkey: restock_watchlist (id)

---

### return_intake (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| ebay_item_id | text | - | YES |
| listing_id | text | - | YES |
| title | text | - | YES |
| part_number | text | - | YES |
| sku | text | - | YES |
| puller_name | text | - | YES |
| yard_name | text | - | YES |
| vehicle_info | text | - | YES |
| condition_grade | text | - | NO |
| condition_notes | text | - | YES |
| original_price | numeric | - | YES |
| relist_price | numeric | - | YES |
| relist_status | text | 'pending'::text | YES |
| relist_ebay_item_id | text | - | YES |
| returned_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| relisted_at | timestamp with time zone | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- return_intake_condition_grade_index: return_intake (condition_grade)
- (unique) return_intake_pkey: return_intake (id)
- return_intake_relist_status_index: return_intake (relist_status)

---

### return_transaction (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('return_transaction_id_seq'::reg | NO |
| transaction_date | date | - | NO |
| order_number | character varying(80) | - | YES |
| legacy_order_id | character varying(80) | - | YES |
| buyer_username | character varying(80) | - | YES |
| buyer_name | character varying(120) | - | YES |
| ship_city | character varying(80) | - | YES |
| ship_state | character varying(80) | - | YES |
| ship_zip | character varying(30) | - | YES |
| ship_country | character varying(30) | - | YES |
| net_amount | numeric | - | YES |
| gross_amount | numeric | - | YES |
| ebay_item_id | character varying(80) | - | YES |
| transaction_id | character varying(80) | - | YES |
| item_title | character varying(300) | - | YES |
| custom_label | character varying(80) | - | YES |
| item_subtotal | numeric | - | YES |
| shipping_handling | numeric | - | YES |
| fvf_fixed | numeric | - | YES |
| fvf_variable | numeric | - | YES |
| regulatory_fee | numeric | - | YES |
| inad_fee | numeric | - | YES |
| international_fee | numeric | - | YES |
| reference_id | character varying(80) | - | YES |
| payout_id | character varying(80) | - | YES |
| part_type | character varying(40) | - | YES |
| make | character varying(30) | - | YES |
| is_formal_return | boolean | false | YES |
| has_inad_fee | boolean | false | YES |
| abs_gross | numeric | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- idx_return_tx_buyer_gross: return_transaction (buyer_username, abs_gross)
- idx_return_tx_make_date: return_transaction (make, transaction_date)
- idx_return_tx_part_type_date: return_transaction (part_type, transaction_date)
- return_transaction_buyer_username_index: return_transaction (buyer_username)
- return_transaction_custom_label_index: return_transaction (custom_label)
- return_transaction_make_index: return_transaction (make)
- return_transaction_part_type_index: return_transaction (part_type)
- (unique) return_transaction_pkey: return_transaction (id)
- return_transaction_ship_state_index: return_transaction (ship_state)
- return_transaction_transaction_date_index: return_transaction (transaction_date)

---

### scout_alerts (20,100 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('scout_alerts_id_seq'::regclass) | NO |
| source | character varying(20) | - | NO |
| source_title | text | - | NO |
| part_value | numeric | - | YES |
| yard_name | character varying(255) | - | YES |
| vehicle_year | character varying(10) | - | YES |
| vehicle_make | character varying(100) | - | YES |
| vehicle_model | character varying(100) | - | YES |
| vehicle_color | character varying(100) | - | YES |
| row | character varying(50) | - | YES |
| confidence | character varying(10) | - | NO |
| notes | text | - | YES |
| vehicle_set_date | date | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| claimed | boolean | false | YES |
| claimed_by | text | - | YES |
| claimed_at | timestamp with time zone | - | YES |

**Indexes:**
- (unique) scout_alerts_pkey: scout_alerts (id)

---

### scout_alerts_meta (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| key | character varying(50) | - | NO |
| value | text | - | YES |

**Indexes:**
- (unique) scout_alerts_meta_pkey: scout_alerts_meta (key)

---

### scrape_log (22 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| yard_id | uuid | - | YES |
| scraped_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| vehicles_found | integer | 0 | YES |
| new_vehicles | integer | 0 | YES |
| pages_scraped | integer | 0 | YES |
| termination_reason | text | - | YES |
| source | text | 'local'::text | YES |

**Foreign Keys:** yard_id → yard.id

**Indexes:**
- (unique) scrape_log_pkey: scrape_log (id)
- scrape_log_scraped_at_index: scrape_log (scraped_at)
- scrape_log_yard_id_index: scrape_log (yard_id)

---

### sky_watch_research (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('sky_watch_research_id_seq'::reg | NO |
| vehicle_year | integer | - | NO |
| vehicle_make | character varying(64) | - | NO |
| vehicle_model | character varying(128) | - | NO |
| vehicle_engine | character varying(128) | - | YES |
| vehicle_trim | character varying(128) | - | YES |
| source | character varying(32) | - | NO |
| source_vin | character varying(17) | - | YES |
| results | jsonb | - | NO |
| total_estimated_value | numeric | - | YES |
| parts_found_count | integer | 0 | YES |
| high_value_count | integer | 0 | YES |
| status | character varying(32) | 'new'::character varying | YES |
| reviewed_at | timestamp with time zone | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- (unique) sky_watch_research_pkey: sky_watch_research (id)
- sky_watch_research_status_index: sky_watch_research (status)
- sky_watch_research_vehicle_make_vehicle_model_index: sky_watch_research (vehicle_make, vehicle_model)
- (unique) sky_watch_research_vehicle_year_vehicle_make_vehicle_model_vehi: sky_watch_research (vehicle_year, vehicle_make, vehicle_model, vehicle_engine)

---

### stale_inventory_action (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| ebay_item_id | text | - | NO |
| listing_id | text | - | YES |
| title | text | - | YES |
| action_type | text | - | NO |
| old_price | numeric | - | YES |
| new_price | numeric | - | YES |
| days_listed | integer | - | YES |
| tier | text | - | YES |
| programmed_listing | boolean | false | YES |
| executed | boolean | false | YES |
| execution_error | text | - | YES |
| notes | text | - | YES |
| scheduled_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| executed_at | timestamp with time zone | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- stale_inventory_action_action_type_index: stale_inventory_action (action_type)
- stale_inventory_action_ebay_item_id_index: stale_inventory_action (ebay_item_id)
- stale_inventory_action_executed_index: stale_inventory_action (executed)
- (unique) stale_inventory_action_pkey: stale_inventory_action (id)

---

### the_cache (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| part_type | character varying(100) | - | YES |
| part_description | text | - | YES |
| part_number | character varying(100) | - | YES |
| vehicle_year | integer | - | YES |
| vehicle_make | character varying(100) | - | YES |
| vehicle_model | character varying(100) | - | YES |
| vehicle_trim | character varying(100) | - | YES |
| vehicle_vin | character varying(17) | - | YES |
| yard_name | character varying(200) | - | YES |
| row_number | character varying(50) | - | YES |
| estimated_value | numeric | - | YES |
| price_source | character varying(50) | - | YES |
| claimed_by | character varying(100) | 'ry'::character varying | YES |
| claimed_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| source | character varying(50) | - | NO |
| source_id | character varying(255) | - | YES |
| status | character varying(30) | 'claimed'::character varying | YES |
| resolved_at | timestamp with time zone | - | YES |
| resolved_by | character varying(50) | - | YES |
| ebay_item_id | character varying(50) | - | YES |
| notes | text | - | YES |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |

**Indexes:**
- idx_cache_claimed_at: the_cache (claimed_at)
- idx_cache_part_number: the_cache (part_number)
- idx_cache_source: the_cache (source, source_id)
- idx_cache_status: the_cache (status)
- idx_cache_vehicle: the_cache (vehicle_make, vehicle_model, vehicle_year)
- (unique) the_cache_pkey: the_cache (id)

---

### the_mark (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| normalizedTitle | text | - | NO |
| originalTitle | text | - | NO |
| partNumber | text | - | YES |
| partType | text | - | YES |
| medianPrice | integer | - | YES |
| sourceSignal | text | - | YES |
| sourceSellers | ARRAY | - | YES |
| scoreAtMark | integer | - | YES |
| notes | text | - | YES |
| active | boolean | true | YES |
| graduatedAt | timestamp with time zone | - | YES |
| graduatedReason | text | - | YES |
| markedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| source | character varying(32) | 'PERCH'::character varying | YES |
| match_confidence | character varying(16) | - | YES |
| matched_yard_vehicle_id | integer | - | YES |
| matched_at | timestamp with time zone | - | YES |

**Indexes:**
- the_mark_active_index: the_mark (active)
- the_mark_markedat_index: the_mark ("markedAt")
- (unique) the_mark_normalizedtitle_unique: the_mark ("normalizedTitle")
- the_mark_parttype_index: the_mark ("partType")
- (unique) the_mark_pkey: the_mark (id)

---

### trim_catalog (116 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('trim_catalog_id_seq'::regclass) | NO |
| year | integer | - | NO |
| make | text | - | NO |
| model | text | - | NO |
| trim_raw | text | - | NO |
| trim_name | text | - | NO |
| body_style | text | - | YES |
| tier | text | - | NO |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- idx_trim_catalog_tier: trim_catalog (tier)
- (unique) idx_trim_catalog_unique: trim_catalog (year, make, model, trim_raw)
- idx_trim_catalog_ymm: trim_catalog (year, make, model)
- (unique) trim_catalog_pkey: trim_catalog (id)

---

### trim_catalog_tracked (23 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('trim_catalog_tracked_id_seq'::r | NO |
| year | integer | - | NO |
| make | text | - | NO |
| model | text | - | NO |
| trim_count | integer | 0 | YES |
| cataloged_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) idx_trim_tracked_ymm: trim_catalog_tracked (year, make, model)
- (unique) trim_catalog_tracked_pkey: trim_catalog_tracked (id)

---

### trim_intelligence (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| year | integer | - | NO |
| make | text | - | NO |
| model | text | - | NO |
| trim | text | - | NO |
| expected_parts | jsonb | '[]'::jsonb | YES |
| confidence | text | 'low'::text | YES |
| researched_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) idx_trim_intelligence_unique: trim_intelligence (year, make, model, "trim")
- (unique) trim_intelligence_pkey: trim_intelligence (id)

---

### trim_tier_reference (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('trim_tier_reference_id_seq'::re | NO |
| make | text | - | NO |
| model | text | - | NO |
| gen_start | integer | - | NO |
| gen_end | integer | - | NO |
| trim | text | - | NO |
| tier | integer | - | NO |
| tier_name | text | - | YES |
| top_engine | text | - | YES |
| audio_brand | text | - | YES |
| expected_parts | text | - | YES |
| notes | text | - | YES |
| cult | boolean | false | YES |
| transmission | text | - | YES |
| diesel | boolean | false | YES |

**Indexes:**
- idx_ttr_make_model: trim_tier_reference (lower(make), lower(model))
- idx_ttr_years: trim_tier_reference (gen_start, gen_end)
- (unique) trim_tier_reference_pkey: trim_tier_reference (id)

---

### trim_value_validation (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| make | character varying(100) | - | NO |
| part_type | character varying(100) | - | NO |
| premium_keyword | character varying(200) | - | NO |
| premium_avg_price | numeric | - | YES |
| base_avg_price | numeric | - | YES |
| delta | numeric | - | NO |
| n_premium | integer | 0 | YES |
| n_base | integer | 0 | YES |
| verdict | character varying(20) | - | NO |
| source | character varying(20) | 'YOUR_DATA'::character varying | NO |
| validated_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| created_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updated_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- (unique) trim_value_validation_make_part_type_premium_keyword_unique: trim_value_validation (make, part_type, premium_keyword)
- trim_value_validation_make_verdict_index: trim_value_validation (make, verdict)
- (unique) trim_value_validation_pkey: trim_value_validation (id)
- trim_value_validation_verdict_index: trim_value_validation (verdict)

---

### vin_cache (421 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | gen_random_uuid() | NO |
| vin | text | - | NO |
| year | integer | - | YES |
| make | text | - | YES |
| model | text | - | YES |
| trim | text | - | YES |
| engine | text | - | YES |
| drivetrain | text | - | YES |
| body_style | text | - | YES |
| paint_code | text | - | YES |
| raw_nhtsa | jsonb | '{}'::jsonb | YES |
| raw_enriched | jsonb | '{}'::jsonb | YES |
| decoded_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Indexes:**
- idx_vin_cache_vin: vin_cache (vin)
- (unique) vin_cache_pkey: vin_cache (id)
- (unique) vin_cache_vin_unique: vin_cache (vin)

---

### vin_scan_log (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | integer | nextval('vin_scan_log_id_seq'::regclass) | NO |
| vin | character varying(17) | - | NO |
| year | integer | - | YES |
| make | character varying(50) | - | YES |
| model | character varying(100) | - | YES |
| trim | character varying(100) | - | YES |
| engine | character varying(50) | - | YES |
| engine_type | character varying(20) | - | YES |
| drivetrain | character varying(20) | - | YES |
| paint_code | character varying(20) | - | YES |
| scanned_by | character varying(50) | - | YES |
| scanned_at | timestamp with time zone | CURRENT_TIMESTAMP | YES |
| source | character varying(20) | 'manual'::character varying | YES |
| notes | text | - | YES |

**Indexes:**
- (unique) vin_scan_log_pkey: vin_scan_log (id)
- vin_scan_log_scanned_at_index: vin_scan_log (scanned_at)
- vin_scan_log_vin_index: vin_scan_log (vin)

---

### yard (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| name | character varying(255) | - | NO |
| chain | character varying(100) | - | YES |
| address | character varying(500) | - | YES |
| lat | numeric | - | YES |
| lng | numeric | - | YES |
| distance_from_base | numeric | - | YES |
| entry_fee | numeric | '0'::numeric | YES |
| tax_rate | numeric | '0'::numeric | YES |
| scrape_url | character varying(1000) | - | YES |
| scrape_method | character varying(50) | 'none'::character varying | YES |
| last_scraped | timestamp with time zone | - | YES |
| last_visited | timestamp with time zone | - | YES |
| avg_yield | numeric | - | YES |
| avg_rating | numeric | - | YES |
| flagged | boolean | false | YES |
| flag_reason | text | - | YES |
| enabled | boolean | true | YES |
| visit_frequency | character varying(50) | 'local'::character varying | YES |
| notes | text | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| entry_fee_notes | text | - | YES |
| region | character varying(20) | 'nc'::character varying | YES |

**Indexes:**
- yard_chain_index: yard (chain)
- yard_enabled_index: yard (enabled)
- yard_flagged_index: yard (flagged)
- (unique) yard_pkey: yard (id)
- yard_visit_frequency_index: yard (visit_frequency)

---

### yard_vehicle (12,075 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| yard_id | uuid | - | YES |
| year | character varying(10) | - | YES |
| make | character varying(100) | - | YES |
| model | character varying(100) | - | YES |
| trim | character varying(100) | - | YES |
| color | character varying(100) | - | YES |
| row_number | character varying(50) | - | YES |
| vin | character varying(20) | - | YES |
| date_added | date | - | YES |
| scraped_at | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| active | boolean | true | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| updatedAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |
| first_seen | timestamp with time zone | - | YES |
| last_seen | timestamp with time zone | - | YES |
| stock_number | character varying(30) | - | YES |
| engine | character varying(50) | - | YES |
| engine_type | character varying(20) | - | YES |
| drivetrain | character varying(20) | - | YES |
| trim_level | character varying(100) | - | YES |
| body_style | character varying(50) | - | YES |
| vin_decoded | boolean | false | YES |
| decoded_trim | text | - | YES |
| decoded_engine | text | - | YES |
| decoded_drivetrain | text | - | YES |
| trim_tier | text | - | YES |
| vin_decoded_at | timestamp with time zone | - | YES |
| audio_brand | text | - | YES |
| expected_parts | text | - | YES |
| cult | boolean | false | YES |
| decoded_transmission | text | - | YES |
| transmission_speeds | text | - | YES |
| diesel | boolean | false | YES |

**Foreign Keys:** yard_id → yard.id

**Indexes:**
- (unique) idx_yard_vehicle_stock_yard: yard_vehicle (stock_number, yard_id)
- yard_vehicle_active_index: yard_vehicle (active)
- yard_vehicle_date_added_index: yard_vehicle (date_added)
- (unique) yard_vehicle_pkey: yard_vehicle (id)
- yard_vehicle_scraped_at_index: yard_vehicle (scraped_at)
- yard_vehicle_yard_id_index: yard_vehicle (yard_id)
- yard_vehicle_year_make_model_index: yard_vehicle (year, make, model)

---

### yard_visit_feedback (0 rows)

| Column | Type | Default | Nullable |
|--------|------|---------|----------|
| id | uuid | - | NO |
| yard_id | uuid | - | YES |
| puller_name | character varying(255) | - | YES |
| visit_date | date | - | NO |
| rating | integer | - | YES |
| notes | text | - | YES |
| createdAt | timestamp with time zone | CURRENT_TIMESTAMP | NO |

**Foreign Keys:** yard_id → yard.id

**Indexes:**
- (unique) yard_visit_feedback_pkey: yard_visit_feedback (id)
- yard_visit_feedback_visit_date_index: yard_visit_feedback (visit_date)
- yard_visit_feedback_yard_id_index: yard_visit_feedback (yard_id)

---

