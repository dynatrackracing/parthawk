exports.up = async function(knex) {
  // 1. Create schema
  await knex.raw(`CREATE SCHEMA IF NOT EXISTS vin_decoder`);

  // 2. Create manufacturers table
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS vin_decoder.manufacturers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      wmi_prefixes TEXT[] NOT NULL,
      trim_positions TEXT,
      engine_position INT DEFAULT 8,
      notes TEXT
    )
  `);

  // 3. Create vds_trim_lookup table
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS vin_decoder.vds_trim_lookup (
      id SERIAL PRIMARY KEY,
      manufacturer_id INT NOT NULL REFERENCES vin_decoder.manufacturers(id),
      model_pattern TEXT NOT NULL,
      year_start INT NOT NULL,
      year_end INT NOT NULL,
      vin_position INT NOT NULL,
      vin_char CHAR(1) NOT NULL,
      decoded_value TEXT NOT NULL,
      decode_type TEXT NOT NULL CHECK (decode_type IN ('trim','series','body_type','drive_type','restraint','gvwr_class','price_class')),
      confidence NUMERIC(3,2) DEFAULT 0.95,
      source TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type)
    )
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_vds_trim_manufacturer ON vin_decoder.vds_trim_lookup(manufacturer_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_vds_trim_years ON vin_decoder.vds_trim_lookup(year_start, year_end)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_vds_trim_vin_pos ON vin_decoder.vds_trim_lookup(vin_position, vin_char)`);

  // 4. Create engine_codes table
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS vin_decoder.engine_codes (
      id SERIAL PRIMARY KEY,
      manufacturer_id INT NOT NULL REFERENCES vin_decoder.manufacturers(id),
      vin_char CHAR(1) NOT NULL,
      year_start INT NOT NULL,
      year_end INT NOT NULL,
      model_pattern TEXT DEFAULT '%',
      engine_code TEXT,
      displacement_l NUMERIC(3,1),
      cylinders INT,
      configuration TEXT,
      fuel_type TEXT,
      forced_induction TEXT,
      horsepower INT,
      transmission_hint TEXT,
      source TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(manufacturer_id, vin_char, year_start, year_end, model_pattern)
    )
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_engine_codes_manufacturer ON vin_decoder.engine_codes(manufacturer_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_engine_codes_vin_char ON vin_decoder.engine_codes(vin_char)`);

  // 5. Create name_aliases table
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS vin_decoder.name_aliases (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('make','model','trim','engine')),
      canonical TEXT NOT NULL,
      alias TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE(entity_type, alias, source)
    )
  `);

  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_name_aliases_lookup ON vin_decoder.name_aliases(entity_type, alias)`);

  // 6. Seed manufacturers
  await knex.raw(`
    INSERT INTO vin_decoder.manufacturers (name, wmi_prefixes, engine_position) VALUES
      ('GM', ARRAY['1G','2G','3G','1GC','1GT','2GT','3GT','1G1','1G2','1GY','2G1','3G1','3GN','1GK'], 8),
      ('FORD', ARRAY['1FA','1FB','1FC','1FD','1FE','1FM','1FT','1FV','2FA','2FM','2FT','3FA','3FM','3FT','1LN','3LN','5LM'], 8),
      ('CHRYSLER', ARRAY['1C3','1C4','1C6','2C3','2C4','3C4','3C6','1D3','1D7','1D8','2D7','3D7','1J4','1J8','1C','2C','3C','1D','2D','3D','1J','2A','3A'], 8),
      ('TOYOTA', ARRAY['JT','4T','5T','2T','3TM','5TF','5TD','5TE','JTD','JTK','JTH','JTJ','JTN','JTE','JTM','JTMW','JTMC','JTMS'], 8),
      ('HONDA', ARRAY['1HG','2HG','5J6','19X','JHM','JHL','JH2','JH4','5FN','5J8','19U','93H'], 8),
      ('HYUNDAI', ARRAY['KM8','KMH','5NM','5NP','5XY','KNA','KND','KNH','5NP','5XY','KM8J'], 8),
      ('KIA', ARRAY['KNA','KND','KNH','5XY','3KP','5XX'], 8),
      ('NISSAN', ARRAY['1N4','1N6','3N1','5N1','JN1','JN8','JN6','3N6','5N1'], 8)
    ON CONFLICT (name) DO NOTHING
  `);

  // 7. Seed VDS trim lookup data

  // GM Silverado 2007-2013
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2007, 2013, 6, '1', 'WT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2007, 2013, 6, '2', 'LT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2007, 2013, 6, '3', 'LTZ', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Sierra 2007-2013
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2007, 2013, 6, '1', 'SL', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2007, 2013, 6, '2', 'SLE', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2007, 2013, 6, '3', 'SLT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2007, 2013, 6, '0', 'Denali', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Silverado 2014-2018
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2014, 2018, 6, '1', 'WT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2014, 2018, 6, '2', 'LT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2014, 2018, 6, '3', 'LTZ', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2014, 2018, 6, '4', 'High Country', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Sierra 2014-2018
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2014, 2018, 6, '1', 'Base', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2014, 2018, 6, '2', 'SLE', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2014, 2018, 6, '3', 'SLT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2014, 2018, 6, '0', 'Denali', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Silverado 2019-2024
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2019, 2024, 6, '1', 'WT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2019, 2024, 6, '2', 'Custom', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2019, 2024, 6, '3', 'LTZ', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2019, 2024, 6, '4', 'High Country', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Silverado%', 2019, 2024, 6, '5', 'ZR2', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Sierra 2019-2024
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2019, 2024, 6, '1', 'Pro', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2019, 2024, 6, '2', 'SLE', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2019, 2024, 6, '3', 'SLT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2019, 2024, 6, '0', 'Denali', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Sierra%', 2019, 2024, 6, '4', 'AT4', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Tahoe 2007-2014
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2007, 2014, 6, '1', 'LS', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2007, 2014, 6, '2', 'LT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2007, 2014, 6, '3', 'LTZ', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Suburban 2007-2014
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Suburban%', 2007, 2014, 6, '1', 'LS', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Suburban%', 2007, 2014, 6, '2', 'LT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Suburban%', 2007, 2014, 6, '3', 'LTZ', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Yukon 2007-2014
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2007, 2014, 6, '1', 'SL', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2007, 2014, 6, '2', 'SLE', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2007, 2014, 6, '3', 'SLT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2007, 2014, 6, '0', 'Denali', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Tahoe 2015-2020
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2015, 2020, 6, '1', 'LS', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2015, 2020, 6, '2', 'LT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Tahoe%', 2015, 2020, 6, '3', 'Premier', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // GM Yukon 2015-2020
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2015, 2020, 6, '2', 'SLE', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2015, 2020, 6, '3', 'SLT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '%Yukon%', 2015, 2020, 6, '0', 'Denali', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Chrysler universal price_class 1981-2026
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'L', 'Economy', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'H', 'Mid', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'M', 'Medium', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'P', 'Premium', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'X', 'High', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'N', 'Special', 'price_class'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%', 1981, 2026, 6, 'S', 'Sport', 'price_class')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Chrysler Grand Cherokee 2011-2021 trim
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'L', 'Laredo', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'H', 'Altitude', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'M', 'Limited', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'P', 'Overland', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'X', 'Summit', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'N', 'SRT', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Grand Cherokee%', 2011, 2021, 6, 'S', 'Trailhawk', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Chrysler Wrangler 2018-2024 trim
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Wrangler%', 2018, 2024, 6, 'L', 'Sport', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Wrangler%', 2018, 2024, 6, 'H', 'Sport S', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Wrangler%', 2018, 2024, 6, 'M', 'Sahara', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Wrangler%', 2018, 2024, 6, 'P', 'Altitude', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%Wrangler%', 2018, 2024, 6, 'X', 'Rubicon', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Chrysler Ram 1500 2019-2024 trim
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'L', 'Tradesman', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'H', 'Big Horn', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'M', 'Laramie', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'P', 'Longhorn', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'X', 'Limited', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'N', 'TRX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='CHRYSLER'), '%1500%', 2019, 2024, 6, 'S', 'Rebel', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Honda Civic 2016-2021 trim (vin_position=8)
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'R', 'LX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'S', 'Sport', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'T', 'EX-L', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'U', 'Touring', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'V', 'Si', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Civic%', 2016, 2021, 8, 'W', 'Type R', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Honda Accord 2018-2022 trim (vin_position=8)
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Accord%', 2018, 2022, 8, 'R', 'LX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Accord%', 2018, 2022, 8, 'S', 'Sport', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Accord%', 2018, 2022, 8, 'T', 'EX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Accord%', 2018, 2022, 8, 'U', 'EX-L', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Accord%', 2018, 2022, 8, 'V', 'Touring', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Honda CR-V 2017-2024 trim (vin_position=8)
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%CR-V%', 2017, 2024, 8, 'R', 'LX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%CR-V%', 2017, 2024, 8, 'S', 'EX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%CR-V%', 2017, 2024, 8, 'T', 'EX-L', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%CR-V%', 2017, 2024, 8, 'U', 'Touring', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // Honda Pilot 2016-2022 trim (vin_position=8)
  await knex.raw(`
    INSERT INTO vin_decoder.vds_trim_lookup (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decoded_value, decode_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Pilot%', 2016, 2022, 8, 'R', 'LX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Pilot%', 2016, 2022, 8, 'S', 'EX', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Pilot%', 2016, 2022, 8, 'T', 'EX-L', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Pilot%', 2016, 2022, 8, 'U', 'Touring', 'trim'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='HONDA'), '%Pilot%', 2016, 2022, 8, 'V', 'Elite', 'trim')
    ON CONFLICT (manufacturer_id, model_pattern, year_start, year_end, vin_position, vin_char, decode_type) DO NOTHING
  `);

  // 8. Seed engine codes

  // GM Truck engines
  await knex.raw(`
    INSERT INTO vin_decoder.engine_codes (manufacturer_id, vin_char, year_start, year_end, model_pattern, displacement_l, cylinders, fuel_type) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), 'J', 2014, 2019, '%', 5.3, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), 'C', 2019, 2024, '%', 5.3, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), 'T', 2014, 2019, '%', 6.2, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), 'L', 2007, 2013, '%', 5.3, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '0', 2007, 2013, '%', 5.3, 8, 'Flex Fuel'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), 'K', 2007, 2013, '%', 6.0, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '8', 2001, 2006, '%', 5.3, 8, 'Gas'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '1', 2007, 2010, '%', 6.6, 8, 'Diesel'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='GM'), '2', 2011, 2016, '%', 6.6, 8, 'Diesel')
    ON CONFLICT (manufacturer_id, vin_char, year_start, year_end, model_pattern) DO NOTHING
  `);

  // Update forced_induction for diesel entries
  await knex.raw(`
    UPDATE vin_decoder.engine_codes
    SET forced_induction = 'Turbocharged'
    WHERE manufacturer_id = (SELECT id FROM vin_decoder.manufacturers WHERE name='GM')
      AND vin_char IN ('1', '2')
      AND fuel_type = 'Diesel'
  `);

  // Ford F-150 engines
  await knex.raw(`
    INSERT INTO vin_decoder.engine_codes (manufacturer_id, vin_char, year_start, year_end, model_pattern, displacement_l, cylinders, fuel_type, forced_induction) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'W', 2011, 2014, '%F-150%', 3.7, 6, 'Gas', NULL),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'F', 2011, 2017, '%F-150%', 3.5, 6, 'Gas', 'Twin Turbo'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'R', 2015, 2017, '%F-150%', 2.7, 6, 'Gas', 'Twin Turbo'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), '8', 2011, 2014, '%F-150%', 5.0, 8, 'Gas', NULL),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), '5', 2015, 2020, '%F-150%', 5.0, 8, 'Gas', NULL),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'V', 2018, 2021, '%F-150%', 3.0, 6, 'Diesel', 'Turbocharged'),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'S', 2021, 2024, '%F-150%', 3.5, 6, 'Hybrid', NULL)
    ON CONFLICT (manufacturer_id, vin_char, year_start, year_end, model_pattern) DO NOTHING
  `);

  // Ford Mustang engines
  await knex.raw(`
    INSERT INTO vin_decoder.engine_codes (manufacturer_id, vin_char, year_start, year_end, model_pattern, displacement_l, cylinders, fuel_type, forced_induction, horsepower) VALUES
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'R', 2015, 2023, '%Mustang%', 2.3, 4, 'Gas', 'Turbocharged', NULL),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), '5', 2015, 2023, '%Mustang%', 5.0, 8, 'Gas', NULL, NULL),
      ((SELECT id FROM vin_decoder.manufacturers WHERE name='FORD'), 'H', 2020, 2023, '%Mustang%', 5.2, 8, 'Gas', 'Supercharged', 760)
    ON CONFLICT (manufacturer_id, vin_char, year_start, year_end, model_pattern) DO NOTHING
  `);

  // 9. Seed name aliases
  await knex.raw(`
    INSERT INTO vin_decoder.name_aliases (entity_type, canonical, alias, source) VALUES
      ('make', 'Chevrolet', 'CHEVROLET', 'nhtsa'),
      ('make', 'GMC', 'GMC', 'nhtsa'),
      ('make', 'Ford', 'FORD', 'nhtsa'),
      ('make', 'Toyota', 'TOYOTA', 'nhtsa'),
      ('make', 'Honda', 'HONDA', 'nhtsa'),
      ('make', 'Nissan', 'NISSAN', 'nhtsa'),
      ('make', 'Hyundai', 'HYUNDAI', 'nhtsa'),
      ('make', 'Kia', 'KIA', 'nhtsa'),
      ('make', 'Chrysler', 'CHRYSLER', 'nhtsa'),
      ('make', 'Dodge', 'DODGE', 'nhtsa'),
      ('make', 'Jeep', 'JEEP', 'nhtsa'),
      ('make', 'Ram', 'RAM', 'nhtsa')
    ON CONFLICT (entity_type, alias, source) DO NOTHING
  `);
};

exports.down = async function(knex) {
  await knex.raw(`DROP SCHEMA IF EXISTS vin_decoder CASCADE`);
};
