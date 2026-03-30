'use strict';

const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');
const TrimTierService = require('./TrimTierService');

// Make → brand group mapping (from programming_db.json brandMap)
const BRAND_MAP = {
  'dodge': 'FCA', 'chrysler': 'FCA', 'jeep': 'FCA', 'ram': 'FCA', 'fiat': 'FCA',
  'ford': 'Ford', 'lincoln': 'Ford', 'mercury': 'Ford',
  'chevrolet': 'GM', 'chevy': 'GM', 'gmc': 'GM', 'buick': 'GM', 'cadillac': 'GM',
  'pontiac': 'GM', 'saturn': 'GM', 'oldsmobile': 'GM', 'hummer': 'GM',
  'honda': 'Honda', 'acura': 'Honda',
  'toyota': 'Toyota', 'lexus': 'Toyota', 'scion': 'Toyota',
  'nissan': 'Nissan', 'infiniti': 'Nissan',
  'hyundai': 'Hyundai_Kia', 'kia': 'Hyundai_Kia',
  'bmw': 'BMW', 'mini': 'BMW',
  'mercedes-benz': 'Mercedes', 'mercedes': 'Mercedes',
  'volkswagen': 'VW_Audi', 'vw': 'VW_Audi', 'audi': 'VW_Audi',
  'subaru': 'Subaru', 'mazda': 'Mazda', 'mitsubishi': 'Mitsubishi',
  'volvo': 'Volvo', 'jaguar': 'JLR', 'land rover': 'JLR',
};

// Part type → module type mapping
const MODULE_MAP = {
  'ecu': 'PCM', 'ecm': 'PCM', 'pcm': 'PCM',
  'bcm': 'BCM', 'tcm': 'TCM', 'tipm': 'TIPM', 'abs': 'ABS',
  'radio': 'RADIO_BASE',
};

class ListingIntelligenceService {

  async getIntelligence({ partNumber, year, make, model, engine, trim, partType }) {
    if (!partNumber) return { error: 'partNumber required' };

    const pnExact = partNumber.trim().toUpperCase();
    const pnBase = normalizePartNumber(pnExact);
    const yearNum = year ? parseInt(year) : null;

    // Run all lookups in parallel — each is individually try/caught
    const [programming, trimTier, fitmentCache, itemFitment, salesHistory] = await Promise.all([
      this.lookupProgramming(make, yearNum, partType, trim).catch(() => null),
      this.lookupTrimTier(yearNum, make, model, trim, engine).catch(() => null),
      this.lookupFitmentCache(pnBase, pnExact).catch(() => null),
      this.lookupItemFitment(pnBase, pnExact).catch(() => null),
      this.lookupSalesHistory(pnBase, pnExact).catch(() => null),
    ]);

    return {
      partNumber: pnExact,
      partNumberBase: pnBase,
      programming,
      trimTier,
      fitment: fitmentCache || itemFitment,
      fitmentSource: fitmentCache ? 'cache' : (itemFitment ? 'item_aic' : null),
      salesHistory,
    };
  }

  // ── Programming DB lookup ───────────────────────────────

  async lookupProgramming(make, year, partType, trim) {
    if (!make || !year) return null;

    const makeLower = (make || '').toLowerCase().trim();

    // Try direct match first
    let brandGroup = BRAND_MAP[makeLower];

    // If no match, try splitting on / (handles "BMW/MINI", "Chrysler/Dodge", etc.)
    if (!brandGroup && makeLower.includes('/')) {
      for (const part of makeLower.split('/')) {
        brandGroup = BRAND_MAP[part.trim()];
        if (brandGroup) break;
      }
    }

    if (!brandGroup) return null;

    let moduleType = MODULE_MAP[(partType || '').toLowerCase().trim()];
    if (!moduleType) return null;

    // Radio: check trim tier to decide BASE vs NAV
    if (moduleType === 'RADIO_BASE' && trim) {
      const trimLower = (trim || '').toLowerCase();
      if (/limited|platinum|denali|laramie|overland|summit|srt|gt|premium|navigation|nav/i.test(trimLower)) {
        moduleType = 'RADIO_NAV';
      }
    }

    const row = await database('programming_reference')
      .where({ brand_group: brandGroup, module_type: moduleType, year })
      .first();

    if (!row) return null;

    return {
      source: 'database',
      programmingRequired: row.required,
      notes: row.notes || null,
      brandGroup,
      moduleType,
    };
  }

