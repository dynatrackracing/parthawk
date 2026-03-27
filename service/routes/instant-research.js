'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const priceCheckService = require('../services/PriceCheckService');

const ENGINE_SPECIFIC = new Set(['ECM', 'PCM', 'ECU', 'TCM', 'THROTTLE']);
const STANDARD_TYPES = ['ECM', 'ABS', 'BCM', 'TCM', 'TIPM', 'AMPLIFIER', 'RADIO', 'CLUSTER', 'THROTTLE'];

const COGS = { ECM: 40, ABS: 75, BCM: 28, TCM: 50, TIPM: 35, AMPLIFIER: 20, RADIO: 28, CLUSTER: 32, THROTTLE: 36, DEFAULT: 30 };
const TYPE_RE = {
  ECM: /\b(ecm|pcm|ecu|engine\s*control|engine\s*computer)\b/i,
  ABS: /\b(abs|anti.?lock|brake\s*pump|brake\s*module)\b/i,
  BCM: /\b(bcm|body\s*control)\b/i,
  TCM: /\b(tcm|tcu|transmission\s*control)\b/i,
  TIPM: /\b(tipm|fuse\s*box|junction|fuse\s*relay|ipdm)\b/i,
  AMPLIFIER: /\b(amp|amplifier|bose|harman)\b/i,
  RADIO: /\b(radio|head\s*unit|infotainment|receiver)\b/i,
  CLUSTER: /\b(cluster|speedometer|gauge|instrument)\b/i,
  THROTTLE: /\b(throttle\s*body)\b/i,
};

function parseVehicle(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4})\s+(\S+)\s+(\S+)(?:\s+(.+))?$/);
  if (!m) return null;
  return { year: parseInt(m[1]), make: m[2], model: m[3], engine: m[4] || null };
}

function getBadge(p) { return p >= 250 ? 'GREAT' : p >= 150 ? 'GOOD' : p >= 100 ? 'FAIR' : 'LOW'; }
function getVerdict(avg, sold) {
  if ((avg >= 200 && sold >= 3) || (avg >= 150 && sold >= 2)) return { icon: '✅', label: 'PULL' };
  if (avg >= 100 && sold >= 3) return { icon: '⚠️', label: 'MAYBE' };
  if (avg >= 200 && sold === 1) return { icon: '💎', label: 'RARE' };
  return { icon: '❌', label: 'SKIP' };
}

async function getVehicleParts(year, make, model) {
  try {
    const rows = await database('Auto')
      .join('AutoItemCompatibility', 'Auto.id', 'AutoItemCompatibility.autoId')
      .join('Item', 'AutoItemCompatibility.itemId', 'Item.id')
      .where('Auto.year', year)
      .whereRaw('UPPER("Auto"."make") = UPPER(?)', [make])
      .whereRaw('UPPER(REPLACE(REPLACE("Auto"."model", \'-\', \'\'), \' \', \'\')) = UPPER(REPLACE(REPLACE(?, \'-\', \'\'), \' \', \'\'))', [model])
      .where('Item.price', '>', 0)
      .select('Item.title', 'Item.manufacturerPartNumber', 'Item.id', 'Auto.engine')
      .limit(200);
    return rows;
  } catch (e) {
    log.warn({ err: e.message }, '[InstantResearch] Auto lookup failed');
    return [];
  }
}

function groupByType(parts) {
  const groups = {};
  for (const p of parts) {
    const title = p.title || '';
    for (const [type, re] of Object.entries(TYPE_RE)) {
      if (re.test(title)) {
        if (!groups[type] || p.manufacturerPartNumber) {
          groups[type] = { pn: p.manufacturerPartNumber || groups[type]?.pn || null, title, engine: p.engine };
        }
        break;
      }
    }
  }
  // Add standard types not in DB
  for (const t of STANDARD_TYPES) {
    if (!groups[t]) groups[t] = { pn: null, title: null, engine: null };
  }
  return groups;
}

