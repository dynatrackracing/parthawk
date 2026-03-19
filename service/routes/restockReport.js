'use strict';

/**
 * restockReport.js — Weekly Restock Report
 *
 * 5 tiers: GREEN (80-100), YELLOW (60-79), ORANGE (40-59), RED (20-39), GREY (0-19)
 * Profit calculated using real COGS by part type.
 * High-value override: $300+ avg sell price → floor score 75.
 */

const router = require('express-promise-router')();
const { database } = require('../database/database');
const { normalizePartNumber } = require('../lib/partNumberUtils');

// Yard cost by part type. True COGS = yard × 1.18 (tax/gate/mileage)
const YARD_COST = {
  ECM: 40, ABS: 75, BCM: 28, TIPM: 35, 'Fuse Box': 35,
  Amplifier: 20, Radio: 28, Cluster: 32, TCM: 50,
  Throttle: 36, Steering: 35, Mirror: 25, 'Seat Belt': 13,
  'Window Motor': 22, OTHER: 35,
};
const TAX_GATE_MILEAGE = 1.18;
const EBAY_FEE_RATE = 0.13;
const SHIPPING = 12;

function detectPartType(title) {
  const t = (title || '').toLowerCase();
  if (/\b(ecu|ecm|pcm|engine control|engine computer)\b/.test(t)) return 'ECM';
  if (/\b(abs|anti.?lock|brake pump)\b/.test(t)) return 'ABS';
  if (/\b(bcm|body control)\b/.test(t)) return 'BCM';
  if (/\b(tipm|integrated power)\b/.test(t)) return 'TIPM';
  if (/\b(fuse box|junction|relay box|ipdm)\b/.test(t)) return 'Fuse Box';
  if (/\b(amplifier|bose|harman|alpine|jbl)\b/.test(t)) return 'Amplifier';
  if (/\b(radio|stereo|head unit|infotainment)\b/.test(t)) return 'Radio';
  if (/\b(cluster|speedometer|instrument|gauge)\b/.test(t)) return 'Cluster';
  if (/\b(tcm|tcu|transmission control)\b/.test(t)) return 'TCM';
  if (/\b(throttle body)\b/.test(t)) return 'Throttle';
  if (/\b(steering|power steering|eps)\b/.test(t)) return 'Steering';
  if (/\b(mirror|side view)\b/.test(t)) return 'Mirror';
  if (/\b(seat belt|seatbelt)\b/.test(t)) return 'Seat Belt';
  if (/\b(window motor|regulator)\b/.test(t)) return 'Window Motor';
  return 'OTHER';
}

function extractVehicle(title) {
  if (!title) return null;
  const m = title.match(/\b((?:19|20)\d{2})(?:\s*-\s*(?:19|20)\d{2})?\s+(Acura|Audi|BMW|Buick|Cadillac|Chevrolet|Chevy|Chrysler|Dodge|Ford|GMC|Honda|Hyundai|Infiniti|Jeep|Kia|Lexus|Lincoln|Mazda|Mercedes|Mercury|Mini|Mitsubishi|Nissan|Pontiac|Ram|Saturn|Scion|Subaru|Toyota|Volkswagen|VW|Volvo)\s+([A-Za-z0-9][A-Za-z0-9 \-]{1,20})/i);
  if (!m) return null;
  let model = m[3].replace(/\s+(ECU|ECM|PCM|BCM|ABS|TIPM|OEM|Engine|Body|Control|Module).*$/i, '').trim();
  return `${m[1]} ${m[2]} ${model}`;
}

function extractSpecificity(title) {
  const parts = [];
  const t = (title || '').toUpperCase();
  const eng = title.match(/\b(\d\.\d)L\b/i);
  if (eng) parts.push(eng[0]);
  if (t.includes('4WD') || t.includes('4X4')) parts.push('4WD');
  else if (t.includes('AWD')) parts.push('AWD');
  else if (t.includes('2WD')) parts.push('2WD');
  if (/PROGRAMMED|PLUG.{0,3}PLAY/i.test(title)) parts.push('Programmed');
  return parts.length > 0 ? parts.join(', ') : null;
}

