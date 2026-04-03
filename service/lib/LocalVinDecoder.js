'use strict';

const { log } = require('./logger');
const { database } = require('../database/database');

let decoderInstance = null;
let initPromise = null;

/**
 * LocalVinDecoder — Offline VIN decoding via @cardog/corgi + VDS enrichment.
 *
 * Replaces ALL NHTSA API calls in DarkHawk.
 * Singleton: one decoder instance for the lifetime of the app.
 *
 * Decode pipeline:
 *   1. Check vin_cache (existing table, backward compatible)
 *   2. Corgi offline decode (sub-15ms, zero network)
 *   3. VDS trim enrichment (vin_decoder.vds_trim_lookup in Postgres)
 *   4. Engine code enrichment (vin_decoder.engine_codes in Postgres)
 *   5. Write to vin_cache
 *   6. Return standardized result
 */

async function getDecoder() {
  if (decoderInstance) return decoderInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { createDecoder } = require('@cardog/corgi');
      decoderInstance = await createDecoder();
      log.info('LocalVinDecoder: corgi decoder initialized');
      return decoderInstance;
    } catch (err) {
      log.error({ err: err.message }, 'LocalVinDecoder: failed to init corgi');
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

async function identifyManufacturer(vin) {
  var wmi3 = vin.substring(0, 3).toUpperCase();
  var wmi2 = vin.substring(0, 2).toUpperCase();

  try {
    var mfr = await database.raw(
      'SELECT id, name FROM vin_decoder.manufacturers WHERE ? = ANY(wmi_prefixes) LIMIT 1',
      [wmi3]
    );
    if (mfr.rows.length > 0) return mfr.rows[0];

    mfr = await database.raw(
      'SELECT id, name FROM vin_decoder.manufacturers WHERE ? = ANY(wmi_prefixes) LIMIT 1',
      [wmi2]
    );
    if (mfr.rows.length > 0) return mfr.rows[0];
  } catch (e) { /* vin_decoder schema may not exist yet */ }
  return null;
}

async function resolveTrimFromVDS(mfrId, vin, year, model) {
  if (!mfrId || !year || !model) return null;

  try {
    var result = await database.raw(`
      SELECT decoded_value, confidence
      FROM vin_decoder.vds_trim_lookup
      WHERE manufacturer_id = ?
        AND decode_type IN ('trim', 'price_class')
        AND ? BETWEEN year_start AND year_end
        AND UPPER(?) LIKE UPPER(model_pattern)
        AND SUBSTRING(? FROM vin_position FOR 1) = vin_char
      ORDER BY
        CASE decode_type WHEN 'trim' THEN 0 ELSE 1 END,
        LENGTH(model_pattern) DESC,
        confidence DESC
      LIMIT 1
    `, [mfrId, year, model, vin]);

    if (result.rows.length > 0) {
      return { trim: result.rows[0].decoded_value, confidence: parseFloat(result.rows[0].confidence) };
    }
  } catch (e) { /* table may not exist yet */ }
  return null;
}

async function resolveEngineCode(mfrId, mfrName, vin, year, model) {
  if (!mfrId || !year) return null;
  if (mfrName === 'HONDA') return null; // Honda pos8 = trim, not engine

  var engineChar = vin.charAt(7); // Position 8 (0-indexed = 7)

  try {
    var result = await database.raw(`
      SELECT engine_code, displacement_l, cylinders, fuel_type,
             forced_induction, horsepower, transmission_hint
      FROM vin_decoder.engine_codes
      WHERE manufacturer_id = ?
        AND vin_char = ?
        AND ? BETWEEN year_start AND year_end
        AND UPPER(?) LIKE UPPER(model_pattern)
      ORDER BY LENGTH(model_pattern) DESC
      LIMIT 1
    `, [mfrId, engineChar, year, model]);

    if (result.rows.length > 0) {
      var r = result.rows[0];
      return {
        engineCode: r.engine_code,
        displacement: parseFloat(r.displacement_l),
        cylinders: parseInt(r.cylinders),
        fuelType: r.fuel_type,
        forcedInduction: r.forced_induction,
        horsepower: r.horsepower ? parseInt(r.horsepower) : null,
        transHint: r.transmission_hint,
      };
    }
  } catch (e) { /* table may not exist yet */ }
  return null;
}

function formatEngineString(displacement, cylinders, corgiEngine) {
  var disp = displacement || (corgiEngine && corgiEngine.displacement ? parseFloat(corgiEngine.displacement) : null);
  var cyl = cylinders || (corgiEngine && corgiEngine.cylinders ? parseInt(corgiEngine.cylinders) : null);

  if (!disp) return null;

  var engine = disp.toFixed(1) + 'L';
  if (cyl && cyl >= 2 && cyl <= 16) {
    var label = cyl <= 4 ? '4-cyl' : cyl === 5 ? '5-cyl' : cyl === 6 ? 'V6' : cyl === 8 ? 'V8' : cyl === 10 ? 'V10' : cyl + '-cyl';
    engine += ' ' + label;
  }
  return engine;
}

function parseDrivetrain(driveType) {
  if (!driveType) return null;
  var dt = driveType.toUpperCase();
  if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) return '4WD';
  if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) return 'AWD';
  if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) return 'FWD';
  if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) return 'RWD';
  return null;
}

function parseEngineType(fuelType) {
  if (!fuelType) return 'Gas';
  var ft = fuelType.toLowerCase();
  if (ft.includes('diesel')) return 'Diesel';
  if (ft.includes('hybrid')) return 'Hybrid';
  if (ft.includes('electric') && !ft.includes('hybrid')) return 'Electric';
  if (ft.includes('flex')) return 'Flex Fuel';
  return 'Gas';
}

