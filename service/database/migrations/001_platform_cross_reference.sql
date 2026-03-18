-- Migration: Platform Cross-Reference System
-- Purpose: Enable attack list to match yard vehicles against sales from related platforms
-- Example: 2006 Chrysler 300 at yard → match Dodge Charger ECM sales too
-- Run against Railway Postgres: parthawk-production

-- Platform groups (e.g., "Chrysler LX 2005-2010")
CREATE TABLE IF NOT EXISTS platform_group (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,        -- "Chrysler_LX_2005_2010"
    platform VARCHAR(100) NOT NULL,           -- "Chrysler LX"
    year_start INTEGER NOT NULL,
    year_end INTEGER NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Vehicles belonging to each platform group
CREATE TABLE IF NOT EXISTS platform_vehicle (
    id SERIAL PRIMARY KEY,
    platform_group_id INTEGER NOT NULL REFERENCES platform_group(id),
    make VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year_start INTEGER,                        -- Override group years if needed
    year_end INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(platform_group_id, make, model)
);

-- Which part types are shared within each platform group
CREATE TABLE IF NOT EXISTS platform_shared_part (
    id SERIAL PRIMARY KEY,
    platform_group_id INTEGER NOT NULL REFERENCES platform_group(id),
    part_type VARCHAR(50) NOT NULL,            -- ECM, BCM, ABS, TIPM, Fuse Box, etc.
    confidence VARCHAR(20) DEFAULT 'high',     -- high, medium, low
    notes TEXT,
    UNIQUE(platform_group_id, part_type)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_platform_vehicle_make_model 
    ON platform_vehicle(make, model);
CREATE INDEX IF NOT EXISTS idx_platform_vehicle_group 
    ON platform_vehicle(platform_group_id);
CREATE INDEX IF NOT EXISTS idx_platform_shared_part_group 
    ON platform_shared_part(platform_group_id);

-- ══════════════════════════════════════════════════════════════════
-- SEED DATA: Platform groups from DynaTrack sales analysis
-- ══════════════════════════════════════════════════════════════════

-- Chrysler LX 2005-2010 (300/Charger/Magnum/Challenger)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_LX_2005_2010', 'Chrysler LX', 2005, 2010, '300/Charger share nearly everything. Challenger joins 2008+. Magnum discontinued 2008.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Chrysler', '300'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Dodge', 'Charger'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Dodge', 'Magnum'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Dodge', 'Challenger')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Fuse Box'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'Steering'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2005_2010'), 'TIPM')
ON CONFLICT DO NOTHING;

-- Chrysler LX/LD 2011-2023 (300/Charger/Challenger)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_LX_2011_2023', 'Chrysler LX/LD', 2011, 2023, '300 and Charger are nearly identical electronically. Challenger shares most modules.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'Chrysler', '300'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'Dodge', 'Charger'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'Dodge', 'Challenger')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'Fuse Box'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'Steering'),
((SELECT id FROM platform_group WHERE name='Chrysler_LX_2011_2023'), 'TIPM')
ON CONFLICT DO NOTHING;

-- Jeep WK 2005-2010 (Grand Cherokee/Commander)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_WK_2005_2010', 'Chrysler WK', 2005, 2010, 'Commander is a 3-row Grand Cherokee. Same electronics.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'Jeep', 'Grand Cherokee'),
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'Jeep', 'Commander')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'TIPM'),
((SELECT id FROM platform_group WHERE name='Chrysler_WK_2005_2010'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- Jeep KJ/KK 2008-2012 (Liberty/Nitro)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_KJ_KK', 'Chrysler KJ/KK', 2008, 2012, 'Liberty and Nitro share the same platform completely.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'Jeep', 'Liberty'),
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'Dodge', 'Nitro')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Chrysler_KJ_KK'), 'TIPM')
ON CONFLICT DO NOTHING;

-- Chrysler JS/MK 2007-2014 (Avenger/Sebring/200)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_MK_JS', 'Chrysler JS/MK', 2007, 2014, '200 replaced Sebring mid-2010. Same platform.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'Dodge', 'Avenger'),
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'Chrysler', 'Sebring'),
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'Chrysler', '200')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Chrysler_MK_JS'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- Chrysler Minivan RT 2008-2020
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_Minivan_RT', 'Chrysler RT', 2008, 2020, 'Caravan and T&C are the same vehicle. Pacifica replaced T&C 2017+.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'Dodge', 'Grand Caravan'),
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'Chrysler', 'Town & Country'),
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'Chrysler', 'Pacifica')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'TIPM'),
((SELECT id FROM platform_group WHERE name='Chrysler_Minivan_RT'), 'ABS')
ON CONFLICT DO NOTHING;

