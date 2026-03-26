#!/usr/bin/env node
/**
 * DARKHAWK — Competitor Fitment Scraper
 *
 * Pulls compatibility tables from competitor listings (importaparts, prorebuild)
 * via Playwright stealth + Trading API GetItem. Stores in fitment_intelligence.
 *
 * Pipeline:
 *   1. Query YourSale for distinct part_type + make + model combos we sell
 *   2. For each combo, search eBay for that part from target sellers
 *   3. Pull item IDs from search results
 *   4. Call Trading API GetItem with IncludeItemCompatibilityList=true
 *   5. Run subtraction logic against eBay taxonomy → negations
 *   6. Store in fitment_intelligence table
 *
 * Schedule: Weekly (fitment data doesn't change often)
 * Usage: node service/scripts/scrape-competitor-fitment.js [--limit N] [--test] [--part-type ECM]
 */

'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '..', '..'));
require('dotenv').config();

const { database } = require('../database/database');
const {
  fetchItemCompatibility,
  buildFitmentProfile,
  generateNegationText,
  generatePartNumberWarning,
  storeFitmentProfile,
} = require('../services/FitmentIntelligenceService');

const TARGET_SELLERS = ['importaparts', 'prorebuild'];

// Parse CLI args
const args = process.argv.slice(2);
const testMode = args.includes('--test');
const limitIdx = args.indexOf('--limit');
const ptIdx = args.indexOf('--part-type');
const MAX_COMBOS = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 50 : (testMode ? 3 : 50);
const FILTER_PT = ptIdx >= 0 ? args[ptIdx + 1]?.toUpperCase() : null;

// ── Playwright browser for eBay search ────────────────────────
let _browser = null;
let _page = null;

async function initBrowser() {
  try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    _page = await ctx.newPage();
    return true;
  } catch (e) {
    console.error('Playwright unavailable:', e.message);
    return false;
  }
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch (e) {} }
}

/**
 * Search eBay for a seller's listings matching a keyword.
 * Returns array of item IDs.
 */