function calcProfit(avgSellPrice, partType) {
  const yardCost = YARD_COST[partType] || YARD_COST.OTHER;
  const trueCogs = yardCost * TAX_GATE_MILEAGE;
  const ebayFees = avgSellPrice * EBAY_FEE_RATE;
  return Math.round((avgSellPrice - trueCogs - ebayFees - SHIPPING) * 100) / 100;
}

// Make aliases for extracting make from titles
const MAKES = ['Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chevy','Chrysler','Dodge','Fiat','Ford','Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda','Mercedes-Benz','Mercedes','Mercury','Mini','Mitsubishi','Nissan','Oldsmobile','Pontiac','Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota','Volkswagen','VW','Volvo'];

function extractMakeModel(title) {
  if (!title) return null;
  const tu = title.toUpperCase();
  let make = null;
  for (const m of MAKES) {
    if (tu.includes(m.toUpperCase())) { make = m; break; }
  }
  if (!make) return null;
  if (make === 'Chevy') make = 'Chevrolet';
  if (make === 'VW') make = 'Volkswagen';
  if (make === 'Mercedes') make = 'Mercedes-Benz';

  const makeIdx = tu.indexOf(make.toUpperCase());
  const after = title.substring(makeIdx + make.length).trim().split(/\s+/);
  const modelWords = [];
  for (const w of after) {
    if (/^\d{4}$/.test(w) || /^\d{4}-\d{4}$/.test(w)) break;
    if (/^\d+\.\d+[lL]$/.test(w)) break;
    if (/^(ECU|ECM|PCM|BCM|TCM|ABS|TIPM|OEM|Engine|Body|Control|Module|Anti|Fuse|Power|Brake|Amplifier|Radio|Cluster|Steering|Throttle)$/i.test(w)) break;
    modelWords.push(w);
    if (modelWords.length >= 3) break;
  }
  if (modelWords.length === 0) return null;
  const model = modelWords.join(' ').replace(/[^A-Za-z0-9 \-]/g, '').trim();
  if (!model || model.length < 2) return null;
  return { make, model };
}

function extractPartNumbers(title) {
  if (!title) return [];
  const pns = [];
  // Chrysler: 56044691AA
  const chrysler = title.match(/\b(\d{8}[A-Z]{2})\b/g);
  if (chrysler) pns.push(...chrysler);
  // Toyota/Honda: 89661-48250
  const toyota = title.match(/\b(\d{5}-[A-Z0-9]{3,7})\b/g);
  if (toyota) pns.push(...toyota);
  // Ford: BC3T-14B476-CG
  const ford = title.match(/\b([A-Z]{1,4}\d{1,2}[A-Z]-[A-Z0-9]{4,6}-[A-Z]{2})\b/g);
  if (ford) pns.push(...ford);
  return pns;
}

