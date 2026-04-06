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

// ═══════════════════════════════════════════════════════════════
// EPA TRANSMISSION RESOLUTION
// ═══════════════════════════════════════════════════════════════

const CHECK_MT_MODELS = [
  'Corvette', 'Camaro', 'Mustang', 'Challenger',
  'WRX', 'BRZ', 'FR-S',
  '350Z', '370Z', 'MX-5', 'Miata',
  'Genesis Coupe', 'Veloster',
  'GTI', 'GTO', 'Solstice', 'Sky',
  'Lancer',
  'FJ Cruiser',
  'Tacoma', 'Frontier', 'Ranger', 'Wrangler',
];

const PERFORMANCE_TRIMS = /\b(ST|Si|Type R|Type S|SRT|SS|RS|Nismo|TRD|Sport|S\b|R-Line|GT(?:\s|$)|Turbo)\b/i;

function normalizeForMatch(s) {
  return (s || '').toLowerCase().replace(/[-\s]/g, '');
}

function epaModelMatches(epaModelClean, corgiModel, make) {
  if (!epaModelClean || !corgiModel) return false;
  var ea = normalizeForMatch(epaModelClean);
  var ca = normalizeForMatch(corgiModel);
  if (!ea || !ca) return false;

  // Direct match
  if (ea === ca) return true;

  // Containment — either direction
  if (ca.includes(ea) || ea.includes(ca)) return true;

  // GM tonnage: K15/C15 → 1500 etc.
  if (/chevrolet|gmc/i.test(make)) {
    var eaStrip = ea.replace(/k15|c15|k10|c10/g, '1500')
                    .replace(/k25|c25|k20|c20/g, '2500')
                    .replace(/k35|c35|k30|c30/g, '3500')
                    .replace(/pickup/g, '');
    var caStrip = ca.replace(/pickup/g, '');
    if (eaStrip === caStrip || caStrip.includes(eaStrip) || eaStrip.includes(caStrip)) return true;
  }

  // Strip "classic", "limited", "eco" suffixes
  var eaBase = ea.replace(/(classic|limited|eco|hybrid|plugin)$/g, '').trim();
  if (eaBase && (ca.includes(eaBase) || eaBase.includes(ca))) return true;

  return false;
}

async function resolveTransmission(year, make, model, displacement, cylinders, trim) {
  if (!year || !make || !model) return null;

  var makeLower = make.toLowerCase();
  var rows;
  try {
    var result = await database.raw(
      'SELECT trans_type, trans_speeds, trans_sub_type, model_clean FROM vin_decoder.epa_transmission WHERE year = ? AND LOWER(make) = ?',
      [year, makeLower]
    );
    rows = result.rows;
  } catch (e) {
    // Table may not exist or be empty
    return null;
  }

  if (!rows || rows.length === 0) {
    // Ram brand split: try Dodge if Ram has no results
    if (makeLower === 'ram') {
      try {
        var result2 = await database.raw(
          'SELECT trans_type, trans_speeds, trans_sub_type, model_clean FROM vin_decoder.epa_transmission WHERE year = ? AND LOWER(make) = ?',
          [year, 'dodge']
        );
        rows = (result2.rows || []).filter(function(r) {
          return epaModelMatches(r.model_clean, 'Ram ' + model, 'Dodge') || epaModelMatches(r.model_clean, model, 'Dodge');
        });
      } catch (e) { return null; }
    }
    if (!rows || rows.length === 0) return null;
  }

  // Filter to model matches
  var matched = rows.filter(function(r) {
    return epaModelMatches(r.model_clean, model, make);
  });

  if (matched.length === 0) return null;

  // Collect unique trans types
  var types = new Set(matched.map(function(r) { return r.trans_type; }));
  var hasManual = types.has('Manual');
  var hasAutomatic = types.has('Automatic');

  // Helper: most common value from an array
  function mostCommon(arr) {
    var counts = {};
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] || '';
      counts[v] = (counts[v] || 0) + 1;
    }
    var best = null, bestCount = 0;
    for (var k in counts) {
      if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
    }
    return best || null;
  }

  // TIER 1: EPA DEFINITIVE — only one trans type
  if (hasAutomatic && !hasManual) {
    var autoRows = matched.filter(function(r) { return r.trans_type === 'Automatic'; });
    return {
      transType: 'Automatic',
      transSpeeds: mostCommon(autoRows.map(function(r) { return r.trans_speeds; })),
      transSubType: mostCommon(autoRows.map(function(r) { return r.trans_sub_type; })) || null,
      source: 'epa_definitive',
    };
  }
  if (hasManual && !hasAutomatic) {
    var manRows = matched.filter(function(r) { return r.trans_type === 'Manual'; });
    return {
      transType: 'Manual',
      transSpeeds: mostCommon(manRows.map(function(r) { return r.trans_speeds; })),
      transSubType: null,
      source: 'epa_definitive',
    };
  }

  // Both types exist — TIER 2: CHECK_MT models
  var modelUpper = model.toUpperCase();
  var isCheckMT = CHECK_MT_MODELS.some(function(m) {
    return modelUpper.includes(m.toUpperCase());
  });

  if (isCheckMT) {
    return { transType: 'CHECK_MT', transSpeeds: null, transSubType: null, source: 'epa_check_mt' };
  }

  // Performance trim override
  if (trim && PERFORMANCE_TRIMS.test(trim)) {
    return { transType: 'CHECK_MT', transSpeeds: null, transSubType: null, source: 'epa_check_mt' };
  }

  // TIER 3: DEFAULT AUTOMATIC
  var autoRows2 = matched.filter(function(r) { return r.trans_type === 'Automatic'; });
  return {
    transType: 'Automatic',
    transSpeeds: mostCommon(autoRows2.map(function(r) { return r.trans_speeds; })),
    transSubType: mostCommon(autoRows2.map(function(r) { return r.trans_sub_type; })) || null,
    source: 'epa_default_auto',
  };
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

