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

  res.json({ vehicle, parts: filtered, cached: false });
});

module.exports = router;