async function searchSellerListings(seller, keywords, maxResults = 5) {
  if (!_page) return [];

  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&_sacat=6030&_ssn=${seller}&_ipg=60`;

  try {
    await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await _page.waitForTimeout(2000);

    const itemIds = await _page.evaluate((max) => {
      const ids = [];
      // Extract item IDs from listing links
      document.querySelectorAll('ul.srp-results a.s-item__link, ul.srp-results a[href*="/itm/"]').forEach(a => {
        const href = a.href || '';
        const match = href.match(/\/itm\/(\d{12,13})/);
        if (match && !ids.includes(match[1])) {
          ids.push(match[1]);
          if (ids.length >= max) return;
        }
      });
      return ids;
    }, maxResults);

    return itemIds;
  } catch (e) {
    return [];
  }
}

// ── Part type detection ─────────────────────────────────────────
function detectPartType(title) {
  const t = (title || '').toUpperCase();
  if (t.includes('TCM') || t.includes('TCU') || t.includes('TRANSMISSION CONTROL')) return 'TCM';
  if (t.includes('BCM') || t.includes('BODY CONTROL')) return 'BCM';
  if (t.includes('ECM') || t.includes('ECU') || t.includes('PCM') || t.includes('ENGINE CONTROL')) return 'ECM';
  if (t.includes('ABS') || t.includes('ANTI LOCK') || t.includes('ANTI-LOCK')) return 'ABS';
  if (t.includes('TIPM') || t.includes('FUSE BOX') || t.includes('JUNCTION') || t.includes('IPDM')) return 'TIPM';
  if (t.includes('AMPLIFIER') || t.includes('AMP')) return 'AMP';
  if (t.includes('CLUSTER') || t.includes('SPEEDOMETER') || t.includes('INSTRUMENT')) return 'CLUSTER';
  if (t.includes('RADIO') || t.includes('HEAD UNIT') || t.includes('STEREO')) return 'RADIO';
  if (t.includes('THROTTLE')) return 'THROTTLE';
  if (t.includes('STEERING') || t.includes('EPS')) return 'STEERING';
  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('DARKHAWK — Competitor Fitment Scraper');
  console.log(new Date().toISOString());
  if (testMode) console.log('** TEST MODE — limit ' + MAX_COMBOS + ' combos **');
  if (FILTER_PT) console.log('** Filtering to part type: ' + FILTER_PT + ' **');
  console.log('═══════════════════════════════════════════\n');

  // Ensure table exists
  try {
    await database.raw(`SELECT 1 FROM fitment_intelligence LIMIT 0`);
  } catch (e) {
    console.log('Running migration for fitment_intelligence table...');
    await database.raw(`
      CREATE TABLE IF NOT EXISTS fitment_intelligence (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        part_type TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
        year_start INTEGER NOT NULL, year_end INTEGER NOT NULL,
        fits_trims JSONB DEFAULT '[]', fits_engines JSONB DEFAULT '[]',
        fits_transmissions JSONB DEFAULT '[]',
        does_not_fit_trims JSONB DEFAULT '[]', does_not_fit_engines JSONB DEFAULT '[]',
        does_not_fit_transmissions JSONB DEFAULT '[]',
        part_number_variants JSONB DEFAULT '{}',
        negation_text TEXT, part_number_warning TEXT,
        source_seller TEXT, source_listings JSONB DEFAULT '[]',
        confidence TEXT DEFAULT 'low',
        scraped_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(part_type, make, model, year_start, year_end)
      );
      CREATE INDEX IF NOT EXISTS idx_fitment_lookup ON fitment_intelligence (make, model, part_type);
      CREATE INDEX IF NOT EXISTS idx_fitment_year ON fitment_intelligence (year_start, year_end);
    `);
    console.log('Table created.\n');
  }

  // Step 1: Get distinct combos from our sales
  console.log('1. Finding part combos from YourSale...');
  const salesCombos = await database.raw(`
    SELECT title, COUNT(*) as cnt, ROUND(AVG("salePrice")::numeric, 2) as avg_price
    FROM "YourSale"
    WHERE "soldDate" > NOW() - INTERVAL '180 days' AND title IS NOT NULL AND "salePrice" > 75
    GROUP BY title
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
  `);

  // Parse titles into make/model/partType combos
  const MAKE_MAP = {
    'ford': 'Ford', 'toyota': 'Toyota', 'honda': 'Honda', 'dodge': 'Dodge',
    'jeep': 'Jeep', 'chrysler': 'Chrysler', 'ram': 'Ram', 'chevrolet': 'Chevrolet',
    'chevy': 'Chevrolet', 'gmc': 'GMC', 'nissan': 'Nissan', 'bmw': 'BMW',
    'mazda': 'Mazda', 'kia': 'Kia', 'hyundai': 'Hyundai', 'subaru': 'Subaru',
    'lexus': 'Lexus', 'acura': 'Acura', 'cadillac': 'Cadillac', 'buick': 'Buick',
    'lincoln': 'Lincoln', 'volvo': 'Volvo', 'volkswagen': 'Volkswagen', 'infiniti': 'Infiniti',
    'mercedes': 'Mercedes-Benz',
  };

  const combos = new Map(); // "MAKE|MODEL|PARTTYPE" → { make, model, partType, yearStart, yearEnd, sampleTitle, count }
  for (const row of (salesCombos.rows || salesCombos)) {
    const title = row.title || '';
    const titleLower = title.toLowerCase();
    const pt = detectPartType(title);
    if (!pt) continue;
    if (FILTER_PT && pt !== FILTER_PT) continue;

    let make = null;
    for (const [alias, canonical] of Object.entries(MAKE_MAP)) {
      if (titleLower.includes(alias)) { make = canonical; break; }
    }
    if (!make) continue;

    // Extract year range
    const yearMatch = title.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
    const singleYear = title.match(/\b((?:19|20)\d{2})\b/);
    let ys = 0, ye = 0;
    if (yearMatch) { ys = parseInt(yearMatch[1]); ye = parseInt(yearMatch[2]); }
    else if (singleYear) { ys = parseInt(singleYear[1]); ye = ys; }

    // Extract model (crude — take word after make)
    const makeIdx = titleLower.indexOf(make.toLowerCase());
    const afterMake = title.substring(makeIdx + make.length).trim();
    const modelWords = afterMake.split(/\s+/).slice(0, 2);
    let model = modelWords.filter(w => !/^\d{4}/.test(w) && !/^(ecm|pcm|bcm|abs|tcm|oem)/i.test(w)).join(' ').trim();
    if (!model || model.length < 2) continue;
    // Clean model
    model = model.replace(/[^A-Za-z0-9\- ]/g, '').trim();

    const key = `${make}|${model.toUpperCase()}|${pt}`;
    if (!combos.has(key)) {
      combos.set(key, { make, model, partType: pt, yearStart: ys, yearEnd: ye, sampleTitle: title, count: 0 });
    }
    const c = combos.get(key);
    c.count += parseInt(row.cnt) || 0;
    if (ys > 0 && (c.yearStart === 0 || ys < c.yearStart)) c.yearStart = ys;
    if (ye > 0 && ye > c.yearEnd) c.yearEnd = ye;
    if (title.length > c.sampleTitle.length) c.sampleTitle = title;
  }

  const comboList = Array.from(combos.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COMBOS);

  console.log('   Found ' + combos.size + ' unique combos, processing top ' + comboList.length + '\n');

  // Step 2: Initialize browser
  console.log('2. Starting Playwright...');
  const browserOk = await initBrowser();
  if (!browserOk) {
    console.error('Cannot continue without Playwright. Exiting.');
    await database.destroy();
    return;
  }
  console.log('   Browser ready\n');

  // Step 3: For each combo, search competitors and pull compatibility
  console.log('3. Scraping competitor fitment data...\n');
  let processed = 0, stored = 0, noData = 0, errors = 0;

  for (let i = 0; i < comboList.length; i++) {
    const combo = comboList[i];
    const searchQuery = `${combo.make} ${combo.model} ${combo.partType}`;
    console.log(`   [${i + 1}/${comboList.length}] ${searchQuery} (${combo.yearStart}-${combo.yearEnd})`);

    let allCompat = [];
    let sourceListings = [];
    let sourceSeller = null;

    for (const seller of TARGET_SELLERS) {
      const itemIds = await searchSellerListings(seller, searchQuery, 3);
      if (itemIds.length === 0) continue;

      console.log(`      ${seller}: found ${itemIds.length} listings`);

      for (const itemId of itemIds) {
        try {
          const result = await fetchItemCompatibility(itemId);
          if (result.compatibility.length > 0) {
            allCompat.push(...result.compatibility);
            sourceListings.push({ itemId, seller, title: result.title, compatCount: result.compatibility.length });
            if (!sourceSeller) sourceSeller = seller;
            console.log(`      → ${itemId}: ${result.compatibility.length} compatibility entries`);
            // Got good data from this seller, skip remaining items
            break;
          }
        } catch (e) {
          console.log(`      → ${itemId}: ERROR ${e.message.substring(0, 50)}`);
        }
        await new Promise(r => setTimeout(r, 1000)); // Rate limit Trading API
      }

      if (allCompat.length > 0) break; // Got data from this seller, skip next seller
      await new Promise(r => setTimeout(r, 3000)); // Rate limit between sellers
    }

    processed++;

    if (allCompat.length === 0) {
      console.log('      No compatibility data found\n');
      noData++;
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    // Step 4: Build fitment profile via subtraction
    try {
      const profile = await buildFitmentProfile(allCompat, combo.make, combo.model, combo.yearStart, combo.yearEnd);
      const negationText = generateNegationText(profile, combo.make, combo.model, combo.yearStart, combo.yearEnd);
      const pnWarning = generatePartNumberWarning(null, combo.partType);

      // Determine confidence
      let confidence = 'low';
      if (allCompat.length >= 20 && (profile.doesNotFitTrims.length > 0 || profile.doesNotFitEngines.length > 0)) {
        confidence = 'high';
      } else if (allCompat.length >= 5) {
        confidence = 'medium';
      }

      // Store
      await storeFitmentProfile({
        partType: combo.partType,
        make: combo.make,
        model: combo.model,
        yearStart: combo.yearStart,
        yearEnd: combo.yearEnd,
        fitsTrims: profile.fitsTrims,
        fitsEngines: profile.fitsEngines,
        fitsTransmissions: [],
        doesNotFitTrims: profile.doesNotFitTrims,
        doesNotFitEngines: profile.doesNotFitEngines,
        doesNotFitTransmissions: [],
        partNumberVariants: {},
        negationText,
        partNumberWarning: pnWarning,
        sourceSeller,
        sourceListings,
        confidence,
      });

      stored++;
      console.log(`      STORED: ${confidence} confidence | fits ${profile.fitsTrims.length}T/${profile.fitsEngines.length}E | excludes ${profile.doesNotFitTrims.length}T/${profile.doesNotFitEngines.length}E`);
      if (negationText) console.log(`      Negation: ${negationText.substring(0, 100)}`);
    } catch (e) {
      errors++;
      console.log(`      BUILD ERROR: ${e.message}`);
    }

    console.log();
    // Rate limit: 5-8s between combos
    await new Promise(r => setTimeout(r, 5000 + Math.random() * 3000));
  }

  // Cleanup
  await closeBrowser();

  // Summary
  const { rows: [stats] } = await database.raw(`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN confidence = 'high' THEN 1 END) as high,
           COUNT(CASE WHEN confidence = 'medium' THEN 1 END) as medium,
           COUNT(CASE WHEN negation_text IS NOT NULL THEN 1 END) as with_negations
    FROM fitment_intelligence
  `);

  console.log('═══════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('  Processed:    ' + processed);
  console.log('  Stored:       ' + stored);
  console.log('  No data:      ' + noData);
  console.log('  Errors:       ' + errors);
  console.log('  DB total:     ' + stats.total + ' (' + stats.high + ' high, ' + stats.medium + ' medium)');
  console.log('  With negations: ' + stats.with_negations);
  console.log('═══════════════════════════════════════════');

  await database.destroy();
}

main().catch(async err => {
  console.error('FATAL:', err);
  await closeBrowser();
  process.exit(1);
});