/**
 * Clean decoded trim — filters junk, chassis codes, cab types, drivetrain strings.
 * Copied from PostScrapeService.cleanDecodedTrim() for self-contained use.
 */
function cleanDecodedTrim(raw) {
  if (!raw) return null;
  var t = raw.trim();
  if (!t) return null;

  var JUNK_LIST = [
    'nfa','nfb','nfc','cma','std','sa','hev','phev',
    'n/a','na','unknown','standard','unspecified',
    'styleside','flareside','stepside','sportside',
    'crew','crew cab','regular cab','extended cab','supercab','supercrew','double cab','quad cab','king cab','access cab',
    'middle level','middle-low level','high level','low level',
    'middle grade','middle-low grade','high grade','low grade',
    'xdrive','sdrive','4matic','quattro',
    'leather','cloth','premium cloth',
    'f-series','f series',
  ];
  var lower = t.toLowerCase();
  for (var i = 0; i < JUNK_LIST.length; i++) {
    if (lower === JUNK_LIST[i]) return null;
  }

  t = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
  t = t.replace(/\b[VIL][\-\s]?\d\b/gi, '').trim();
  t = t.replace(/\b\d\.\d[A-Z]?\s*(L|LITER)?\b/gi, '').trim();
  t = t.replace(/\bW\/LEA(THER)?\b/gi, '-L').trim();
  t = t.replace(/\bWITH\s+LEATHER\b/gi, '-L').trim();
  t = t.replace(/\bW\/NAV(I|IGATION)?\b/gi, '').trim();
  t = t.replace(/\bW\/RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+RES\b/gi, '').trim();
  t = t.replace(/\bWITH\s+NAV(IGATION)?\b/gi, '').trim();
  t = t.replace(/\s+\-/g, '-').replace(/\-\s+/g, '-').replace(/\s+/g, ' ').trim();

  if (/^[A-Z]{0,3}\d{2,3}[A-Z]?$/i.test(t)) return null;
  if (/^\d\.\d[a-z]{1,2}$/i.test(t)) return null;

  if (/,/.test(t)) t = t.split(',')[0].trim();
  if (/\//.test(t)) {
    var parts = t.split('/').map(function(p) { return p.trim(); }).filter(Boolean);
    t = parts[parts.length - 1];
  }

  if (!t || t.length < 2 || t.length > 30) return null;
  return t;
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
        transHint: cached.transmission_style || null,
        transSpeeds: cached.transmission_speeds || null,
        transSubType: cached.trans_sub_type || null,
        transSource: cached.trans_source || null,
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
  var rawSeries = vehicle.series || null;
  var trim = null;
  if (rawSeries) {
    // Tonnage patterns belong in model, not trim
    if (/^\d{3,4}(\s|\(|$)/.test(rawSeries) || /^\d\/\d\s*ton/i.test(rawSeries) || /^\d+$/.test(rawSeries)) {
      model = model ? model + ' ' + rawSeries : rawSeries;
    } else {
      // Run through junk filter before accepting as trim
      trim = cleanDecodedTrim(rawSeries);
    }
  }
  var bodyStyle = vehicle.bodyStyle || null;
  var driveType = vehicle.driveType || null;
  var fuelType = vehicle.fuelType || corgiEngine.fuel || null;

  var displacement = corgiEngine.displacement ? parseFloat(corgiEngine.displacement) : null;
  var cylinders = corgiEngine.cylinders ? parseInt(corgiEngine.cylinders) : null;

  // Engine fallback: if corgi has no engine data, check old vin_cache (may have NHTSA data)
  if (!displacement && !cylinders) {
    try {
      var oldCache = await database('vin_cache').where('vin', vin).first();
      if (oldCache && oldCache.engine) {
        var engMatch = oldCache.engine.match(/^(\d+\.?\d*)L\s*(V?\d+|[\d]+-cyl)?/i);
        if (engMatch) {
          displacement = parseFloat(engMatch[1]);
          if (engMatch[2]) {
            var cylMatch = engMatch[2].match(/\d+/);
            if (cylMatch) cylinders = parseInt(cylMatch[0]);
          }
        }
      }
    } catch (e) { /* non-fatal */ }
  }

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
  var transSpeeds = null;
  var transSubType = null;
  var transSource = null;

  // Step 4.5: EPA transmission resolution
  if (!transHint) {
    try {
      var epaResult = await resolveTransmission(year, make, model, displacement, cylinders, trim);
      if (epaResult) {
        transHint = epaResult.transType;
        transSpeeds = epaResult.transSpeeds || null;
        transSubType = epaResult.transSubType || null;
        transSource = epaResult.source;
        source += '+epa';
      }
    } catch (e) {
      log.debug({ err: e.message }, 'LocalVinDecoder: EPA transmission resolution failed (non-fatal)');
    }
  }

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
      transmission_style: transHint || null,
      transmission_speeds: transSpeeds || null,
      trans_sub_type: transSubType || null,
      trans_source: transSource || null,
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
    transSpeeds: transSpeeds,
    transSubType: transSubType,
    transSource: transSource,
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
        TransmissionSpeeds: d.transSpeeds || null,
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
