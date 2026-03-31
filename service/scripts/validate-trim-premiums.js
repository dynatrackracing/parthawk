'use strict';

/**
 * TRIM PREMIUM VALIDATOR — Playwright batch scraper
 *
 * Validates whether premium trim parts carry a price premium on eBay.
 * Runs paired searches: premium (with brand keyword) vs base (without).
 *
 * Usage:
 *   node service/scripts/validate-trim-premiums.js            # full run
 *   node service/scripts/validate-trim-premiums.js --dry-run   # just print queue
 *
 * Requires DATABASE_URL env var and Playwright installed.
 */

const path = require('path');
try { require('dotenv').config({ path: path.resolve(__dirname, '../..', '.env') }); } catch (e) {}

const { database } = require('../database/database');

const DRY_RUN = process.argv.includes('--dry-run');

// All premium audio keywords to exclude in base searches
const ALL_PREMIUM_EXCLUDES = [
  'Bose', 'Harman', 'Kardon', 'JBL', 'Infinity', 'Alpine', 'Mark', 'Levinson',
  'Burmester', 'Meridian', 'Fender', 'Rockford', 'Sony', 'Revel', 'Bang', 'Olufsen',
  'B&O', 'Audiophile', 'premium', 'Beats', 'Kicker', 'Pioneer', 'THX',
  'Bowers', 'Wilkins', 'ELS', 'McIntosh', 'Nakamichi', 'Dynaudio', 'Monsoon',
  'Shaker', 'Mach', 'AKG', 'Boston',
];

// ═══════════════════════════════════════════════════════════════
// PLAYWRIGHT SINGLETON
// ═══════════════════════════════════════════════════════════════

let _browser = null;
let _page = null;

async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  if (!_browser || !_browser.isConnected()) {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    _browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    _browser.on('disconnected', () => { _browser = null; _page = null; });
  }
  const context = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  _page = await context.newPage();
  return _page;
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch (e) {} }
  _browser = null;
  _page = null;
}

async function restartBrowser() {
  await closeBrowser();
  return getPage();
}

// ═══════════════════════════════════════════════════════════════
// EBAY SCRAPER
// ═══════════════════════════════════════════════════════════════

