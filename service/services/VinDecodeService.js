'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const axios = require('axios');

/**
 * VinDecodeService — Decode VINs via NHTSA API with caching.
 * Same VIN never decoded twice (vin_cache table).
 */
class VinDecodeService {
  constructor() {
    this.log = log.child({ class: 'VinDecodeService' }, true);
  }

  /**
   * Decode a VIN. Returns cached result if available.
   */
  async decode(vin) {
    if (!vin || vin.length < 11) return null;
    vin = vin.trim().toUpperCase();

    // Check cache first
    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) return this.formatCached(cached);
    } catch (e) { /* table may not exist */ }

    // Call NHTSA API
    try {
      const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`;
      const res = await axios.get(url, { timeout: 10000 });
      const results = res.data?.Results || [];
      const decoded = this.parseNHTSA(results);

      // Cache it
      try {
        await database('vin_cache').insert({
          vin,
          year: decoded.year,
          make: decoded.make,
          model: decoded.model,
          trim: decoded.trim,
          engine: decoded.engine,
          drivetrain: decoded.drivetrain,
          body_style: decoded.bodyStyle,
          decoded_at: new Date(),
          createdAt: new Date(),
        }).onConflict('vin').ignore();
      } catch (e) { /* ignore cache insert errors */ }

      return decoded;
    } catch (err) {
      this.log.warn({ err: err.message, vin }, 'NHTSA decode failed');
      return null;
    }
  }

  parseNHTSA(results) {
    const get = (varId) => {
      const item = results.find(r => r.VariableId === varId);
      const val = item?.Value?.trim();
      return (val && val !== '' && val !== 'Not Applicable') ? val : null;
    };

    const displacement = get(13); // Displacement (L)
    const cylinders = get(71);    // Cylinders
    let engine = null;
    if (displacement) {
      engine = displacement.includes('L') ? displacement : displacement + 'L';
      if (cylinders) engine += ' ' + cylinders + 'cyl';
    }

    const fuelType = get(24);     // Fuel Type
    let engineType = 'Gas';
    if (fuelType) {
      const ft = fuelType.toLowerCase();
      if (ft.includes('diesel')) engineType = 'Diesel';
      else if (ft.includes('hybrid')) engineType = 'Hybrid';
      else if (ft.includes('electric') && !ft.includes('hybrid')) engineType = 'Electric';
      else if (ft.includes('flex')) engineType = 'Flex Fuel';
    }

    const driveType = get(15);    // Drive Type
    let drivetrain = null;
    if (driveType) {
      const dt = driveType.toUpperCase();
      if (dt.includes('4WD') || dt.includes('4X4') || dt.includes('4-WHEEL')) drivetrain = '4WD';
      else if (dt.includes('AWD') || dt.includes('ALL-WHEEL') || dt.includes('ALL WHEEL')) drivetrain = 'AWD';
      else if (dt.includes('FWD') || dt.includes('FRONT-WHEEL') || dt.includes('FRONT WHEEL')) drivetrain = 'FWD';
      else if (dt.includes('RWD') || dt.includes('REAR-WHEEL') || dt.includes('REAR WHEEL')) drivetrain = 'RWD';
      else drivetrain = driveType;
    }

    return {
      year: get(29) ? parseInt(get(29)) : null,
      make: get(26),
      model: get(28),
      trim: get(38),
      engine,
      engineType,
      drivetrain,
      bodyStyle: get(5),
    };
  }

  formatCached(row) {
    return {
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim,
      engine: row.engine,
      engineType: null, // not stored in old cache schema
      drivetrain: row.drivetrain,
      bodyStyle: row.body_style,
    };
  }

  /**
   * Batch decode all undecoded yard_vehicle VINs.
   * Rate limited: 200ms between calls.
   */
  async decodeAllUndecoded() {
    let vehicles;
    try {
      vehicles = await database('yard_vehicle')
        .whereNotNull('vin')
        .where('vin', '!=', '')
        .where(function() {
          this.where('vin_decoded', false).orWhereNull('vin_decoded');
        })
        .select('id', 'vin')
        .limit(200);
    } catch (e) {
      this.log.warn({ err: e.message }, 'Could not query undecoded vehicles');
      return { decoded: 0, errors: 0 };
    }

    this.log.info({ count: vehicles.length }, 'Decoding VINs');
    let decoded = 0, errors = 0;

    for (const v of vehicles) {
      const result = await this.decode(v.vin);
      if (result) {
        try {
          const updates = { vin_decoded: true, updatedAt: new Date() };
          if (result.engine) updates.engine = result.engine;
          if (result.engineType) updates.engine_type = result.engineType;
          if (result.drivetrain) updates.drivetrain = result.drivetrain;
          if (result.trim) updates.trim_level = result.trim;
          if (result.bodyStyle) updates.body_style = result.bodyStyle;
          await database('yard_vehicle').where('id', v.id).update(updates);
          decoded++;
        } catch (e) {
          errors++;
        }
      } else {
        errors++;
      }
      // Rate limit: 200ms between NHTSA calls
      await new Promise(r => setTimeout(r, 200));
    }

    this.log.info({ decoded, errors }, 'VIN decode batch complete');
    return { decoded, errors };
  }
}

module.exports = VinDecodeService;
