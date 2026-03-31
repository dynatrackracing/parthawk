'use strict';

const { database } = require('../database/database');

// ── Part type extraction ──────────────────────────────────

const PART_TYPE_PATTERNS = [
  { pattern: /\b(ECM|ECU|PCM|Engine\s*(?:Control|Computer)\s*Module)\b/i, type: 'ECM' },
  { pattern: /\b(BCM|Body\s*Control\s*Module)\b/i, type: 'BCM' },
  { pattern: /\b(TCM|Transmission\s*Control\s*Module)\b/i, type: 'TCM' },
  { pattern: /\b(ABS|Anti[- ]?Lock\s*Brake)\b/i, type: 'ABS' },
  { pattern: /\b(TIPM|Totally?\s*Integrated\s*Power\s*Module)\b/i, type: 'TIPM' },
  { pattern: /\b(Fuse\s*Box|Power\s*Distribution|Junction\s*Box)\b/i, type: 'FUSE BOX' },
  { pattern: /\bAmplifier\b/i, type: 'AMPLIFIER' },
  { pattern: /\b(Radio|Head\s*Unit|Stereo|CD\s*Player|Navigation)\b/i, type: 'RADIO' },
  { pattern: /\b(Cluster|Instrument\s*Cluster|Speedometer)\b/i, type: 'CLUSTER' },
  { pattern: /\b(Throttle\s*Body)\b/i, type: 'THROTTLE BODY' },
  { pattern: /\b(Steering\s*(?:Control\s*)?Module|EPS\s*Module|Power\s*Steering\s*Module)\b/i, type: 'STEERING MODULE' },
  { pattern: /\b(HVAC\s*(?:Control\s*)?Module|Climate\s*Control\s*Module)\b/i, type: 'HVAC MODULE' },
  { pattern: /\b(Airbag\s*Module|SRS\s*Module|Restraint)\b/i, type: 'AIRBAG MODULE' },
  { pattern: /\b(Transfer\s*Case\s*(?:Control\s*)?Module)\b/i, type: 'TRANSFER CASE MODULE' },
  { pattern: /\b(Liftgate\s*Module|Tailgate\s*Module)\b/i, type: 'LIFTGATE MODULE' },
  { pattern: /\b(Camera|Backup\s*Camera|Rear\s*View)\b/i, type: 'CAMERA' },
  { pattern: /\b(Blind\s*Spot|BSM)\b/i, type: 'BLIND SPOT' },
  { pattern: /\b(Parking\s*Sensor|Park\s*Assist)\b/i, type: 'PARKING SENSOR' },
  { pattern: /\b(Key\s*Fob|Keyless|Smart\s*Key|Remote)\b/i, type: 'KEY FOB' },
  { pattern: /\b(Turbo|Turbocharger)\b/i, type: 'TURBO' },
  { pattern: /\b(Alternator)\b/i, type: 'ALTERNATOR' },
  { pattern: /\b(Starter|Starter\s*Motor)\b/i, type: 'STARTER' },
  { pattern: /\b(AC\s*Compressor|A\/C\s*Compressor)\b/i, type: 'AC COMPRESSOR' },
  { pattern: /\b(Intake\s*Manifold)\b/i, type: 'INTAKE MANIFOLD' },
  { pattern: /\b(Fuel\s*Injector)\b/i, type: 'FUEL INJECTOR' },
  { pattern: /\b(Ignition\s*Coil|Coil\s*Pack)\b/i, type: 'IGNITION COIL' },
  { pattern: /\b(Window\s*Motor|Window\s*Regulator)\b/i, type: 'WINDOW MOTOR' },
  { pattern: /\b(Door\s*Lock\s*Actuator)\b/i, type: 'DOOR LOCK' },
  { pattern: /\b(Wiper\s*Motor)\b/i, type: 'WIPER MOTOR' },
  { pattern: /\b(Blower\s*Motor)\b/i, type: 'BLOWER MOTOR' },
  { pattern: /\b(Seat\s*Module|Seat\s*(?:Control\s*)?Module)\b/i, type: 'SEAT MODULE' },
];

function extractPartTypeFromTitle(title) {
  if (!title) return 'OTHER';
  for (const { pattern, type } of PART_TYPE_PATTERNS) {
    if (pattern.test(title)) return type;
  }
  return 'OTHER';
}

// ── Make/model extraction ─────────────────────────────────

