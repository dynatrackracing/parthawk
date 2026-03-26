'use strict';

const router = require('express-promise-router')();
const { log } = require('../lib/logger');
const { database } = require('../database/database');
const axios = require('axios');

const SEARCH_PHASES = [
  { label: 'Powertrain', terms: 'ECM PCM ECU engine control module, ABS anti-lock brake pump module, TCM TCU transmission control module' },
  { label: 'Body/Electrical', terms: 'BCM body control module, TIPM fuse box junction relay box, amplifier Bose Harman, radio head unit infotainment, instrument cluster speedometer gauges' },
  { label: 'Sensors/Other', terms: 'throttle body, parking sensor module, camera module, blind spot module, HVAC module, airbag module, liftgate module, steering module, transfer case control module' },
];

const COGS = {
  ECM: 40, ABS: 75, BCM: 28, TCM: 50, TIPM: 35,
  AMP: 20, RADIO: 28, CLUSTER: 32, THROTTLE: 36,
  CAMERA: 25, SENSOR: 20, DEFAULT: 30,
};

function getVerdict(avgPrice, soldCount) {
  if ((avgPrice >= 200 && soldCount >= 3) || (avgPrice >= 150 && soldCount >= 2)) return { icon: '✅', label: 'PULL' };
  if (avgPrice >= 100 && soldCount >= 3) return { icon: '⚠️', label: 'MAYBE' };
  if (avgPrice >= 200 && soldCount === 1) return { icon: '💎', label: 'RARE' };
  return { icon: '❌', label: 'SKIP' };
}

function getBadge(avgPrice) {
  if (avgPrice >= 250) return 'GREAT';
  if (avgPrice >= 150) return 'GOOD';
  if (avgPrice >= 100) return 'FAIR';
  return 'LOW';
}

async function searchPhase(vehicle, terms) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const prompt = `Search eBay for recently SOLD used OEM parts from a ${vehicle}. Focus on: ${terms}

Search eBay sold listings for each part type. For each with real results, return JSON:
[{"partType":"ECM","avgPrice":175,"soldCount":8,"priceRange":[120,250],"partNumbers":["if visible"],"velocity":"medium"}]

Rules: Only real sold data. Skip under $50. velocity: fast=10+/mo, medium=3-9/mo, slow=1-2/mo.`;

  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }],
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    timeout: 60000,
  });

  const data = res.data;
  if (data.error) {
    log.error({ error: data.error }, '[InstantResearch] API error');
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  // Log the response structure for debugging
  const blockTypes = (data.content || []).map(b => b.type);
  log.info({ vehicle, stopReason: data.stop_reason, blockTypes, blockCount: blockTypes.length }, '[InstantResearch] API response');

  // Extract ALL text from the response (may include text blocks between tool results)
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  const fullText = textBlocks.map(b => b.text).join('\n');

  if (!fullText) {
    log.warn({ vehicle, blockTypes }, '[InstantResearch] No text blocks in response');
    return [];
  }

  // Parse JSON — try multiple extraction methods
  const cleaned = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();

  // Method 1: find a JSON array
  const arrayMatch = cleaned.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parts = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parts) && parts.length > 0) return parts;
    } catch (e) { /* try next method */ }
  }

  // Method 2: find individual JSON objects and collect them
  const objMatches = [...cleaned.matchAll(/\{[^{}]*"partType"[^{}]*\}/g)];
  if (objMatches.length > 0) {
    const parts = [];
    for (const m of objMatches) {
      try { parts.push(JSON.parse(m[0])); } catch (e) { /* skip bad ones */ }
    }
    if (parts.length > 0) return parts;
  }

  log.warn({ vehicle, textLength: fullText.length, textSample: fullText.substring(0, 300) }, '[InstantResearch] Could not parse JSON');
  return [];
}

function processResults(allParts) {
  // Deduplicate by partType
  const byType = {};
  for (const p of allParts) {
    if (!p.partType) continue;
    const key = p.partType.toUpperCase().replace(/\s+/g, '_');
    if (!byType[key] || (p.avgPrice || 0) > (byType[key].avgPrice || 0)) {
      byType[key] = p;
    }
  }

  // Filter, enrich, sort
  return Object.values(byType)
    .filter(p => {
      const avg = p.avgPrice || 0;
      const sold = p.soldCount || 0;
      return (avg >= 100 && sold >= 2) || (avg >= 200 && sold >= 1);
    })
    .map(p => {
      const avg = p.avgPrice || 0;
      const sold = p.soldCount || 0;
      const typeKey = p.partType.toUpperCase().replace(/[^A-Z]/g, '');
      const cogs = COGS[typeKey] || COGS.DEFAULT;
      const profit = avg - cogs;
      const verdict = getVerdict(avg, sold);
      return {
        ...p,
        badge: getBadge(avg),
        cogs,
        estProfit: Math.round(profit),
        revenue: Math.round(avg * sold),
        verdict: verdict.label,
        verdictIcon: verdict.icon,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * GET /api/instant-research?vehicle=2011+Toyota+Sequoia
 */
router.get('/', async (req, res) => {
  const vehicle = req.query.vehicle;
  if (!vehicle) return res.status(400).json({ error: 'Vehicle required. Use ?vehicle=2011+Toyota+Sequoia' });

  const cacheKey = vehicle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Check cache (24h TTL)
  try {
    const cached = await database('instant_research_cache')
      .where('vehicle_key', cacheKey)
      .whereRaw("last_updated > NOW() - INTERVAL '24 hours'")
      .first();
    if (cached && cached.results) {
      const results = typeof cached.results === 'string' ? JSON.parse(cached.results) : cached.results;
      return res.json({ vehicle, parts: results, cached: true, cachedAt: cached.last_updated });
    }
  } catch (e) { /* cache miss or table doesn't exist yet */ }

  // Run 3-phase search
  log.info({ vehicle }, '[InstantResearch] Starting research');
  const allParts = [];

  for (const phase of SEARCH_PHASES) {
    try {
      log.info({ vehicle, phase: phase.label }, '[InstantResearch] Phase starting');
      const parts = await searchPhase(vehicle, phase.terms);
      allParts.push(...parts);
      log.info({ vehicle, phase: phase.label, found: parts.length }, '[InstantResearch] Phase complete');
    } catch (e) {
      log.warn({ err: e.message, phase: phase.label }, '[InstantResearch] Phase failed');
    }
  }

  const results = processResults(allParts);
  log.info({ vehicle, totalParts: allParts.length, filtered: results.length }, '[InstantResearch] Complete');

  // Cache results
  try {
    await database.raw(`
      INSERT INTO instant_research_cache (vehicle_key, vehicle_display, results, last_updated)
      VALUES (?, ?, ?::jsonb, NOW())
      ON CONFLICT (vehicle_key) DO UPDATE SET results = EXCLUDED.results, last_updated = NOW()
    `, [cacheKey, vehicle, JSON.stringify(results)]);
  } catch (e) {
    log.warn({ err: e.message }, '[InstantResearch] Cache write failed');
  }

  res.json({ vehicle, parts: results, cached: false });
});

module.exports = router;
