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
  { pattern: /\b(Steering\s*(?:Control\s*)?Module|EPS\s*Module)\b/i, type: 'STEERING MODULE' },
  { pattern: /\b(HVAC\s*(?:Control\s*)?Module|Climate\s*Control)\b/i, type: 'HVAC MODULE' },
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

// ── Make/Model extraction for fallback grouping ──────────

const KNOWN_MAKES = ['FORD','CHEVROLET','CHEVY','DODGE','RAM','CHRYSLER','JEEP','TOYOTA','HONDA','NISSAN','HYUNDAI','KIA','SUBARU','MAZDA','MITSUBISHI','BMW','MERCEDES','AUDI','VOLKSWAGEN','VOLVO','MINI','PORSCHE','LEXUS','ACURA','INFINITI','GENESIS','CADILLAC','BUICK','GMC','LINCOLN','PONTIAC','SATURN','JAGUAR','FIAT','SCION','SUZUKI'];
const STOP_WORDS = new Set(['OEM','GENUINE','PROGRAMMED','REBUILT','PLUG','PLAY','ASSEMBLY','MODULE','UNIT','REMAN','NEW','USED','TESTED','ENGINE','CONTROL','COMPUTER','ELECTRONIC','ANTI','LOCK','BRAKE','PUMP','FUSE','POWER','BOX','BODY','TRANSMISSION','ECU','ECM','PCM','BCM','TCM','ABS','TIPM','SRS','HVAC','INSTRUMENT','CLUSTER','SPEEDOMETER','RADIO','HEAD','STEREO','AMPLIFIER','THROTTLE','INTAKE','ALTERNATOR','STARTER','TURBO','CAMERA','SENSOR','WORKING','FAST','FREE','SHIPPING']);

function extractMakeModelFromTitle(title) {
  if (!title) return { make: null, model: null };
  const upper = title.toUpperCase();
  let make = null;
  for (const m of KNOWN_MAKES) {
    if (upper.includes(m)) { make = m; break; }
  }
  if (!make) return { make: null, model: null };

  const afterMake = upper.substring(upper.indexOf(make) + make.length).trim();
  const words = afterMake.replace(/[^A-Z0-9\s]/g, '').split(/\s+/);
  const modelWords = [];
  for (const w of words) {
    if (!w || w.length < 2 || /^\d{4}$/.test(w) || STOP_WORDS.has(w)) continue;
    modelWords.push(w);
    if (modelWords.length >= 2) break;
  }
  return { make, model: modelWords.join(' ') || null };
}

// ── Seller name mapping ───────────────────────────────────
// Item.seller uses 'pro-rebuild', SoldItemSeller uses 'prorebuild'
function getItemSellerVariants(soldItemName) {
  const variants = [soldItemName];
  if (!soldItemName.includes('-')) variants.push(soldItemName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase());
  // prorebuild → pro-rebuild
  if (soldItemName === 'prorebuild') variants.push('pro-rebuild');
  // pro-rebuild → prorebuild
  if (soldItemName === 'pro-rebuild') variants.push('prorebuild');
  return [...new Set(variants)];
}

// ── Scoring ───────────────────────────────────────────────