async function generateRestockReport() {
  const cutoff180 = new Date(Date.now() - 180 * 86400000);

  const sales = await database('YourSale')
    .where('soldDate', '>=', cutoff180)
    .whereNotNull('title')
    .select('sku', 'title', 'salePrice', 'soldDate');

  // Group by make + model + partType — strict matching
  const groups = {};
  for (const sale of sales) {
    const title = sale.title || '';
    const veh = extractMakeModel(title);
    if (!veh) continue; // Skip if can't extract make+model

    const partType = detectPartType(title);
    const key = `${veh.make}|${veh.model}|${partType}`;

    if (!groups[key]) {
      groups[key] = {
        make: veh.make, model: veh.model, partType,
        specificity: extractSpecificity(title),
        sold: 0, revenue: 0, partNumbers: new Set(), titles: [],
      };
    }
    groups[key].sold++;
    groups[key].revenue += parseFloat(sale.salePrice) || 0;
    if (groups[key].titles.length < 3) groups[key].titles.push(title);

    // Extract and collect part numbers
    for (const pn of extractPartNumbers(title)) {
      groups[key].partNumbers.add(normalizePartNumber(pn));
    }
  }

  // Get stock — index by part number base for exact matching
  const listings = await database('YourListing')
    .where('listingStatus', 'Active')
    .whereNotNull('title')
    .select('title', 'sku', 'quantityAvailable');

  // Build stock index by make|model|partType AND by part number
  const stockByKey = {};
  const stockByPN = {};
  for (const l of listings) {
    const veh = extractMakeModel(l.title);
    if (veh) {
      const pt = detectPartType(l.title);
      const key = `${veh.make}|${veh.model}|${pt}`;
      stockByKey[key] = (stockByKey[key] || 0) + (parseInt(l.quantityAvailable) || 1);
    }
    // Also index by SKU/part number for precise matching
    if (l.sku) {
      const base = normalizePartNumber(l.sku);
      stockByPN[base] = (stockByPN[base] || 0) + (parseInt(l.quantityAvailable) || 1);
    }
    for (const pn of extractPartNumbers(l.title)) {
      const base = normalizePartNumber(pn);
      stockByPN[base] = (stockByPN[base] || 0) + (parseInt(l.quantityAvailable) || 1);
    }
  }

  // Score and tier each group
  const items = [];
  for (const [key, data] of Object.entries(groups)) {
    // Stock: prefer part-number-based count, fall back to make|model|partType
    let stock = 0;
    if (data.partNumbers.size > 0) {
      const counted = new Set();
      for (const pn of data.partNumbers) {
        if (!counted.has(pn) && stockByPN[pn]) {
          stock += stockByPN[pn];
          counted.add(pn);
        }
      }
    }
    if (stock === 0) stock = stockByKey[key] || 0;

    const avgPrice = data.sold > 0 ? Math.round(data.revenue / data.sold * 100) / 100 : 0;
    const profit = calcProfit(avgPrice, data.partType);

    let score = 0;
    score += Math.min(40, data.sold * 4);
    score += Math.min(30, profit > 0 ? Math.round(profit / 5) : 0);
    score += stock === 0 ? 20 : stock === 1 ? 10 : 0;
    score = Math.min(100, score);
    if (avgPrice >= 300 && data.sold >= 1) score = Math.max(score, 75);

    let tier, action;
    if (score >= 80) { tier = 'green'; action = 'RESTOCK NOW'; }
    else if (score >= 60) { tier = 'yellow'; action = 'STRONG BUY'; }
    else if (score >= 40) { tier = 'orange'; action = 'CONSIDER'; }
    else if (score >= 20) { tier = 'red'; action = 'LOW PRIORITY'; }
    else { tier = 'grey'; action = 'ON RADAR'; }

    items.push({
      partType: data.partType,
      vehicle: `${data.make} ${data.model}`,
      make: data.make, model: data.model,
      specificity: data.specificity,
      partNumbers: [...data.partNumbers].slice(0, 5),
      score, tier, action,
      sold180d: data.sold, activeStock: stock, avgPrice, profit,
      revenue180d: Math.round(data.revenue),
      ratio: stock > 0 ? Math.round(data.sold / stock * 10) / 10 : data.sold,
      sampleTitle: data.titles[0] || null,
    });
  }

  items.sort((a, b) => b.score - a.score);

  const tiers = { green: [], yellow: [], orange: [], red: [], grey: [] };
  for (const item of items) tiers[item.tier].push(item);

  return {
    generatedAt: new Date().toISOString(),
    tiers,
    summary: {
      green: tiers.green.length, yellow: tiers.yellow.length,
      orange: tiers.orange.length, red: tiers.red.length, grey: tiers.grey.length,
      total: items.length,
    },
  };
}

router.get('/report', async (req, res) => {
  try {
    const report = await generateRestockReport();
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.generateRestockReport = generateRestockReport;
