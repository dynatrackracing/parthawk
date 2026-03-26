#!/usr/bin/env node
/**
 * DARKHAWK — Auto-Generate Restock List
 *
 * Compares sales velocity against current stock to find parts that need restocking.
 * Auto-populates restock_want_list with auto_generated = true entries.
 * Manual entries (auto_generated = false/null) are never overwritten.
 *
 * Scoring (max 110):
 *   Your Demand:   max 35pts (sold count * recency weighting)
 *   Market Demand:  max 35pts (eBay comps from market_demand_cache)
 *   Ratio:          max 15pts (sales:stock imbalance)
 *   Price:          max 25pts (avg sale price tiers)
 *   Floor: avgPrice >= $300 + any market signal → minimum score 75
 *
 * Restock condition: 90d sales >= 2x active stock. 30-day sales weighted 2x.
 *
 * Usage: node service/scripts/generate-restock-list.js [--dry-run] [--limit N]
 */

'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const { extractPartNumbers, stripRevisionSuffix } = require('../utils/partIntelligence');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const MAX_INSERT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 500 : 500;

// ── Part type detection (same as AttackListService) ──────────
function detectPartType(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL') || t.includes('ENGINE COMPUTER')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK') || t.includes('BRAKE MODULE')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('RELAY BOX') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('BOSE') || t.includes('HARMAN') || t.includes('ALPINE') || t.includes('JBL')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT') || t.includes('GAUGE')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('INFOTAINMENT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  if (t.includes('YAW RATE') || t.includes('YAW SENSOR')) return 'YAW';
  if (t.includes('TRANSFER CASE')) return 'XFER';
  if (t.includes('WINDOW') && t.includes('REGULATOR')) return 'REGULATOR';
  if (t.includes('MIRROR')) return 'MIRROR';
  if (t.includes('BLOWER')) return 'BLOWER';
  if (t.includes('FAN') && t.includes('SOLENOID')) return 'FAN';
  return null;
}