-- Ram DS/DJ 2009-2018
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Ram_DS_DJ', 'Ram DS/DJ', 2009, 2018, '1500 ECM differs from HD. TIPM often shared. ABS differs by 2WD/4WD.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Ram', '1500'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Ram', '2500'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Ram', '3500'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Dodge', 'Ram 1500'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Dodge', 'Ram 2500'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Dodge', 'Ram 3500')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'TIPM'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Fuse Box'),
((SELECT id FROM platform_group WHERE name='Ram_DS_DJ'), 'Steering')
ON CONFLICT DO NOTHING;

-- GM GMT900 2007-2014 (Silverado/Sierra/Tahoe/Yukon/Suburban/Escalade)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('GM_GMT900', 'GM GMT900', 2007, 2014, 'Silverado/Sierra share everything. Tahoe/Yukon/Suburban share most. ECM varies by engine.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Chevrolet', 'Silverado'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'GMC', 'Sierra'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Chevrolet', 'Tahoe'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'GMC', 'Yukon'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Chevrolet', 'Suburban'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Cadillac', 'Escalade')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'ECM'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'BCM'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'ABS'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Fuse Box'),
((SELECT id FROM platform_group WHERE name='GM_GMT900'), 'Amplifier')
ON CONFLICT DO NOTHING;

-- GM Lambda/C1XX 2007-2017 (Traverse/Acadia/Enclave/Outlook)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('GM_Lambda', 'GM Lambda/C1XX', 2007, 2017, 'All four are the same vehicle with different badges.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'Chevrolet', 'Traverse'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'GMC', 'Acadia'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'Buick', 'Enclave'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'Saturn', 'Outlook')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'ECM'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'BCM'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'ABS'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'Fuse Box'),
((SELECT id FROM platform_group WHERE name='GM_Lambda'), 'Amplifier')
ON CONFLICT DO NOTHING;

-- GM GMT800 2003-2009 (Trailblazer/Envoy/Rainier/Ascender/9-7X)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('GM_GMT800', 'GM GMT800', 2003, 2009, 'Same platform, same electronics. Trailblazer is the volume model.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'Chevrolet', 'Trailblazer'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'GMC', 'Envoy'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'Buick', 'Rainier'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'Isuzu', 'Ascender'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'Saab', '9-7X')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'ECM'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'BCM'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'ABS'),
((SELECT id FROM platform_group WHERE name='GM_GMT800'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- GM Theta 2007-2017 (Equinox/Terrain)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('GM_Theta', 'GM Theta', 2007, 2017, 'Equinox and Terrain are badge-engineered twins.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'Chevrolet', 'Equinox'),
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'GMC', 'Terrain')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'ECM'),
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'BCM'),
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'ABS'),
((SELECT id FROM platform_group WHERE name='GM_Theta'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- Ford CD3/CD4 2007-2015 (Edge/MKX)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Ford_CD3', 'Ford CD3/CD4', 2007, 2015, 'MKX is a rebadged Edge with luxury trim.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Ford_CD3'), 'Ford', 'Edge'),
((SELECT id FROM platform_group WHERE name='Ford_CD3'), 'Lincoln', 'MKX')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Ford_CD3'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Ford_CD3'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Ford_CD3'), 'ABS')
ON CONFLICT DO NOTHING;

-- Ford Explorer D4 2011-2019 (Explorer/Flex/MKT/Taurus)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Ford_D4', 'Ford D4', 2011, 2019, 'Explorer and Taurus share the D4 platform.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'Ford', 'Explorer'),
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'Ford', 'Flex'),
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'Lincoln', 'MKT'),
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'Ford', 'Taurus')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Ford_D4'), 'ABS')
ON CONFLICT DO NOTHING;

-- Ford Super Duty P2 1999-2007
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Ford_P2', 'Ford P2', 1999, 2007, 'F-250 and F-350 share nearly everything. Excursion is an SUV on same frame.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'Ford', 'F-250'),
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'Ford', 'F-350'),
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'Ford', 'Excursion')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Ford_P2'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- Ford Escape/Tribute 2001-2012
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Ford_Escape_CD2', 'Ford CD2', 2001, 2012, 'Escape and Tribute are the same vehicle. Mariner joined 2005.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'Ford', 'Escape'),
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'Mazda', 'Tribute'),
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'Mercury', 'Mariner')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Ford_Escape_CD2'), 'ABS')
ON CONFLICT DO NOTHING;

-- Toyota Tundra/Sequoia 2007-2014
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Toyota_Truck_07', 'Toyota IMV', 2007, 2014, 'Tundra and Sequoia share platform and many electronics.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Toyota_Truck_07'), 'Toyota', 'Tundra'),
((SELECT id FROM platform_group WHERE name='Toyota_Truck_07'), 'Toyota', 'Sequoia')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Toyota_Truck_07'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Toyota_Truck_07'), 'ABS')
ON CONFLICT DO NOTHING;