function calcPhoenixScore(salesCount, avgPrice, marketSold90d) {
  // Velocity (35pts) — from SoldItem
  let velocity = salesCount >= 10 ? 35 : salesCount >= 7 ? 28 : salesCount >= 5 ? 21 : salesCount >= 3 ? 14 : salesCount >= 2 ? 8 : salesCount >= 1 ? 4 : 0;

  // Revenue (25pts)
  const totalRevenue = salesCount * avgPrice;
  let revenue = totalRevenue >= 2000 ? 25 : totalRevenue >= 1000 ? 20 : totalRevenue >= 500 ? 15 : totalRevenue >= 200 ? 10 : totalRevenue > 0 ? 5 : 0;

  // Price sweet spot (20pts) — use whatever price we have
  let priceSpot = 0;
  if (avgPrice > 0) {
    priceSpot = avgPrice >= 150 && avgPrice <= 400 ? 20 : avgPrice >= 100 && avgPrice < 150 ? 16 : avgPrice > 400 && avgPrice <= 600 ? 14 : avgPrice >= 50 && avgPrice < 100 ? 10 : avgPrice > 600 ? 6 : 2;
  }

  // Market demand (20pts) — from market_demand_cache
  let market = 0;
  if (marketSold90d > 0) {
    market = marketSold90d >= 50 ? 20 : marketSold90d >= 30 ? 16 : marketSold90d >= 15 ? 12 : marketSold90d >= 5 ? 8 : 4;
  }

  return { total: velocity + revenue + priceSpot + market, velocity, revenue, priceSpot, market };
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
    return database('SoldItemSeller').where({ name }).first();
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
    if (enabledNames.length === 0) return { totalGroups: 0, totalSales: 0, totalRevenue: 0, avgPrice: 0, topPartType: null, topMake: null, sellers: [], catalogItems: 0, itemsWithFitment: 0, itemsWithPartNumber: 0, marketCacheHits: 0 };

    // Catalog stats from Item table
    const itemSellerNames = [];
    for (const n of enabledNames) itemSellerNames.push(...getItemSellerVariants(n));
    const catalogCount = await database('Item').whereIn('seller', itemSellerNames).count('id as cnt').first();
    const fitmentCount = await database('Item as i').join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id').whereIn('i.seller', itemSellerNames).countDistinct('i.id as cnt').first();
    const pnCount = await database('Item').whereIn('seller', itemSellerNames).whereNotNull('partNumberBase').countDistinct('partNumberBase as cnt').first();

    // Sales stats from SoldItem
    const names = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const items = await database('SoldItem').whereIn('seller', names).where('soldDate', '>=', cutoff).select('title', 'soldPrice');

    let totalRevenue = 0;
    const partTypeCounts = {};
    for (const item of items) {
      totalRevenue += parseFloat(item.soldPrice) || 0;
      const pt = extractPartTypeFromTitle(item.title);
      partTypeCounts[pt] = (partTypeCounts[pt] || 0) + 1;
    }
    const topPartType = Object.entries(partTypeCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      totalGroups: 0,
      totalSales: items.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgPrice: items.length > 0 ? Math.round((totalRevenue / items.length) * 100) / 100 : 0,
      topPartType: topPartType ? topPartType[0] : null,
      sellers: enabledNames,
      catalogItems: parseInt(catalogCount.cnt) || 0,
      itemsWithFitment: parseInt(fitmentCount.cnt) || 0,
      itemsWithPartNumber: parseInt(pnCount.cnt) || 0,
      marketCacheHits: 0,
    };
  }

  async getPhoenixList({ days = 180, limit = 100, seller = null }) {
    const sellers = await this.getRebuildSellers();
    const enabledNames = sellers.filter(s => s.enabled).map(s => s.name);
    if (enabledNames.length === 0) return [];

    // ── Layer 1: Item catalog with fitment ──
    const itemSellerNames = [];
    for (const n of enabledNames) itemSellerNames.push(...getItemSellerVariants(n));

    const catalogRows = await database('Item as i')
      .join('AutoItemCompatibility as aic', 'aic.itemId', 'i.id')
      .join('Auto as a', 'a.id', 'aic.autoId')
      .whereIn('i.seller', itemSellerNames)
      .select('i.id as itemId', 'i.title', 'i.price', 'i.partNumberBase',
              'i.manufacturerPartNumber', 'i.categoryTitle', 'i.pictureUrl',
              'a.year', 'a.make', 'a.model', 'a.trim', 'a.engine');

    // Group by partNumberBase (primary) or title-based fallback
    const groups = new Map();

    for (const row of catalogRows) {
      const partType = extractPartTypeFromTitle(row.title || row.categoryTitle || '');
      const pnBase = row.partNumberBase || null;
      const groupKey = pnBase || (partType + '|' + (row.make || 'UNK').toUpperCase() + '|' + (row.model || 'UNK').toUpperCase());
      const groupType = pnBase ? 'part_number' : 'title_match';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey, groupType, partNumberBase: pnBase,
          manufacturerPartNumber: row.manufacturerPartNumber || null,
          partType, fitment: [], fitmentSet: new Set(),
          makes: new Set(), models: new Set(), years: [],
          catalogCount: 0, catalogItemIds: new Set(),
          catalogImage: null, sampleTitles: [],
          listingPrice: null,
          // Sales (filled in Layer 2)
          salesCount: 0, soldPrices: [], lastSoldDate: null, soldSellers: new Set(), sellerCounts: {},
          // Market (filled in Layer 3)
          marketAvgPrice: null, marketSold90d: 0, marketScore: null,
        });
      }

      const g = groups.get(groupKey);
      if (!g.catalogItemIds.has(row.itemId)) {
        g.catalogItemIds.add(row.itemId);
        g.catalogCount++;
        if (!g.catalogImage && row.pictureUrl) g.catalogImage = row.pictureUrl;
        if (g.sampleTitles.length < 3 && row.title) g.sampleTitles.push(row.title);
        if (!g.listingPrice && row.price) g.listingPrice = parseFloat(row.price);
        if (!g.manufacturerPartNumber && row.manufacturerPartNumber) g.manufacturerPartNumber = row.manufacturerPartNumber;
      }

      // Fitment dedup
      const fitKey = `${row.year}|${(row.make || '').toUpperCase()}|${(row.model || '').toUpperCase()}|${row.engine || ''}`;
      if (!g.fitmentSet.has(fitKey)) {
        g.fitmentSet.add(fitKey);
        g.fitment.push({ year: row.year, make: row.make, model: row.model, trim: row.trim, engine: row.engine });
        if (row.make) g.makes.add(row.make);
        if (row.model) g.models.add(row.model);
        if (row.year) g.years.push(row.year);
      }
    }

    // ── Layer 2: SoldItem velocity ──
    const soldNames = seller && enabledNames.includes(seller) ? [seller] : enabledNames;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const soldItems = await database('SoldItem')
      .whereIn('seller', soldNames)
      .where('soldDate', '>=', cutoff)
      .orderBy('soldDate', 'desc')
      .select('title', 'soldPrice', 'soldDate', 'seller', 'partNumberBase', 'partType', 'extractedMake', 'extractedModel');

    // Match sold items to catalog groups by PN
    const pnBaseSet = new Map(); // normalized pnBase → groupKey
    for (const [key, g] of groups) {
      if (g.partNumberBase) {
        const norm = g.partNumberBase.replace(/[\s\-\.]/g, '').toUpperCase();
        pnBaseSet.set(norm, key);
      }
    }

    for (const sold of soldItems) {
      let matched = false;

      // FAST PATH: direct partNumberBase column lookup
      if (sold.partNumberBase) {
        const normSoldPn = sold.partNumberBase.replace(/[\s\-\.]/g, '').toUpperCase();
        if (pnBaseSet.has(normSoldPn)) {
          const g = groups.get(pnBaseSet.get(normSoldPn));
          g.salesCount++;
          g.soldPrices.push(parseFloat(sold.soldPrice) || 0);
          if (!g.lastSoldDate) g.lastSoldDate = sold.soldDate;
          g.soldSellers.add(sold.seller);
          g.sellerCounts[sold.seller] = (g.sellerCounts[sold.seller] || 0) + 1;
          matched = true;
        }
      }

      // SLOW PATH: title scan fallback for records without partNumberBase
      if (!matched) {
        const title = (sold.title || '').toUpperCase();
        for (const [pn, gKey] of pnBaseSet) {
          if (title.includes(pn)) {
            const g = groups.get(gKey);
            g.salesCount++;
            g.soldPrices.push(parseFloat(sold.soldPrice) || 0);
            if (!g.lastSoldDate) g.lastSoldDate = sold.soldDate;
            g.soldSellers.add(sold.seller);
            g.sellerCounts[sold.seller] = (g.sellerCounts[sold.seller] || 0) + 1;
            matched = true;
            break;
          }
        }
      }

      // Fallback: create standalone group from SoldItem
      if (!matched) {
        const pt = sold.partType && sold.partType !== 'OTHER' ? sold.partType : extractPartTypeFromTitle(sold.title);
        if (pt !== 'OTHER') {
          const make = sold.extractedMake ? sold.extractedMake.toUpperCase() : null;
          const model = sold.extractedModel ? sold.extractedModel.toUpperCase() : null;
          if (!make) {
            const extracted = extractMakeModelFromTitle(sold.title);
            var fallbackMake = extracted.make;
            var fallbackModel = extracted.model;
          } else {
            var fallbackMake = make;
            var fallbackModel = model;
          }
          // Include make/model when available for granular groups; fall back to seller-only
          const fallbackKey = fallbackMake
            ? 'SOLD|' + pt + '|' + fallbackMake + '|' + (fallbackModel || 'UNK')
            : 'SOLD|' + pt + '|' + sold.seller;
          if (!groups.has(fallbackKey)) {
            groups.set(fallbackKey, {
              groupKey: fallbackKey, groupType: 'sold_only', partNumberBase: null,
              manufacturerPartNumber: null, partType: pt,
              fitment: [], fitmentSet: new Set(),
              makes: fallbackMake ? new Set([fallbackMake]) : new Set(),
              models: fallbackModel ? new Set([fallbackModel]) : new Set(),
              years: [],
              catalogCount: 0, catalogItemIds: new Set(), catalogImage: null,
              sampleTitles: [sold.title], listingPrice: null,
              salesCount: 0, soldPrices: [], lastSoldDate: null, soldSellers: new Set(), sellerCounts: {},
              marketAvgPrice: null, marketSold90d: 0, marketScore: null,
            });
          }
          const g = groups.get(fallbackKey);
          g.salesCount++;
          g.soldPrices.push(parseFloat(sold.soldPrice) || 0);
          if (!g.lastSoldDate) g.lastSoldDate = sold.soldDate;
          g.soldSellers.add(sold.seller);
          g.sellerCounts[sold.seller] = (g.sellerCounts[sold.seller] || 0) + 1;
          if (g.sampleTitles.length < 3) g.sampleTitles.push(sold.title);
          if (fallbackMake) g.makes.add(fallbackMake);
          if (fallbackModel) g.models.add(fallbackModel);
        }
      }
    }

    // ── Layer 3: market_demand_cache (keyed by real part numbers) ──
    // Collect partNumberBase values from groups that have them
    const pnToGroups = new Map(); // partNumberBase → [groupKey, ...]
    for (const [gKey, g] of groups) {
      if (g.partNumberBase) {
        const pn = g.partNumberBase;
        if (!pnToGroups.has(pn)) pnToGroups.set(pn, []);
        pnToGroups.get(pn).push(gKey);
      }
    }

    if (pnToGroups.size > 0) {
      try {
        const marketRows = await database('market_demand_cache')
          .whereIn('part_number_base', [...pnToGroups.keys()])
          .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d', 'ebay_median_price', 'market_score');

        for (const mr of marketRows) {
          const gKeys = pnToGroups.get(mr.part_number_base) || [];
          for (const gKey of gKeys) {
            const g = groups.get(gKey);
            if (g && !g.marketAvgPrice) {
              g.marketAvgPrice = parseFloat(mr.ebay_median_price || mr.ebay_avg_price) || null;
              g.marketSold90d = parseInt(mr.ebay_sold_90d) || 0;
              g.marketScore = mr.market_score ? parseInt(mr.market_score) : null;
            }
          }
        }
      } catch (e) { /* market cache may not exist */ }
    }

    // ── Score and format ──
    const results = [];
    for (const g of groups.values()) {
      const avgSoldPrice = g.soldPrices.length > 0
        ? Math.round((g.soldPrices.reduce((a, b) => a + b, 0) / g.soldPrices.length) * 100) / 100
        : 0;
      const bestPrice = g.marketAvgPrice || avgSoldPrice || g.listingPrice || 0;
      const score = calcPhoenixScore(g.salesCount, avgSoldPrice, g.marketSold90d);

      // Skip groups with no signal at all
      if (score.total === 0 && g.catalogCount === 0) continue;

      const yearsSorted = g.years.length > 0 ? [...new Set(g.years)].sort() : [];
      const yearRange = yearsSorted.length > 0
        ? (yearsSorted[0] === yearsSorted[yearsSorted.length - 1] ? `${yearsSorted[0]}` : `${yearsSorted[0]}-${yearsSorted[yearsSorted.length - 1]}`)
        : null;

      const makesArr = [...g.makes];
      const modelsArr = [...g.models];
      const fitmentSummary = makesArr.length > 0
        ? makesArr[0] + (modelsArr.length > 0 ? ' ' + modelsArr[0] : '') + (yearRange ? ' ' + yearRange : '')
        : null;

      results.push({
        groupKey: g.groupKey,
        groupType: g.groupType,
        partNumberBase: g.partNumberBase,
        manufacturerPartNumber: g.manufacturerPartNumber,
        partType: g.partType,
        fitment: g.fitment.slice(0, 10),
        fitmentSummary,
        makes: makesArr,
        models: modelsArr,
        yearRange,
        catalogCount: g.catalogCount,
        catalogImage: g.catalogImage,
        sampleTitles: g.sampleTitles,
        salesCount: g.salesCount,
        avgSoldPrice,
        minSoldPrice: g.soldPrices.length > 0 ? Math.min(...g.soldPrices) : null,
        maxSoldPrice: g.soldPrices.length > 0 ? Math.max(...g.soldPrices) : null,
        totalRevenue: Math.round(g.salesCount * avgSoldPrice * 100) / 100,
        lastSoldDate: g.lastSoldDate,
        soldSellers: [...g.soldSellers],
        sellerBreakdown: g.sellerCounts,
        marketAvgPrice: g.marketAvgPrice,
        marketSold90d: g.marketSold90d,
        marketScore: g.marketScore,
        bestPrice: bestPrice,
        phoenixScore: score.total,
        scoreBreakdown: score,
      });
    }

    results.sort((a, b) => b.phoenixScore - a.phoenixScore || (b.marketSold90d || 0) - (a.marketSold90d || 0) || b.catalogCount - a.catalogCount);
    return results.slice(0, limit);
  }
}

module.exports = PhoenixService;