  // ── Trim tier lookup ────────────────────────────────────

  async lookupTrimTier(year, make, model, trim, engine) {
    if (!year || !make || !model) return null;

    const result = await TrimTierService.lookup(year, make, model, trim, engine, null, null);
    if (!result) return null;

    return {
      tier: result.tierString,
      audioBrand: result.audioBrand || null,
      expectedParts: result.expectedParts || null,
      cultFlag: result.cult || false,
    };
  }

  // ── Fitment cache lookup ────────────────────────────────

  async lookupFitmentCache(pnBase, pnExact) {
    let cached = null;
    try {
      cached = await database('part_fitment_cache')
        .where('part_number_base', pnBase)
        .orWhere('part_number_exact', pnExact)
        .first();
    } catch (e) { /* table may not exist */ }
    if (!cached) {
      try {
        cached = await database('fitment_data')
          .where('part_number', pnExact)
          .orWhere('part_number_base', pnBase)
          .first();
      } catch (e) { /* table may not exist */ }
    }
    if (!cached) return null;

    return {
      source: 'cache',
      year: cached.year,
      make: cached.make,
      model: cached.model,
      engine: cached.engine,
      trim: cached.trim,
      doesNotFit: cached.does_not_fit || cached.doesNotFit || null,
      partName: cached.part_name || cached.partName || null,
      partType: cached.part_type || cached.partType || null,
    };
  }

  // ── Item + AIC fitment lookup ───────────────────────────

  async lookupItemFitment(pnBase, pnExact) {
    const rows = await database('Item as i')
      .join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id')
      .join('Auto as a', 'a.id', 'aic.autoId')
      .where(function() {
        this.where('i.manufacturerPartNumber', 'ilike', `%${pnBase}%`)
          .orWhere('i.manufacturerPartNumber', 'ilike', `%${pnExact}%`);
      })
      .select('a.year', 'a.make', 'a.model', 'a.engine', 'a.trim')
      .limit(50);

    if (rows.length === 0) return null;

    // Deduplicate
    const seen = new Set();
    const allVehicles = [];
    for (const r of rows) {
      const key = `${r.year}|${(r.make || '').toUpperCase()}|${(r.model || '').toUpperCase()}|${r.engine || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allVehicles.push({ year: r.year, make: r.make, model: r.model, engine: r.engine || null, trim: r.trim || null });
    }

    // Use first vehicle as primary
    const primary = allVehicles[0];
    return {
      source: 'item_aic',
      year: primary.year,
      make: primary.make,
      model: primary.model,
      engine: primary.engine,
      trim: primary.trim,
      doesNotFit: null,
      allVehicles,
    };
  }

  // ── Sales history lookup ────────────────────────────────

  async lookupSalesHistory(pnBase, pnExact) {
    const sales = await database('YourSale')
      .where(function() {
        this.where('title', 'ilike', `%${pnBase}%`)
          .orWhere('title', 'ilike', `%${pnExact}%`);
      })
      .whereNotNull('soldDate')
      .orderBy('soldDate', 'desc')
      .select('title', 'salePrice', 'soldDate')
      .limit(20);

    if (sales.length === 0) return null;

    const prices = sales.map(s => parseFloat(s.salePrice) || 0).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : 0;

    return {
      count: sales.length,
      avgPrice,
      lastSoldDate: sales[0].soldDate,
      recentSales: sales.slice(0, 5).map(s => ({
        title: s.title,
        salePrice: parseFloat(s.salePrice) || 0,
        soldDate: s.soldDate,
      })),
    };
  }
}

module.exports = ListingIntelligenceService;