-- Hyundai/Kia Tucson/Sportage 2010-2015
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Hyundai_Kia_LM', 'Hyundai/Kia LM', 2010, 2015, 'Same platform. Most electronics interchangeable.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'Hyundai', 'Tucson'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'Kia', 'Sportage')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_LM'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- Hyundai/Kia Sonata/Optima 2011-2014
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Hyundai_Kia_YF', 'Hyundai/Kia YF', 2011, 2014, 'Same platform and drivetrain.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_YF'), 'Hyundai', 'Sonata'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_YF'), 'Kia', 'Optima')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_YF'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_YF'), 'ABS')
ON CONFLICT DO NOTHING;

-- Hyundai/Kia Elantra/Forte 2011-2016
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Hyundai_Kia_MD', 'Hyundai/Kia MD', 2011, 2016, 'Same platform.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_MD'), 'Hyundai', 'Elantra'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_MD'), 'Kia', 'Forte')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_MD'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Hyundai_Kia_MD'), 'ABS')
ON CONFLICT DO NOTHING;

-- Nissan FM 2003-2008 (350Z/G35)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Nissan_FM', 'Nissan FM', 2003, 2008, 'Same platform. VQ35DE engine shared.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Nissan_FM'), 'Nissan', '350Z'),
((SELECT id FROM platform_group WHERE name='Nissan_FM'), 'Infiniti', 'G35')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Nissan_FM'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Nissan_FM'), 'ABS')
ON CONFLICT DO NOTHING;

-- Nissan D40 2005-2021 (Frontier/Xterra/Pathfinder)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Nissan_D40', 'Nissan F-Alpha', 2005, 2012, 'Frontier, Xterra, and Pathfinder share the F-Alpha platform.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'Nissan', 'Frontier'),
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'Nissan', 'Xterra'),
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'Nissan', 'Pathfinder')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Nissan_D40'), 'BCM')
ON CONFLICT DO NOTHING;

-- VW MQB 2011-2018 (Jetta/Golf/Passat)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('VW_MQB', 'VW MQB', 2011, 2018, 'Golf and Jetta share heavily. Passat differs on some modules.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'Volkswagen', 'Jetta'),
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'Volkswagen', 'Golf'),
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'Volkswagen', 'Passat')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'ECM'),
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'BCM'),
((SELECT id FROM platform_group WHERE name='VW_MQB'), 'ABS')
ON CONFLICT DO NOTHING;

-- Honda CR-V/Civic 2012-2016
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Honda_CRV_Civic', 'Honda Global Compact', 2012, 2016, 'CR-V and Civic share platform elements. ECM differs by engine.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Honda_CRV_Civic'), 'Honda', 'CR-V'),
((SELECT id FROM platform_group WHERE name='Honda_CRV_Civic'), 'Honda', 'Civic')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Honda_CRV_Civic'), 'ABS'),
((SELECT id FROM platform_group WHERE name='Honda_CRV_Civic'), 'BCM')
ON CONFLICT DO NOTHING;

-- Chrysler Dart/200 2013-2016 (Compact)
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('Chrysler_CUSW', 'Chrysler CUSW/Fiat C-Wide', 2013, 2016, 'Dart and 200 share the Fiat-derived platform.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_CUSW'), 'Dodge', 'Dart'),
((SELECT id FROM platform_group WHERE name='Chrysler_CUSW'), 'Chrysler', '200')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='Chrysler_CUSW'), 'ECM'),
((SELECT id FROM platform_group WHERE name='Chrysler_CUSW'), 'BCM'),
((SELECT id FROM platform_group WHERE name='Chrysler_CUSW'), 'ABS')
ON CONFLICT DO NOTHING;

-- GM Express/Savana 2003-2024
INSERT INTO platform_group (name, platform, year_start, year_end, notes) VALUES
('GM_Express_Savana', 'GM GMT610', 2003, 2024, 'Express and Savana are identical except badges.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO platform_vehicle (platform_group_id, make, model) VALUES
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'Chevrolet', 'Express'),
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'GMC', 'Savana')
ON CONFLICT DO NOTHING;

INSERT INTO platform_shared_part (platform_group_id, part_type) VALUES
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'ECM'),
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'BCM'),
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'ABS'),
((SELECT id FROM platform_group WHERE name='GM_Express_Savana'), 'Fuse Box')
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- QUERY: Get platform matches for a vehicle at the yard
-- Usage: Pass make, model, year from yard_vehicle
-- Returns all vehicles that share parts on same platform
-- ══════════════════════════════════════════════════════════════════

-- Example query (this is for reference, not executed):
-- SELECT DISTINCT pv2.make, pv2.model, psp.part_type, pg.notes
-- FROM platform_vehicle pv1
-- JOIN platform_group pg ON pv1.platform_group_id = pg.id
-- JOIN platform_vehicle pv2 ON pv2.platform_group_id = pg.id AND pv2.id != pv1.id
-- JOIN platform_shared_part psp ON psp.platform_group_id = pg.id
-- WHERE pv1.make = 'Chrysler' AND pv1.model = '300'
--   AND 2006 BETWEEN pg.year_start AND pg.year_end;
