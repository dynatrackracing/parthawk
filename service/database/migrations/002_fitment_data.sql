-- Migration: Fitment Data Table
-- Purpose: Store deep-scraped fitment data from RockAuto, OEM catalogs, and lister confirmations
-- This is WHERE the "does not fit" exclusion data lives
-- 
-- Sources that populate this table:
-- 1. RockAuto scraper (batch, nightly) - most comprehensive fitment source
-- 2. OEM catalog scrapers (Mopar, Toyota Parts, Ford Parts, etc.)
-- 3. Lister write-back via PATCH /api/parts/:pn/fitment (progressive capture)
-- 4. Owner manual corrections
--
-- The listing tool checks this table via GET /api/parts/lookup
-- If fitment_data has a record, the listing tool gets:
--   - Confirmed year/make/model/engine fitment
--   - "Does NOT fit" exclusions (the money field)
--   - Programming requirements (auto-detected + confirmed)
--   - Installation notes (hybrid ABS, radio anti-theft, etc.)

CREATE TABLE IF NOT EXISTS fitment_data (
    id SERIAL PRIMARY KEY,
    
    -- Part identification
    part_number VARCHAR(100) NOT NULL UNIQUE,
    part_number_base VARCHAR(100),          -- Suffix-stripped (56044691AA → 56044691)
    part_name VARCHAR(200),                 -- "ECU ECM PCM Engine Control Module"
    category VARCHAR(50),                   -- ECM, BCM, TCM, ABS, TIPM, CLUSTER, RADIO, etc.
    
    -- Fitment: what it DOES fit
    year_start INTEGER,
    year_end INTEGER,
    makes TEXT[],                            -- {'Dodge','Chrysler','Jeep'}
    models TEXT[],                           -- {'Charger','300','Magnum'}
    engines TEXT[],                          -- {'3.5L','5.7L'}
    fits_vehicles JSONB,                    -- Detailed: [{year:2006,make:'Dodge',model:'Charger',engine:'3.5L',trim:'SXT'}]
    
    -- Fitment: what it does NOT fit (THE MONEY FIELD)
    does_not_fit TEXT,                       -- Human-readable: "Does NOT fit: 5.7L HEMI, AWD models, Diesel/Cummins"
    does_not_fit_vehicles JSONB,            -- Structured: [{make:'Dodge',model:'Charger',engine:'5.7L',reason:'Different ECM'}]
    
    -- Specificity flags (for listing tool warnings)
    drivetrain_specific TEXT,               -- '2WD' or '4WD' or 'AWD' or null (fits all)
    transmission_specific TEXT,             -- 'AT' or 'MT' or 'CVT' or null (fits all)
    engine_specific TEXT,                   -- '3.5L' or null (fits multiple engines)
    
    -- Programming requirements
    programming_required VARCHAR(20),       -- 'yes', 'no', 'maybe', 'varies'
    programming_note TEXT,                  -- Full note for the listing
    programming_tool TEXT,                  -- 'Techstream', 'DRB-III', 'IDS/FDRS', 'Tech2/SPS', etc.
    
    -- Installation notes (hybrid ABS, radio anti-theft, etc.)
    installation_notes TEXT,
    installation_warning TEXT,              -- Safety warnings (hybrid brake systems, airbags, etc.)
    
    -- Data quality
    confidence VARCHAR(20) DEFAULT 'low',   -- 'high' (multi-source confirmed), 'medium' (single source), 'low' (inferred)
    source VARCHAR(50),                     -- 'rockauto', 'mopar_catalog', 'toyota_parts', 'lister', 'owner', 'ai_inferred'
    sources_checked TEXT[],                 -- All sources that were checked for this part
    confirmed_by VARCHAR(50),               -- Who last confirmed: 'lister', 'owner', 'scraper'
    confirmed_count INTEGER DEFAULT 0,      -- How many times confirmed (higher = more reliable)
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_scraped_at TIMESTAMP               -- When scraper last checked this part
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fitment_pn ON fitment_data(part_number);
CREATE INDEX IF NOT EXISTS idx_fitment_base ON fitment_data(part_number_base);
CREATE INDEX IF NOT EXISTS idx_fitment_category ON fitment_data(category);
CREATE INDEX IF NOT EXISTS idx_fitment_confidence ON fitment_data(confidence);
CREATE INDEX IF NOT EXISTS idx_fitment_make ON fitment_data USING GIN(makes);

-- ══════════════════════════════════════════════════════════════════
-- SCRAPE QUEUE: Tracks which part numbers need to be scraped
-- Priority: parts with high sales volume get scraped first
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fitment_scrape_queue (
    id SERIAL PRIMARY KEY,
    part_number VARCHAR(100) NOT NULL UNIQUE,
    part_number_base VARCHAR(100),
    category VARCHAR(50),
    priority INTEGER DEFAULT 50,            -- 100 = highest (your top sellers), 0 = lowest
    sales_count INTEGER DEFAULT 0,          -- From YourSale — more sales = higher priority
    status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'in_progress', 'completed', 'failed', 'no_data'
    attempts INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_queue_status ON fitment_scrape_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_pn ON fitment_scrape_queue(part_number);