const KNOWN_MAKES = [
  'Ford', 'Chevrolet', 'Chevy', 'Dodge', 'Ram', 'Chrysler', 'Jeep',
  'Toyota', 'Honda', 'Nissan', 'Hyundai', 'Kia', 'Subaru', 'Mazda', 'Mitsubishi',
  'BMW', 'Mercedes', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'VW', 'Mini', 'Porsche',
  'Lexus', 'Acura', 'Infiniti', 'Genesis',
  'Cadillac', 'Buick', 'GMC', 'Lincoln', 'Pontiac', 'Saturn', 'Oldsmobile',
  'Jaguar', 'Land Rover', 'Fiat', 'Alfa Romeo', 'Saab', 'Suzuki', 'Scion',
];

const MAKE_NORMALIZE = { 'chevy': 'Chevrolet', 'vw': 'Volkswagen', 'mercedes-benz': 'Mercedes' };

const MODEL_STOP_WORDS = new Set([
  'oem', 'genuine', 'programmed', 'assembly', 'module', 'control', 'computer',
  'unit', 'electronic', 'anti', 'lock', 'brake', 'engine', 'pump', 'fuse',
  'box', 'power', 'new', 'used', 'tested', 'rebuilt', 'remanufactured',
  'replacement', 'original', 'factory', 'stock', 'body', 'ecm', 'ecu', 'pcm',
  'bcm', 'tcm', 'abs', 'tipm', 'srs', 'hvac',
]);

function extractMakeModel(title) {
  if (!title) return { make: 'UNKNOWN', model: 'UNKNOWN' };
  const titleLower = title.toLowerCase();
  let foundMake = null;
  let makeIndex = -1;

  for (const make of KNOWN_MAKES) {
    const idx = titleLower.indexOf(make.toLowerCase());
    if (idx !== -1 && (makeIndex === -1 || idx < makeIndex)) {
      foundMake = make;
      makeIndex = idx;
    }
  }

  if (!foundMake) return { make: 'UNKNOWN', model: 'UNKNOWN' };
  const normalizedMake = MAKE_NORMALIZE[foundMake.toLowerCase()] || foundMake;

  const afterMake = title.substring(makeIndex + foundMake.length).trim();
  const words = afterMake.split(/\s+/);
  const modelWords = [];
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9-]/g, '');
    if (!clean) continue;
    if (MODEL_STOP_WORDS.has(clean.toLowerCase())) break;
    if (/^\d{4}$/.test(clean)) continue;
    if (clean.length < 2) continue;
    modelWords.push(clean);
    if (modelWords.length >= 3) break;
  }

  return { make: normalizedMake, model: modelWords.length > 0 ? modelWords.join(' ') : 'UNKNOWN' };
}

function extractYearRange(title) {
  const years = [];
  const yearPattern = /\b(19[89]\d|20[0-2]\d)\b/g;
  let match;
  while ((match = yearPattern.exec(title)) !== null) years.push(parseInt(match[1], 10));
  if (years.length === 0) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? `${min}` : `${min}-${max}`;
}

// ── Scoring ───────────────────────────────────────────────

function calcPhoenixScore(salesCount, avgPrice) {
  // Velocity (40pts)
  let velocity = salesCount >= 10 ? 40 : salesCount >= 7 ? 32 : salesCount >= 5 ? 24 : salesCount >= 3 ? 16 : salesCount >= 2 ? 10 : 5;

  // Revenue potential (35pts)
  const totalRevenue = salesCount * avgPrice;
  let revenue = totalRevenue >= 2000 ? 35 : totalRevenue >= 1000 ? 28 : totalRevenue >= 500 ? 21 : totalRevenue >= 200 ? 14 : 7;

  // Price sweet spot (25pts)
  let priceSpot = avgPrice >= 150 && avgPrice <= 400 ? 25 : avgPrice >= 100 && avgPrice < 150 ? 20 : avgPrice > 400 && avgPrice <= 600 ? 18 : avgPrice >= 50 && avgPrice < 100 ? 12 : avgPrice > 600 ? 8 : 3;

  return velocity + revenue + priceSpot;
}

// ── Service ───────────────────────────────────────────────

class PhoenixService {

  async getRebuildSellers() {
    const rows = await database.raw(`
      SELECT name, enabled, "itemsScraped", "lastScrapedAt", "createdAt"
      FROM "SoldItemSeller" WHERE type = 'rebuild' ORDER BY "itemsScraped" DESC
    `);
    return rows.rows;
  }

  async addRebuildSeller(sellerName) {
    const name = (sellerName || '').trim().toLowerCase();
    if (!name) throw new Error('Seller name is required');
    await database.raw(`
      INSERT INTO "SoldItemSeller" (name, enabled, type, "createdAt", "updatedAt")
      VALUES (?, true, 'rebuild', NOW(), NOW())
      ON CONFLICT (name) DO UPDATE SET type = 'rebuild', enabled = true, "updatedAt" = NOW()
    `, [name]);
    const row = await database('SoldItemSeller').where({ name }).first();
    return row;
  }