async function searchComps(pn, vehicle, partType) {
  // TIER 1: Part number search
  if (pn) {
    try {
      const items = await priceCheckService.scrapeSoldItems(pn);
      if (items && items.length >= 3) return items;
    } catch (e) { /* fall through */ }
  }
  // TIER 2: Keyword search with engine for powertrain parts
  const { year, make, model, engine } = vehicle;
  const eng = (ENGINE_SPECIFIC.has(partType) && engine) ? ' ' + engine : '';
  const query = `${year} ${make} ${model}${eng} ${partType} OEM`;
  try {
    return await priceCheckService.scrapeSoldItems(query);
  } catch (e) {
    log.warn({ err: e.message, query }, '[InstantResearch] Scrape failed');
    return [];
  }
}

/**
 * GET /api/instant-research?vehicle=2011+Toyota+Sequoia+5.7L
 */
router.get('/', async (req, res) => {
  const vehicle = req.query.vehicle;
  if (!vehicle) return res.status(400).json({ error: 'Use ?vehicle=2011+Toyota+Sequoia' });

  const parsed = parseVehicle(vehicle);
  if (!parsed) return res.status(400).json({ error: 'Format: YEAR MAKE MODEL [ENGINE]' });

  const cacheKey = `${parsed.year}-${parsed.make}-${parsed.model}-${parsed.engine || 'all'}`.toLowerCase();

  // Check cache (24h)
  try {
    const cached = await database('instant_research_cache')
      .where('vehicle_key', cacheKey)
      .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
      .first();
    if (cached && cached.results) {
      const r = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
      return res.json({ vehicle, parts: r, cached: true });
    }
  } catch (e) { /* cache miss */ }

  log.info({ vehicle, parsed }, '[InstantResearch] Starting');

  // Step 1: Get known parts from Auto+AIC
  const knownParts = await getVehicleParts(parsed.year, parsed.make, parsed.model);
  const partGroups = groupByType(knownParts);

  log.info({ vehicle, knownParts: knownParts.length, groups: Object.keys(partGroups).length }, '[InstantResearch] Parts found');

  // Step 2: Search eBay sold comps for each part type via Playwright scraper
  const results = [];
  for (const [type, info] of Object.entries(partGroups)) {
    try {
      const comps = await searchComps(info.pn, parsed, type);
      if (!comps || comps.length === 0) continue;

      const prices = comps.map(c => c.price || c.soldPrice).filter(p => p > 0);
      if (prices.length === 0) continue;

      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      if (avg < 50) continue;

      const sold = prices.length;
      const cogs = COGS[type] || COGS.DEFAULT;
      const verdict = getVerdict(avg, sold);

      results.push({
        partType: type, avgPrice: avg, soldCount: sold,
        priceRange: [Math.min(...prices), Math.max(...prices)],
        partNumbers: info.pn ? [info.pn] : [],
        velocity: sold >= 30 ? 'fast' : sold >= 9 ? 'medium' : 'slow',
        badge: getBadge(avg), cogs, estProfit: avg - cogs,
        revenue: avg * sold, verdict: verdict.label, verdictIcon: verdict.icon,
      });

      // Write-back to market_demand_cache (fire-and-forget — never block the response)
      try {
        const { extractPartNumbers } = require('../utils/partIntelligence');
        const pns = extractPartNumbers(info.title || '');
        const cacheKey = (pns.length > 0 && pns[0].base) ? pns[0].base
          : [parsed.year, parsed.make, parsed.model, type].filter(Boolean).map(s => String(s).toUpperCase()).join('|');
        const velocity = sold >= 15 ? 'high' : sold >= 8 ? 'medium' : 'low';
        const topComps = comps.slice(0, 5).map(c => ({ title: (c.title || '').substring(0, 80), price: c.price || c.soldPrice }));

        await database.raw(`
          INSERT INTO market_demand_cache
            (id, part_number_base, ebay_avg_price, ebay_sold_90d,
             source, search_query, ebay_median_price, ebay_min_price, ebay_max_price,
             market_velocity, sales_per_week, top_comps, last_updated, "createdAt")
          VALUES (gen_random_uuid(), ?, ?, ?, 'hawkeye', ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
          ON CONFLICT (part_number_base) DO UPDATE SET
            ebay_avg_price = EXCLUDED.ebay_avg_price, ebay_sold_90d = EXCLUDED.ebay_sold_90d,
            source = CASE WHEN market_demand_cache.source = 'apify' THEN market_demand_cache.source ELSE 'hawkeye' END,
            search_query = COALESCE(EXCLUDED.search_query, market_demand_cache.search_query),
            ebay_median_price = EXCLUDED.ebay_median_price,
            ebay_min_price = EXCLUDED.ebay_min_price, ebay_max_price = EXCLUDED.ebay_max_price,
            market_velocity = EXCLUDED.market_velocity, sales_per_week = EXCLUDED.sales_per_week,
            top_comps = EXCLUDED.top_comps, last_updated = NOW()
        `, [
          cacheKey, avg, sold,
          info.pn || `${parsed.year} ${parsed.make} ${parsed.model} ${type}`,
          avg, Math.min(...prices), Math.max(...prices),
          velocity, Math.round((sold / 90) * 7 * 100) / 100, JSON.stringify(topComps),
        ]);
      } catch (e) { /* write-back is optional — never block */ }

      // Also write fitment to part_fitment_cache if we have a PN
      if (info.pn) {
        try {
          const pnBase = require('../lib/partNumberUtils').normalizePartNumber(info.pn);
          await database.raw(`
            INSERT INTO part_fitment_cache
              (part_number_exact, part_number_base, part_type, year, make, model, engine, source, confirmed_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'hawkeye', NOW(), NOW())
            ON CONFLICT (part_number_base) DO NOTHING
          `, [info.pn, pnBase, type, parsed.year, parsed.make, parsed.model, parsed.engine || info.engine]);
        } catch (e) { /* optional */ }
      }

      // Rate limit between scrapes
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      log.warn({ err: e.message, type }, '[InstantResearch] Part search failed');
    }
  }

  // Filter and sort
  const filtered = results
    .filter(p => (p.soldCount >= 2 && p.avgPrice >= 100) || p.avgPrice >= 200)
    .sort((a, b) => b.revenue - a.revenue);

  log.info({ vehicle, total: results.length, filtered: filtered.length }, '[InstantResearch] Complete');

  // Cache
  try {
    await database.raw(`
      INSERT INTO instant_research_cache (vehicle_key, vehicle_display, results, last_updated)
      VALUES (?, ?, ?::jsonb, NOW())
      ON CONFLICT (vehicle_key) DO UPDATE SET results = EXCLUDED.results, last_updated = NOW()
    `, [cacheKey, vehicle, JSON.stringify(filtered)]);
  } catch (e) { /* cache write optional */ }

  const totalValue = filtered.reduce((s, p) => s + p.avgPrice, 0);
  const totalProfit = filtered.reduce((s, p) => s + p.estProfit, 0);

  res.json({
    vehicle, parts: filtered, cached: false,
    totalValue, totalProfit,
    pullCount: filtered.filter(p => p.verdict === 'PULL' || p.verdict === 'RARE').length,
  });
});

// Dropdown data for vehicle selection
router.get('/years', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT year FROM "Auto" WHERE year >= 1995 ORDER BY year DESC');
    res.json((r.rows || r).map(r => r.year));
  } catch (e) { res.json([]); }
});

router.get('/makes', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT make FROM "Auto" WHERE year = ? ORDER BY make', [req.query.year]);
    res.json((r.rows || r).map(r => r.make));
  } catch (e) { res.json([]); }
});

router.get('/models', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT model FROM "Auto" WHERE year = ? AND LOWER(make) = LOWER(?) ORDER BY model', [req.query.year, req.query.make]);
    res.json((r.rows || r).map(r => r.model));
  } catch (e) { res.json([]); }
});

router.get('/engines', async (req, res) => {
  try {
    const r = await database.raw('SELECT DISTINCT engine FROM "Auto" WHERE year = ? AND LOWER(make) = LOWER(?) AND LOWER(model) = LOWER(?) AND engine IS NOT NULL ORDER BY engine', [req.query.year, req.query.make, req.query.model]);
    res.json((r.rows || r).map(r => r.engine));
  } catch (e) { res.json([]); }
});

module.exports = router;