// ── Group key: base PN if available, else make|model|partType ──
function buildGroupKey(title) {
  const pns = extractPartNumbers(title);
  if (pns.length > 0) {
    // Use base PN (revision-stripped) as key — groups AA/AB/AC variants together
    return { key: pns[0].base, method: 'PN', pn: pns[0].raw };
  }

  // Fallback: make|model|partType
  const titleUpper = (title || '').toUpperCase();
  const MAKE_MAP = {
    'chevrolet': 'CHEVROLET', 'chevy': 'CHEVROLET', 'dodge': 'DODGE', 'ram': 'RAM',
    'chrysler': 'CHRYSLER', 'jeep': 'JEEP', 'ford': 'FORD', 'gmc': 'GMC',
    'toyota': 'TOYOTA', 'honda': 'HONDA', 'nissan': 'NISSAN', 'bmw': 'BMW',
    'mercedes': 'MERCEDES', 'mazda': 'MAZDA', 'kia': 'KIA', 'hyundai': 'HYUNDAI',
    'subaru': 'SUBARU', 'mitsubishi': 'MITSUBISHI', 'infiniti': 'INFINITI',
    'lexus': 'LEXUS', 'acura': 'ACURA', 'cadillac': 'CADILLAC', 'buick': 'BUICK',
    'lincoln': 'LINCOLN', 'volvo': 'VOLVO', 'audi': 'AUDI', 'volkswagen': 'VOLKSWAGEN',
    'vw': 'VOLKSWAGEN', 'mini': 'MINI', 'pontiac': 'PONTIAC', 'saturn': 'SATURN',
    'mercury': 'MERCURY', 'scion': 'SCION', 'land rover': 'LAND ROVER',
    'porsche': 'PORSCHE', 'jaguar': 'JAGUAR',
  };

  let make = null;
  const titleLower = (title || '').toLowerCase();
  for (const [alias, canonical] of Object.entries(MAKE_MAP)) {
    if (titleLower.includes(alias)) { make = canonical; break; }
  }

  const partType = detectPartType(title);

  // Extract model — first multi-word, then single-word after make
  let model = null;
  if (make) {
    const MODELS = [
      'GRAND CHEROKEE','GRAND CARAVAN','TRANSIT CONNECT','TOWN COUNTRY','CROWN VICTORIA',
      'PT CRUISER','LAND CRUISER','SANTA FE','RAM 1500','RAM 2500','RAM 3500','RANGE ROVER',
      'SILVERADO','TAHOE','SUBURBAN','EQUINOX','TRAVERSE','MALIBU','IMPALA','CAMARO',
      'COLORADO','YUKON','SIERRA','TERRAIN','ENVOY','ACADIA',
      'CHALLENGER','CHARGER','DURANGO','JOURNEY','DAKOTA','CARAVAN','DART','MAGNUM',
      'WRANGLER','CHEROKEE','COMPASS','PATRIOT','LIBERTY','RENEGADE',
      'F150','F250','F350','F450','RANGER','EXPLORER','ESCAPE','EDGE','EXPEDITION',
      'FUSION','FOCUS','MUSTANG','BRONCO','ECONOLINE','FLEX','TRANSIT','EXCURSION','TAURUS',
      'CAMRY','COROLLA','TACOMA','TUNDRA','SEQUOIA','HIGHLANDER','RAV4','4RUNNER','PRIUS','SIENNA',
      'ACCORD','CIVIC','CR-V','CRV','PILOT','ODYSSEY','RIDGELINE','FIT','ELEMENT',
      'TSX','TL','MDX','RDX','ILX',
      'PATHFINDER','TITAN','ALTIMA','SENTRA','ROGUE','MURANO','FRONTIER','XTERRA','MAXIMA','ARMADA',
      'OPTIMA','FORTE','SOUL','SPORTAGE','SORENTO','SEDONA',
      'TUCSON','ELANTRA','SONATA',
      'JETTA','PASSAT','GOLF','TIGUAN','BEETLE',
      'XC90','XC70','S60','V70',
      'FORESTER','OUTBACK','IMPREZA','LEGACY','CROSSTREK',
      'NAVIGATOR','TOWN CAR',
      'LACROSSE','LUCERNE','ENCLAVE',
      'PACIFICA','300','200','PROMASTER',
      'GS300','IS300','RX350','ES350','LS430','LS460','GX470',
      'M35','FX35','Q60','G35','G37',
      'MAZDA3','MAZDA6','CX-5','MIATA','TRIBUTE',
      'ESCALADE','SRX','CTS','ATS',
    ];
    for (const m of MODELS) {
      if (titleUpper.includes(m)) { model = m; break; }
    }
  }

  if (!make && !partType) return null;
  const key = [make, model, partType].filter(Boolean).join('|');
  if (!key) return null;
  return { key, method: 'KEYWORD', pn: null };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Auto-Generate Restock List');
  console.log(new Date().toISOString());
  if (dryRun) console.log('** DRY RUN — no database writes **');
  console.log('═══════════════════════════════════════════\n');

  // Step 0: Ensure auto_generated column exists
  try {
    await database.raw(`
      ALTER TABLE restock_want_list ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT false
    `);
    console.log('0. auto_generated column: OK\n');
  } catch (e) {
    console.log('0. auto_generated column: ' + e.message + '\n');
  }

  // Step 1: Query all sales from last 180 days
  console.log('1. Loading sales data (180 days)...');
  const sales = await database.raw(`
    SELECT title, "salePrice", "soldDate", store
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '180 days'
      AND title IS NOT NULL
      AND "salePrice" > 25
    ORDER BY "soldDate" DESC
  `);
  const salesRows = sales.rows || sales;
  console.log('   ' + salesRows.length + ' sales loaded\n');

  // Step 2: Group sales by normalized key
  console.log('2. Grouping sales by part...');
  const salesGroups = new Map(); // key → { titles, count, totalPrice, count30d, count90d, lastSold, sampleTitle }
  const now = Date.now();

  for (const row of salesRows) {
    const gk = buildGroupKey(row.title);
    if (!gk) continue;

    const price = parseFloat(row.salePrice) || 0;
    const soldDate = new Date(row.soldDate);
    const daysAgo = Math.floor((now - soldDate.getTime()) / 86400000);

    if (!salesGroups.has(gk.key)) {
      salesGroups.set(gk.key, {
        key: gk.key,
        method: gk.method,
        pn: gk.pn,
        titles: new Set(),
        count: 0,
        totalPrice: 0,
        count30d: 0,
        count90d: 0,
        lastSold: soldDate,
        sampleTitle: row.title,
      });
    }

    const g = salesGroups.get(gk.key);
    g.count++;
    g.totalPrice += price;
    if (daysAgo <= 30) g.count30d++;
    if (daysAgo <= 90) g.count90d++;
    if (soldDate > g.lastSold) g.lastSold = soldDate;
    g.titles.add(row.title);
    // Keep the most descriptive sample title (longest)
    if (row.title.length > g.sampleTitle.length) g.sampleTitle = row.title;
  }

  console.log('   ' + salesGroups.size + ' unique part groups\n');

  // Step 3: Query active listings and group the same way
  console.log('3. Loading active listings...');
  const listings = await database('YourListing')
    .where('listingStatus', 'Active')
    .whereNotNull('title')
    .select('title', 'quantityAvailable', 'store');

  const stockGroups = new Map(); // key → total qty
  for (const listing of listings) {
    const gk = buildGroupKey(listing.title);
    if (!gk) continue;
    const qty = parseInt(listing.quantityAvailable) || 1;
    stockGroups.set(gk.key, (stockGroups.get(gk.key) || 0) + qty);
  }
  console.log('   ' + listings.length + ' active listings → ' + stockGroups.size + ' stock groups\n');

  // Step 4: Load market demand cache for enrichment
  console.log('4. Loading market demand cache...');
  const marketCache = new Map();
  try {
    const cacheRows = await database('market_demand_cache')
      .where('ebay_avg_price', '>', 0)
      .select('part_number_base', 'ebay_avg_price', 'ebay_sold_90d');
    for (const row of cacheRows) {
      marketCache.set(row.part_number_base, {
        median: parseFloat(row.ebay_avg_price),
        count: parseInt(row.ebay_sold_90d) || 0,
      });
    }
    console.log('   ' + marketCache.size + ' cached market entries\n');
  } catch (e) {
    console.log('   Market cache unavailable: ' + e.message + '\n');
  }

  // Step 5: Score each sales group → restock candidates
  console.log('5. Scoring restock candidates...');
  const candidates = [];

  for (const [key, group] of salesGroups) {
    // Must have sold at least 2x in 180 days
    if (group.count < 2) continue;

    const avgPrice = Math.round(group.totalPrice / group.count);
    const stock = stockGroups.get(key) || 0;

    // Weighted sales: 30d sales count 2x, remainder at 1x
    const weightedSales90d = group.count30d * 2 + (group.count90d - group.count30d);

    // Restock condition: weighted 90d sales >= 2x active stock
    // Always restock if stock is 0 and we've sold it
    if (stock > 0 && weightedSales90d < stock * 2) continue;

    // ── SCORING ──

    // Your Demand: max 35pts
    let demandScore = 0;
    if (group.count90d >= 10) demandScore = 35;
    else if (group.count90d >= 6) demandScore = 28;
    else if (group.count90d >= 4) demandScore = 22;
    else if (group.count90d >= 3) demandScore = 18;
    else if (group.count90d >= 2) demandScore = 12;
    // 30d recency bonus
    if (group.count30d >= 3) demandScore = Math.min(35, demandScore + 7);
    else if (group.count30d >= 1) demandScore = Math.min(35, demandScore + 3);

    // Market Demand: max 35pts (from eBay cache)
    let marketScore = 0;
    const mkt = marketCache.get(key);
    if (mkt) {
      if (mkt.count >= 20) marketScore = 35;
      else if (mkt.count >= 10) marketScore = 25;
      else if (mkt.count >= 5) marketScore = 18;
      else if (mkt.count >= 1) marketScore = 10;
    }

    // Ratio: max 15pts (sales:stock imbalance)
    let ratioScore = 0;
    if (stock === 0) ratioScore = 15;
    else {
      const ratio = weightedSales90d / stock;
      if (ratio >= 6) ratioScore = 15;
      else if (ratio >= 4) ratioScore = 12;
      else if (ratio >= 3) ratioScore = 9;
      else if (ratio >= 2) ratioScore = 6;
    }

    // Price: max 25pts
    let priceScore = 0;
    if (avgPrice >= 300) priceScore = 25;
    else if (avgPrice >= 200) priceScore = 20;
    else if (avgPrice >= 150) priceScore = 16;
    else if (avgPrice >= 100) priceScore = 12;
    else if (avgPrice >= 75) priceScore = 8;
    else if (avgPrice >= 50) priceScore = 4;

    let score = demandScore + marketScore + ratioScore + priceScore;

    // Floor: high-value parts with any market signal → minimum 75
    if (avgPrice >= 300 && (mkt || group.count90d >= 3)) {
      score = Math.max(75, score);
    }

    candidates.push({
      key,
      method: group.method,
      pn: group.pn,
      sampleTitle: group.sampleTitle,
      count180d: group.count,
      count90d: group.count90d,
      count30d: group.count30d,
      avgPrice,
      stock,
      weightedSales90d,
      score,
      demandScore,
      marketScore,
      ratioScore,
      priceScore,
      hasMarket: !!mkt,
      lastSold: group.lastSold,
    });
  }

  // Sort by score desc, then by avgPrice desc
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.avgPrice - a.avgPrice;
  });

  console.log('   Found ' + candidates.length + ' restock candidates\n');

  // Step 6: Show top 20
  console.log('═══════════════════════════════════════════');
  console.log('TOP 20 RESTOCK CANDIDATES');
  console.log('═══════════════════════════════════════════');
  const top = candidates.slice(0, 20);
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const stockLabel = c.stock === 0 ? 'OUT' : String(c.stock);
    console.log(
      `  ${String(i + 1).padStart(2)}. [${c.score}pts] $${c.avgPrice} avg | ` +
      `sold ${c.count90d}x/90d (${c.count30d}x/30d) | stock: ${stockLabel} | ` +
      `${c.method === 'PN' ? 'PN:' + c.pn : c.key}`
    );
    console.log(`      ${c.sampleTitle.substring(0, 90)}`);
  }

  // Step 7: Insert into restock_want_list
  const toInsert = candidates.slice(0, MAX_INSERT);
  console.log('\n═══════════════════════════════════════════');

  if (dryRun) {
    console.log('DRY RUN — would insert ' + toInsert.length + ' candidates');
    console.log('═══════════════════════════════════════════');
    await database.destroy();
    return;
  }

  console.log('6. Inserting ' + toInsert.length + ' candidates into restock_want_list...');

  // Get existing manual entries (auto_generated = false or null) — never touch these
  const manualEntries = await database('restock_want_list')
    .where(function() {
      this.where('auto_generated', false).orWhereNull('auto_generated');
    })
    .where('active', true)
    .select('title');
  const manualTitles = new Set(manualEntries.map(e => e.title?.toLowerCase().trim()));
  console.log('   ' + manualTitles.size + ' manual entries preserved');

  // Clear old auto-generated entries
  const deleted = await database('restock_want_list')
    .where('auto_generated', true)
    .del();
  console.log('   Cleared ' + deleted + ' old auto-generated entries');

  // Insert new candidates
  let inserted = 0, skipped = 0;
  for (const c of toInsert) {
    const title = c.sampleTitle.trim();

    // Skip if manual entry already covers this
    if (manualTitles.has(title.toLowerCase())) {
      skipped++;
      continue;
    }

    try {
      await database('restock_want_list').insert({
        title,
        notes: `Score ${c.score} | $${c.avgPrice} avg | ${c.count90d}x/90d | stock: ${c.stock} | ${c.method === 'PN' ? 'PN:' + c.key : c.key}`,
        active: true,
        auto_generated: true,
      });
      inserted++;
    } catch (e) {
      // Duplicate title or other constraint — skip
      skipped++;
    }
  }

  // Final counts
  const { rows: [counts] } = await database.raw(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN auto_generated = true THEN 1 END) as auto,
      COUNT(CASE WHEN auto_generated IS NOT true THEN 1 END) as manual
    FROM restock_want_list WHERE active = true
  `);

  console.log('\n═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Candidates found: ' + candidates.length);
  console.log('  Inserted:         ' + inserted);
  console.log('  Skipped (manual): ' + skipped);
  console.log('  Restock list now: ' + counts.total + ' total (' + counts.auto + ' auto, ' + counts.manual + ' manual)');
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