/**
 * Main decode function. Returns standardized result.
 */
async function decode(vin) {
  if (!vin || vin.length < 11) return null;
  vin = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');

  var startTime = Date.now();

  // Step 1: Check vin_cache
  try {
    var cached = await database('vin_cache').where('vin', vin).first();
    if (cached) {
      return {
        vin: vin,
        year: cached.year,
        make: cached.make,
        model: cached.model,
        trim: cached.trim || null,
        engine: cached.engine || null,
        drivetrain: cached.drivetrain || null,
        bodyStyle: cached.body_style || null,
        engineType: null,
        source: 'vin_cache',
        cached: true,
        ms: Date.now() - startTime,
      };
    }
  } catch (e) { /* vin_cache table may not exist */ }

  // Step 2: Corgi offline decode
  var corgiResult = null;
  try {
    var decoder = await getDecoder();
    corgiResult = await decoder.decode(vin);
  } catch (err) {
    log.warn({ err: err.message, vin: vin }, 'LocalVinDecoder: corgi decode failed');
    return null;
  }

  if (!corgiResult || !corgiResult.valid) {
    log.debug({ vin: vin }, 'LocalVinDecoder: invalid VIN');
    return null;
  }

  var vehicle = (corgiResult.components && corgiResult.components.vehicle) || {};
  var corgiEngine = (corgiResult.components && corgiResult.components.engine) || {};

  var year = vehicle.year || null;
  var make = vehicle.make || null;
  var model = vehicle.model || null;
  var trim = vehicle.series || null;
  var bodyStyle = vehicle.bodyStyle || null;
  var driveType = vehicle.driveType || null;
  var fuelType = vehicle.fuelType || corgiEngine.fuel || null;

  var displacement = corgiEngine.displacement ? parseFloat(corgiEngine.displacement) : null;
  var cylinders = corgiEngine.cylinders ? parseInt(corgiEngine.cylinders) : null;

  var engineCode = null;
  var forcedInduction = null;
  var transHint = null;
  var source = 'corgi';

  // Step 3: VDS trim enrichment
  var mfr = await identifyManufacturer(vin);

  if (mfr && (!trim || trim === '')) {
    var vdsTrim = await resolveTrimFromVDS(mfr.id, vin, year, model);
    if (vdsTrim) {
      trim = vdsTrim.trim;
      source += '+vds_trim';
    }
  } else if (trim) {
    source += '+corgi_trim';
  }

  // Step 4: Engine code enrichment
  if (mfr) {
    var eng = await resolveEngineCode(mfr.id, mfr.name, vin, year, model);
    if (eng) {
      engineCode = eng.engineCode;
      if (eng.displacement) displacement = eng.displacement;
      if (eng.cylinders) cylinders = eng.cylinders;
      if (eng.fuelType) fuelType = eng.fuelType;
      forcedInduction = eng.forcedInduction;
      transHint = eng.transHint;
      source += '+engine_code';
    }
  }

  var engine = formatEngineString(displacement, cylinders, corgiEngine);
  var drivetrain = parseDrivetrain(driveType);
  var engineType = parseEngineType(fuelType);

  // Step 5: Write to vin_cache
  try {
    await database('vin_cache').insert({
      vin: vin,
      year: year,
      make: make,
      model: model,
      trim: trim,
      engine: engine,
      drivetrain: drivetrain,
      body_style: bodyStyle,
      raw_nhtsa: JSON.stringify({ corgi: corgiResult.components, engineCode: engineCode, source: source }),
      decoded_at: new Date(),
      createdAt: new Date(),
    }).onConflict('vin').ignore();
  } catch (e) {
    log.debug({ err: e.message }, 'LocalVinDecoder: cache write failed (non-fatal)');
  }

  return {
    vin: vin,
    year: year,
    make: make,
    model: model,
    trim: trim,
    engine: engine,
    engineCode: engineCode,
    engineType: engineType,
    displacement: displacement,
    cylinders: cylinders,
    fuelType: fuelType,
    forcedInduction: forcedInduction,
    drivetrain: drivetrain,
    bodyStyle: bodyStyle,
    transHint: transHint,
    source: source,
    cached: false,
    ms: Date.now() - startTime,
  };
}

/**
 * Batch decode — replacement for PostScrapeService's decodeBatch().
 * Returns array matching NHTSA batch response shape for backward compat.
 */
async function decodeBatchLocal(vins) {
  var results = [];
  for (var i = 0; i < vins.length; i++) {
    try {
      var d = await decode(vins[i]);
      if (!d) continue;

      results.push({
        VIN: d.vin,
        Make: d.make,
        Model: d.model,
        ModelYear: d.year ? String(d.year) : null,
        Trim: d.trim,
        DisplacementL: d.displacement ? String(d.displacement) : null,
        Cylinders: d.cylinders ? String(d.cylinders) : null,
        DriveType: d.drivetrain,
        FuelTypePrimary: d.fuelType,
        BodyClass: d.bodyStyle,
        TransmissionStyle: d.transHint || null,
        TransmissionSpeeds: null,
        _engineCode: d.engineCode,
        _engineType: d.engineType,
        _forcedInduction: d.forcedInduction,
        _source: d.source,
      });
    } catch (e) {
      log.debug({ err: e.message, vin: vins[i] }, 'LocalVinDecoder: batch item failed');
    }
  }
  return results;
}

async function close() {
  if (decoderInstance) {
    try {
      await decoderInstance.close();
      decoderInstance = null;
      initPromise = null;
      log.info('LocalVinDecoder: decoder closed');
    } catch (e) { /* ignore */ }
  }
}

module.exports = { decode, decodeBatchLocal, getDecoder, close };