async function scrapeEbaySold(searchQuery) {
  const page = await getPage();
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&_sacat=6030&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=60`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  return page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const priceEls = document.querySelectorAll('.s-card__price');

    priceEls.forEach((priceEl) => {
      try {
        let card = priceEl.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
        if (!card) return;

        const innerText = card.innerText?.replace(/\s+/g, ' ')?.trim() || '';
        const priceText = priceEl?.textContent?.trim() || '';

        if (innerText.includes('Shop on eBay')) return;

        const soldMatch = innerText.match(/Sold\s+(\w+\s+\d+,?\s*\d*)/i);
        if (!soldMatch) return;

        let title = innerText.replace(/^.*?Sold\s+\w+\s+\d+,?\s*\d*\s*/i, '');
        title = title.replace(/\$[\d,.]+.*$/, '').trim();
        title = title.replace(/\(For:.*$/i, '').trim();

        const cleanPrice = priceText.replace('to', ' ').split(' ')[0];
        const price = parseFloat(cleanPrice.replace(/[^0-9.]/g, ''));
        if (isNaN(price) || price <= 0) return;

        const key = title.substring(0, 50) + price;
        if (seen.has(key)) return;
        seen.add(key);

        results.push({ title, price, soldDate: soldMatch[1] });
      } catch (e) {}
    });

    return results;
  });
}

// ═══════════════════════════════════════════════════════════════
// RELEVANCE FILTER
// ═══════════════════════════════════════════════════════════════

function filterResults(results, make, partType) {
  const makeLower = make.toLowerCase().replace(/-/g, ' ');
  const makeWords = makeLower.split(/\s+/);

  return results.filter(r => {
    const t = (r.title || '').toLowerCase();
    // Must contain the make
    const hasMake = makeWords.some(w => t.includes(w));
    if (!hasMake) return false;

    // Must match part type
    if (partType === 'amp') return /\bamp\b|\bamplifier\b/i.test(t);
    if (partType === '360_camera') return /\b360\b|\bsurround\b|\baround.?view\b/i.test(t) && /\bcamera\b/i.test(t);
    if (partType === 'backup_camera') return /\bcamera\b/i.test(t) && !/\b360\b|\bsurround\b|\baround.?view\b/i.test(t);
    if (partType === 'nav_radio') return /\bradio\b|\bhead\s?unit\b|\breceiver\b|\bstereo\b|\binfotainment\b/i.test(t);
    if (partType === 'digital_cluster') return /\bcluster\b|\bspeedometer\b|\binstrument\b/i.test(t);

    return true;
  }).filter(r => {
    const t = (r.title || '').toLowerCase();
    // Exclude aftermarket/universal
    if (/\baftermarket\b|\buniversal\b|\breplacement\b|\bgeneric\b|\bwiring\b|\bharness only\b|\bconnector\b/i.test(t)) return false;
    // Exclude obviously wrong prices
    if (r.price < 10 || r.price > 2000) return false;
    return true;
  }).slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════
// QUEUE BUILDER
// ═══════════════════════════════════════════════════════════════

async function buildQueue() {
  const queue = [];

  // 1. Audio amp combos from trim_tier_reference not yet validated
  const allAudioCombos = await database.raw(`
    SELECT DISTINCT make, audio_brand
    FROM trim_tier_reference
    WHERE tier IN (3, 4) AND audio_brand IS NOT NULL AND audio_brand != ''
    ORDER BY make, audio_brand
  `);

  const existingAmp = await database('trim_value_validation')
    .where('part_type', 'amp')
    .select('make', 'premium_keyword');
  const existingAmpSet = new Set(existingAmp.map(r => r.make.toLowerCase() + '|' + r.premium_keyword.toLowerCase()));

  for (const row of allAudioCombos.rows) {
    const key = row.make.toLowerCase() + '|' + row.audio_brand.toLowerCase();
    if (!existingAmpSet.has(key)) {
      queue.push({
        make: row.make,
        part_type: 'amp',
        premium_keyword: row.audio_brand,
        premium_query: `${row.make} ${row.audio_brand} amplifier OEM`,
        base_query: `${row.make} amplifier OEM ${ALL_PREMIUM_EXCLUDES.map(k => '-' + k).join(' ')}`,
        source: 'new',
      });
    }
  }

  // 2. Existing validations with insufficient data (n_premium < 3 OR n_base < 3)
  const insufficient = await database('trim_value_validation')
    .where('source', 'YOUR_DATA')
    .where(function() {
      this.where('n_premium', '<', 3).orWhere('n_base', '<', 3);
    })
    .select('*');

  for (const row of insufficient) {
    // Don't add if already in queue from step 1
    const exists = queue.some(q => q.make.toLowerCase() === row.make.toLowerCase()
      && q.part_type === row.part_type && q.premium_keyword.toLowerCase() === row.premium_keyword.toLowerCase());
    if (exists) continue;

    let premQ, baseQ;
    if (row.part_type === 'amp') {
      premQ = `${row.make} ${row.premium_keyword} amplifier OEM`;
      baseQ = `${row.make} amplifier OEM ${ALL_PREMIUM_EXCLUDES.map(k => '-' + k).join(' ')}`;
    } else if (row.part_type === 'nav_radio') {
      premQ = `${row.make} navigation radio OEM`;
      baseQ = `${row.make} radio OEM -navigation -nav -GPS`;
    } else {
      continue;
    }

    queue.push({
      make: row.make,
      part_type: row.part_type,
      premium_keyword: row.premium_keyword,
      premium_query: premQ,
      base_query: baseQ,
      source: 'insufficient',
      existing_row: row,
    });
  }

  // 3. 360 camera combos not yet validated
  const cameraMakes = await database.raw(`
    SELECT DISTINCT make FROM trim_tier_reference
    WHERE tier IN (3, 4) AND expected_parts ILIKE '%360 camera%'
    ORDER BY make
  `);
  const existingCamera = await database('trim_value_validation')
    .where('part_type', '360_camera').select('make');
  const existingCameraSet = new Set(existingCamera.map(r => r.make.toLowerCase()));

  for (const row of cameraMakes.rows) {
    if (existingCameraSet.has(row.make.toLowerCase())) continue;
    queue.push({
      make: row.make,
      part_type: '360_camera',
      premium_keyword: '360 camera',
      premium_query: `${row.make} 360 camera OEM`,
      base_query: `${row.make} backup camera OEM -360 -surround -around`,
      source: 'new',
    });
  }

  // 4. Nav radio combos not yet validated
  const navMakes = await database.raw(`
    SELECT DISTINCT make FROM trim_tier_reference
    WHERE tier IN (3, 4) AND expected_parts ILIKE '%nav%'
    AND expected_parts NOT ILIKE '%nav possible%'
    ORDER BY make
  `);
  const existingNav = await database('trim_value_validation')
    .where('part_type', 'nav_radio').select('make');
  const existingNavSet = new Set(existingNav.map(r => r.make.toLowerCase()));

  for (const row of navMakes.rows) {
    if (existingNavSet.has(row.make.toLowerCase())) continue;
    queue.push({
      make: row.make,
      part_type: 'nav_radio',
      premium_keyword: 'navigation',
      premium_query: `${row.make} navigation radio OEM`,
      base_query: `${row.make} radio OEM -navigation -nav -GPS`,
      source: 'new',
    });
  }

  // 5. Digital cluster combos not yet validated
  const clusterMakes = await database.raw(`
    SELECT DISTINCT make FROM trim_tier_reference
    WHERE tier IN (3, 4) AND (expected_parts ILIKE '%Virtual Cockpit%' OR expected_parts ILIKE '%Digital Cockpit%')
    ORDER BY make
  `);
  const existingCluster = await database('trim_value_validation')
    .where('part_type', 'digital_cluster').select('make');
  const existingClusterSet = new Set(existingCluster.map(r => r.make.toLowerCase()));

  for (const row of clusterMakes.rows) {
    if (existingClusterSet.has(row.make.toLowerCase())) continue;
    queue.push({
      make: row.make,
      part_type: 'digital_cluster',
      premium_keyword: 'digital cluster',
      premium_query: `${row.make} digital instrument cluster OEM`,
      base_query: `${row.make} instrument cluster OEM -digital -LCD -TFT -virtual`,
      source: 'new',
    });
  }

  return queue;
}

// ═══════════════════════════════════════════════════════════════
// UPSERT LOGIC
// ═══════════════════════════════════════════════════════════════

async function upsertValidation(item, premiumResults, baseResults) {
  const premPrices = premiumResults.map(r => r.price);
  const basePrices = baseResults.map(r => r.price);
  const premAvg = premPrices.length > 0 ? premPrices.reduce((a, b) => a + b, 0) / premPrices.length : null;
  const baseAvg = basePrices.length > 0 ? basePrices.reduce((a, b) => a + b, 0) / basePrices.length : null;

  let nPrem = premPrices.length;
  let nBase = basePrices.length;
  let finalPremAvg = premAvg;
  let finalBaseAvg = baseAvg;
  let source = 'MARKET';

  // Combine with existing YOUR_DATA if present
  if (item.existing_row) {
    const ex = item.existing_row;
    const exPremAvg = parseFloat(ex.premium_avg_price) || 0;
    const exBaseAvg = parseFloat(ex.base_avg_price) || 0;
    const exNPrem = ex.n_premium || 0;
    const exNBase = ex.n_base || 0;

    // Weighted average
    if (premAvg !== null && exPremAvg > 0 && exNPrem > 0) {
      finalPremAvg = (exPremAvg * exNPrem + premAvg * nPrem) / (exNPrem + nPrem);
      nPrem = exNPrem + nPrem;
    } else if (exPremAvg > 0) {
      finalPremAvg = exPremAvg;
      nPrem = exNPrem;
    }

    if (baseAvg !== null && exBaseAvg > 0 && exNBase > 0) {
      finalBaseAvg = (exBaseAvg * exNBase + baseAvg * nBase) / (exNBase + nBase);
      nBase = exNBase + nBase;
    } else if (exBaseAvg > 0) {
      finalBaseAvg = exBaseAvg;
      nBase = exNBase;
    }

    source = 'COMBINED';
  }

  if (finalPremAvg === null || finalBaseAvg === null) return null;

  const delta = finalPremAvg - finalBaseAvg;

  let verdict;
  if (nPrem >= 3 && nBase >= 3) {
    if (delta > 75) verdict = 'CONFIRMED';
    else if (delta > 30) verdict = 'WORTH_IT';
    else if (delta > 0) verdict = 'MARGINAL';
    else verdict = 'NO_PREMIUM';
  } else {
    verdict = 'INSUFFICIENT';
  }

  const row = {
    make: item.make,
    part_type: item.part_type,
    premium_keyword: item.premium_keyword,
    premium_avg_price: Math.round(finalPremAvg * 100) / 100,
    base_avg_price: Math.round(finalBaseAvg * 100) / 100,
    delta: Math.round(delta * 100) / 100,
    n_premium: nPrem,
    n_base: nBase,
    verdict,
    source,
    validated_at: new Date(),
    updated_at: new Date(),
  };

  // UPSERT
  const existing = await database('trim_value_validation')
    .where('make', item.make)
    .where('part_type', item.part_type)
    .where('premium_keyword', item.premium_keyword)
    .first();

  if (existing) {
    await database('trim_value_validation').where('id', existing.id).update(row);
  } else {
    row.created_at = new Date();
    await database('trim_value_validation').insert(row);
  }

  return { ...row, action: existing ? 'UPDATED' : 'INSERTED' };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TRIM PREMIUM VALIDATOR' + (DRY_RUN ? ' [DRY RUN]' : ''));
  console.log('Time: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════\n');

  const queue = await buildQueue();

  // Print queue summary by type
  const byType = {};
  for (const q of queue) {
    byType[q.part_type] = (byType[q.part_type] || 0) + 1;
  }
  console.log(`Queue: ${queue.length} combos to validate`);
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  // Print full queue
  queue.forEach((q, i) => {
    console.log(`  [${i + 1}/${queue.length}] ${q.make} + ${q.premium_keyword} (${q.part_type}) [${q.source}]`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would scrape ' + queue.length + ' combos. Exiting.');
    await database.destroy();
    return;
  }

  console.log('\n--- Starting scrapes ---\n');

  let inserted = 0, updated = 0, skipped = 0, failures = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const label = `[${i + 1}/${queue.length}] ${item.make} + ${item.premium_keyword} (${item.part_type})`;

    if (consecutiveFailures >= 3) {
      console.error('\n*** 3 consecutive failures — aborting batch ***');
      break;
    }

    try {
      // Premium search
      let premRaw = await scrapeEbaySold(item.premium_query);
      let premFiltered = filterResults(premRaw, item.make, item.part_type);

      // Random delay 3-8s
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

      // Base search
      let baseRaw = await scrapeEbaySold(item.base_query);
      let baseFiltered;
      if (item.part_type === '360_camera') {
        baseFiltered = filterResults(baseRaw, item.make, 'backup_camera');
      } else {
        baseFiltered = filterResults(baseRaw, item.make, item.part_type);
      }

      // Skip if both sides empty (likely eBay block or no data)
      if (premFiltered.length === 0 && baseFiltered.length === 0) {
        console.log(`  ${label}: 0 premium, 0 base results — SKIPPED`);
        skipped++;
        consecutiveFailures++;
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
        continue;
      }

      consecutiveFailures = 0;

      // Upsert
      const result = await upsertValidation(item, premFiltered, baseFiltered);
      if (!result) {
        console.log(`  ${label}: insufficient data to compute — SKIPPED`);
        skipped++;
        continue;
      }

      const deltaStr = result.delta >= 0 ? '+$' + Math.round(result.delta) : '-$' + Math.round(Math.abs(result.delta));
      console.log(`  ${label}: premium $${Math.round(result.premium_avg_price)} (n=${result.n_premium}) vs base $${Math.round(result.base_avg_price)} (n=${result.n_base}) → ${result.verdict} ${deltaStr} [${result.action}]`);

      if (result.action === 'INSERTED') inserted++;
      else updated++;

      // Random delay 3-8s between combos
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));

    } catch (err) {
      console.error(`  ${label}: ERROR — ${err.message}`);
      failures++;
      consecutiveFailures++;

      // Attempt browser restart on failure
      if (consecutiveFailures <= 2) {
        console.log('  Restarting browser...');
        try { await restartBrowser(); } catch (e) {}
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  // ═══ SUMMARY ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Processed: ${inserted + updated + skipped + failures}/${queue.length}`);
  console.log(`  New validations: ${inserted}`);
  console.log(`  Updated existing: ${updated}`);
  console.log(`  Skipped (no data): ${skipped}`);
  console.log(`  Failures: ${failures}`);

  // Final verdict breakdown
  const verdicts = await database('trim_value_validation')
    .groupBy('verdict')
    .select('verdict')
    .count('* as count')
    .orderBy('verdict');
  console.log('\nFinal verdict breakdown:');
  verdicts.forEach(r => console.log(`  ${r.verdict}: ${r.count}`));

  const total = await database('trim_value_validation').count('* as count');
  console.log(`\nTotal validations in DB: ${total[0].count}`);

  await closeBrowser();
  await database.destroy();
}

main().catch(err => {
  console.error('FATAL:', err.message);
  closeBrowser().then(() => database.destroy()).then(() => process.exit(1));
});