  async removeRebuildSeller(sellerName) {
    const name = (sellerName || '').trim().toLowerCase();
    const updated = await database('SoldItemSeller')
      .where({ name, type: 'rebuild' })
      .update({ type: 'competitor', updatedAt: new Date() });
    return updated > 0 ? { removed: true } : { removed: false, reason: 'not found' };
  }

  async getPhoenixStats({ days = 180, seller = null }) {
    const sellers = await this.getRebuildSellers();
    const enabledNames = sellers.filter(s => s.enabled).map(s => s.name);
    if (enabledNames.length === 0) return { totalGroups: 0, totalSales: 0, totalRevenue: 0, avgPrice: 0, topPartType: null, topMake: null, dateRange: {}, sellers: [] };

    const names = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const items = await database('SoldItem')
      .whereIn('seller', names)
      .where('soldDate', '>=', cutoff)
      .select('title', 'soldPrice');

    let totalRevenue = 0;
    const partTypeCounts = {};
    const makeCounts = {};
    for (const item of items) {
      totalRevenue += parseFloat(item.soldPrice) || 0;
      const pt = extractPartTypeFromTitle(item.title);
      partTypeCounts[pt] = (partTypeCounts[pt] || 0) + 1;
      const { make } = extractMakeModel(item.title);
      makeCounts[make] = (makeCounts[make] || 0) + 1;
    }

    const topPartType = Object.entries(partTypeCounts).sort((a, b) => b[1] - a[1])[0];
    const topMake = Object.entries(makeCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      totalGroups: 0, // filled by caller if needed
      totalSales: items.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgPrice: items.length > 0 ? Math.round((totalRevenue / items.length) * 100) / 100 : 0,
      topPartType: topPartType ? topPartType[0] : null,
      topMake: topMake ? topMake[0] : null,
      sellers: enabledNames,
    };
  }

  async getPhoenixList({ days = 180, limit = 100, seller = null }) {
    const sellers = await this.getRebuildSellers();
    const enabledNames = sellers.filter(s => s.enabled).map(s => s.name);
    if (enabledNames.length === 0) return [];

    const names = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const items = await database('SoldItem')
      .whereIn('seller', names)
      .where('soldDate', '>=', cutoff)
      .orderBy('soldDate', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'seller', 'pictureUrl');

    // Group by partType|MAKE|MODEL
    const groups = new Map();
    for (const item of items) {
      const partType = extractPartTypeFromTitle(item.title);
      const { make, model } = extractMakeModel(item.title);
      const yearRange = extractYearRange(item.title);
      const groupKey = `${partType}|${make.toUpperCase()}|${model.toUpperCase()}`;
      const price = parseFloat(item.soldPrice) || 0;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey, partType, make, model, yearRange,
          prices: [], dates: [], sellers: new Set(), sellerCounts: {},
          sampleTitles: [], sampleImage: null,
        });
      }

      const g = groups.get(groupKey);
      g.prices.push(price);
      g.dates.push(item.soldDate);
      g.sellers.add(item.seller);
      g.sellerCounts[item.seller] = (g.sellerCounts[item.seller] || 0) + 1;
      if (g.sampleTitles.length < 3) g.sampleTitles.push(item.title);
      if (!g.sampleImage && item.pictureUrl) g.sampleImage = item.pictureUrl;
      if (!g.yearRange && yearRange) g.yearRange = yearRange;
    }

    // Score and format
    const results = [];
    for (const g of groups.values()) {
      const salesCount = g.prices.length;
      const avgPrice = Math.round((g.prices.reduce((a, b) => a + b, 0) / salesCount) * 100) / 100;
      const totalRevenue = Math.round(salesCount * avgPrice * 100) / 100;
      const phoenixScore = calcPhoenixScore(salesCount, avgPrice);

      results.push({
        groupKey: g.groupKey,
        partType: g.partType,
        make: g.make,
        model: g.model,
        yearRange: g.yearRange,
        salesCount,
        avgPrice,
        minPrice: Math.min(...g.prices),
        maxPrice: Math.max(...g.prices),
        totalRevenue,
        lastSoldDate: g.dates[0],
        sellers: [...g.sellers],
        sellerBreakdown: g.sellerCounts,
        sampleTitles: g.sampleTitles,
        sampleImage: g.sampleImage,
        phoenixScore,
      });
    }

    results.sort((a, b) => b.phoenixScore - a.phoenixScore || b.salesCount - a.salesCount);
    return results.slice(0, limit);
  }
}

module.exports = PhoenixService;
