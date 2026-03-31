'use strict';

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL
});

// Known automotive makes for title extraction
const KNOWN_MAKES = [
  'Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chevy','Chrysler',
  'Dodge','Fiat','Ford','Genesis','GMC','Honda','Hyundai','Infiniti',
  'Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln','Mazda',
  'Mercedes','Mercedes-Benz','Mini','Mitsubishi','Nissan','Pontiac',
  'Porsche','Ram','Saab','Saturn','Scion','Subaru','Suzuki','Toyota',
  'Volkswagen','VW','Volvo'
];

const MAKE_NORMALIZE = {
  'Chevy': 'Chevrolet', 'Mercedes-Benz': 'Mercedes', 'Mercedes Benz': 'Mercedes',
  'VW': 'Volkswagen', 'Land Rover': 'Land Rover'
};

function extractMake(title) {
  const t = title || '';
  for (const make of KNOWN_MAKES) {
    const re = new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(t)) return MAKE_NORMALIZE[make] || make;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SELLABLE SCOPE FILTERS
// ═══════════════════════════════════════════════════════════════

const AUDIO_BRANDS = [
  'bose', 'harman kardon', 'jbl', 'infinity', 'alpine', 'b&o', 'bang olufsen',
  'bang & olufsen', 'mark levinson', 'burmester', 'meridian', 'fender',
  'rockford fosgate', 'sony', 'revel', 'audiophile', 'premium audio',
  'beats', 'kicker', 'boston acoustics', 'pioneer', 'thx', 'bowers & wilkins',
  'mach', 'shaker', 'els', 'mcintosh', 'nakamichi', 'dynaudio', 'monsoon',
  'concert sound', 'akg'
];

function isSellableSuggestion(s) {
  const low = s.toLowerCase().trim();

  // Audio amplifiers
  if ((low.includes('amp') || low.includes('stereo') || low.includes('audio') || low.includes('sound'))
      && !low.includes('ramp')) {
    for (const brand of AUDIO_BRANDS) {
      if (low.includes(brand)) return { category: 'AUDIO_AMP', sub: brand };
    }
    if (low.includes('amp')) return { category: 'AUDIO_AMP', sub: 'generic' };
  }

  // Head units / nav / radio / infotainment systems
  if (low.includes('uconnect') || low.includes('sync') || low.includes('entune')
      || low.includes('mylink') || low.includes('intellilink') || low.includes('mbux')
      || low.includes('comand') || low.includes('idrive') || low.includes('cue')
      || low.includes('head unit')) return { category: 'HEAD_UNIT', sub: low };
  if (low === 'nav' || low === 'nav possible' || low.includes('nav ')) return { category: 'NAV_UNIT', sub: 'nav' };

  // ECM/PCM
  if (low.includes('ecm') || low.includes('pcm')) return { category: 'ECM', sub: low };

  // BCM
  if (low.includes('bcm')) return { category: 'BCM', sub: low };

  // TCM
  if (low.includes('tcm')) return { category: 'TCM', sub: low };

  // ABS
  if (low === 'abs' || low.includes('abs module')) return { category: 'ABS', sub: low };

  // TIPM / fuse box
  if (low.includes('tipm')) return { category: 'TIPM', sub: low };

  // Cameras
  if (low.includes('camera') || low.includes('around view') || low.includes('surround view'))
    return { category: 'CAMERA', sub: low };

  // Parking sensors / blind spot
  if (low.includes('parking sensor') || low.includes('park assist') || low.includes('blind spot'))
    return { category: 'SENSOR', sub: low };

  // Clusters
  if (low.includes('cluster') || low.includes('virtual cockpit') || low.includes('digital cockpit')
      || low.includes('live cockpit')) return { category: 'CLUSTER', sub: low };

  // HVAC
  if (low.includes('climate') && low.includes('control')) return { category: 'HVAC', sub: low };

  // Not sellable scope
  return null;
}

// ═══════════════════════════════════════════════════════════════

async function run() {
  // ════════════════════════════════════════════════════════════
  // TASK 1: Filter suggestions to sellable scope
  // ════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TASK 1: SELLABLE-SCOPE SUGGESTIONS FROM trim_tier_reference');
  console.log('═══════════════════════════════════════════════════════════════');

  const allTtr = await knex('trim_tier_reference')
    .whereIn('tier', [3, 4])
    .whereNotNull('expected_parts')
    .whereNot('expected_parts', '')
    .select('expected_parts');

  const suggestionCounts = {};
  for (const row of allTtr) {
    const parts = row.expected_parts.split(',').map(p => p.trim()).filter(Boolean);
    for (const p of parts) {
      suggestionCounts[p] = (suggestionCounts[p] || 0) + 1;
    }
  }

  const sellable = {};
  const discarded = [];
  for (const [name, count] of Object.entries(suggestionCounts)) {
    const result = isSellableSuggestion(name);
    if (result) {
      if (!sellable[result.category]) sellable[result.category] = [];
      sellable[result.category].push({ name, count, sub: result.sub });
    } else {
      discarded.push({ name, count });
    }
  }

  let totalSellable = 0;
  let totalSellableMentions = 0;
  for (const [cat, items] of Object.entries(sellable).sort()) {
    items.sort((a, b) => b.count - a.count);
    console.log(`\n  [${cat}] (${items.length} unique)`);
    for (const { name, count } of items) {
      console.log(`    ${String(count).padStart(4)}x  ${name}`);
      totalSellable++;
      totalSellableMentions += count;
    }
  }

  console.log(`\n  SELLABLE: ${totalSellable} unique suggestions, ${totalSellableMentions} total mentions`);
  console.log(`  DISCARDED: ${discarded.length} suggestions (not in sellable scope)`);

  // ════════════════════════════════════════════════════════════
  // TASK 2: Audio Amp Premium-vs-Base Analysis
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TASK 2: AUDIO AMP PREMIUM vs BASE PRICE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  const allSales = await knex('YourSale').select('title', 'salePrice');

  // Categorize amp sales
  const AUDIO_KEYWORDS = [
    { brand: 'Bose', pattern: /\bbose\b/i },
    { brand: 'Harman Kardon', pattern: /\bharman\s*kardon\b/i },
    { brand: 'JBL', pattern: /\bjbl\b/i },
    { brand: 'Mark Levinson', pattern: /\bmark\s*levinson\b/i },
    { brand: 'Infinity', pattern: /\binfinity\b/i },
    { brand: 'Alpine', pattern: /\balpine\b/i },
    { brand: 'Rockford Fosgate', pattern: /\brockford\s*fosgate\b/i },
    { brand: 'B&O', pattern: /\bb&o\b|\bbang\s*(?:&\s*)?olufsen\b/i },
    { brand: 'Sony', pattern: /\bsony\b/i },
    { brand: 'Fender', pattern: /\bfender\b/i },
    { brand: 'Burmester', pattern: /\bburmester\b/i },
    { brand: 'Meridian', pattern: /\bmeridian\b/i },
    { brand: 'Revel', pattern: /\brevel\b/i },
    { brand: 'Beats', pattern: /\bbeats\b/i },
  ];

  const isAmpTitle = (t) => /\bamp\b|\bamplifier\b/i.test(t);

  // Collect premium amp sales by make+brand
  const premiumAmps = {}; // { make: { brand: [prices] } }
  const baseAmps = {};    // { make: [prices] }

  for (const sale of allSales) {
    const title = sale.title || '';
    if (!isAmpTitle(title)) continue;

    const make = extractMake(title);
    if (!make) continue;
    const price = parseFloat(sale.salePrice);
    if (isNaN(price) || price <= 0) continue;

    let isPremium = false;
    for (const { brand, pattern } of AUDIO_KEYWORDS) {
      if (pattern.test(title)) {
        if (!premiumAmps[make]) premiumAmps[make] = {};
        if (!premiumAmps[make][brand]) premiumAmps[make][brand] = [];
        premiumAmps[make][brand].push(price);
        isPremium = true;
        break;
      }
    }

    if (!isPremium) {
      if (!baseAmps[make]) baseAmps[make] = [];
      baseAmps[make].push(price);
    }
  }

  // Print comparison table
  const ampResults = [];
  console.log('\n  Make             | Brand           | Premium Avg (n) | Base Avg (n)    | Delta    | Verdict');
  console.log('  ' + '─'.repeat(105));

  for (const [make, brands] of Object.entries(premiumAmps).sort()) {
    for (const [brand, prices] of Object.entries(brands).sort()) {
      const premAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const basePrices = baseAmps[make] || [];
      const baseAvg = basePrices.length > 0 ? basePrices.reduce((a, b) => a + b, 0) / basePrices.length : null;
      const delta = baseAvg !== null ? premAvg - baseAvg : null;

      let verdict = 'INSUFFICIENT';
      if (prices.length >= 3 && basePrices.length >= 3 && delta !== null) {
        if (delta > 75) verdict = 'CONFIRMED';
        else if (delta > 30) verdict = 'WORTH_IT';
        else if (delta > 0) verdict = 'MARGINAL';
        else verdict = 'NO_PREMIUM';
      } else if (prices.length < 3 || basePrices.length < 3) {
        verdict = 'INSUFFICIENT';
      }

      ampResults.push({ make, brand, premAvg, premN: prices.length, baseAvg, baseN: basePrices.length, delta, verdict });

      console.log(`  ${make.padEnd(17)}| ${brand.padEnd(16)}| $${premAvg.toFixed(0).padStart(5)} (n=${String(prices.length).padStart(3)}) | ${baseAvg !== null ? '$' + baseAvg.toFixed(0).padStart(5) : '  N/A '} (n=${String(basePrices.length).padStart(3)}) | ${delta !== null ? (delta >= 0 ? '+' : '') + '$' + delta.toFixed(0).padStart(4) : ' N/A '} | ${verdict}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // TASK 3: Camera Premium Analysis
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TASK 3: CAMERA PREMIUM vs STANDARD ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  const premCameras = {}; // 360/surround cameras by make
  const stdCameras = {};  // standard backup cameras by make

  for (const sale of allSales) {
    const title = sale.title || '';
    if (!/\bcamera\b/i.test(title)) continue;
    const make = extractMake(title);
    if (!make) continue;
    const price = parseFloat(sale.salePrice);
    if (isNaN(price) || price <= 0) continue;

    if (/\b360\b|\bsurround\b|\baround\s*view\b/i.test(title)) {
      if (!premCameras[make]) premCameras[make] = [];
      premCameras[make].push(price);
    } else if (/\bbackup\b|\brear\b|\breverse\b/i.test(title)) {
      if (!stdCameras[make]) stdCameras[make] = [];
      stdCameras[make].push(price);
    }
  }

  console.log('\n  Make             | 360/Surround Avg (n) | Backup Avg (n)  | Delta    | Verdict');
  console.log('  ' + '─'.repeat(95));

  const camResults = [];
  for (const make of [...new Set([...Object.keys(premCameras), ...Object.keys(stdCameras)])].sort()) {
    const prem = premCameras[make] || [];
    const std = stdCameras[make] || [];
    if (prem.length === 0) continue;

    const premAvg = prem.reduce((a, b) => a + b, 0) / prem.length;
    const stdAvg = std.length > 0 ? std.reduce((a, b) => a + b, 0) / std.length : null;
    const delta = stdAvg !== null ? premAvg - stdAvg : null;

    let verdict = 'INSUFFICIENT';
    if (prem.length >= 3 && std.length >= 3 && delta !== null) {
      if (delta > 75) verdict = 'CONFIRMED';
      else if (delta > 30) verdict = 'WORTH_IT';
      else if (delta > 0) verdict = 'MARGINAL';
      else verdict = 'NO_PREMIUM';
    }

    camResults.push({ make, premAvg, premN: prem.length, stdAvg, stdN: std.length, delta, verdict });
    console.log(`  ${make.padEnd(17)}| $${premAvg.toFixed(0).padStart(5)} (n=${String(prem.length).padStart(3)})         | ${stdAvg !== null ? '$' + stdAvg.toFixed(0).padStart(5) : '  N/A '} (n=${String(std.length).padStart(3)})  | ${delta !== null ? (delta >= 0 ? '+' : '') + '$' + delta.toFixed(0).padStart(4) : ' N/A '} | ${verdict}`);
  }

  // ════════════════════════════════════════════════════════════
  // TASK 4: Navigation/Radio Analysis
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TASK 4: NAVIGATION RADIO vs STANDARD RADIO ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  const navRadios = {};
  const stdRadios = {};

  for (const sale of allSales) {
    const title = sale.title || '';
    if (!/\bradio\b|\bhead\s*unit\b|\breceiver\b|\bstereo\b|\binfotainment\b/i.test(title)) continue;
    const make = extractMake(title);
    if (!make) continue;
    const price = parseFloat(sale.salePrice);
    if (isNaN(price) || price <= 0) continue;

    if (/\bnav\b|\bnavigation\b|\bgps\b/i.test(title)) {
      if (!navRadios[make]) navRadios[make] = [];
      navRadios[make].push(price);
    } else {
      if (!stdRadios[make]) stdRadios[make] = [];
      stdRadios[make].push(price);
    }
  }

  console.log('\n  Make             | Nav Radio Avg (n)    | Std Radio Avg (n) | Delta    | Verdict');
  console.log('  ' + '─'.repeat(95));

  const navResults = [];
  for (const make of [...new Set([...Object.keys(navRadios), ...Object.keys(stdRadios)])].sort()) {
    const nav = navRadios[make] || [];
    const std = stdRadios[make] || [];
    if (nav.length === 0) continue;

    const navAvg = nav.reduce((a, b) => a + b, 0) / nav.length;
    const stdAvg = std.length > 0 ? std.reduce((a, b) => a + b, 0) / std.length : null;
    const delta = stdAvg !== null ? navAvg - stdAvg : null;

    let verdict = 'INSUFFICIENT';
    if (nav.length >= 3 && std.length >= 3 && delta !== null) {
      if (delta > 75) verdict = 'CONFIRMED';
      else if (delta > 30) verdict = 'WORTH_IT';
      else if (delta > 0) verdict = 'MARGINAL';
      else verdict = 'NO_PREMIUM';
    }

    navResults.push({ make, navAvg, navN: nav.length, stdAvg, stdN: std.length, delta, verdict });
    console.log(`  ${make.padEnd(17)}| $${navAvg.toFixed(0).padStart(5)} (n=${String(nav.length).padStart(3)})         | ${stdAvg !== null ? '$' + stdAvg.toFixed(0).padStart(5) : '  N/A '} (n=${String(std.length).padStart(3)})    | ${delta !== null ? (delta >= 0 ? '+' : '') + '$' + delta.toFixed(0).padStart(4) : ' N/A '} | ${verdict}`);
  }

  // ════════════════════════════════════════════════════════════
  // TASK 5: Cluster Analysis
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TASK 5: DIGITAL CLUSTER vs STANDARD CLUSTER ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════');

  const digitalClusters = {};
  const stdClusters = {};

  for (const sale of allSales) {
    const title = sale.title || '';
    if (!/\bcluster\b|\bspeedometer\b|\binstrument\b/i.test(title)) continue;
    const make = extractMake(title);
    if (!make) continue;
    const price = parseFloat(sale.salePrice);
    if (isNaN(price) || price <= 0) continue;

    if (/\bdigital\b|\blcd\b|\btft\b|\bvirtual\b/i.test(title)) {
      if (!digitalClusters[make]) digitalClusters[make] = [];
      digitalClusters[make].push(price);
    } else {
      if (!stdClusters[make]) stdClusters[make] = [];
      stdClusters[make].push(price);
    }
  }

  console.log('\n  Make             | Digital Avg (n)      | Standard Avg (n)  | Delta    | Verdict');
  console.log('  ' + '─'.repeat(95));

  const clusterResults = [];
  for (const make of [...new Set([...Object.keys(digitalClusters), ...Object.keys(stdClusters)])].sort()) {
    const dig = digitalClusters[make] || [];
    const std = stdClusters[make] || [];
    if (dig.length === 0 && std.length === 0) continue;

    const digAvg = dig.length > 0 ? dig.reduce((a, b) => a + b, 0) / dig.length : null;
    const stdAvg = std.length > 0 ? std.reduce((a, b) => a + b, 0) / std.length : null;
    const delta = (digAvg !== null && stdAvg !== null) ? digAvg - stdAvg : null;

    let verdict = 'INSUFFICIENT';
    if (dig.length >= 3 && std.length >= 3 && delta !== null) {
      if (delta > 75) verdict = 'CONFIRMED';
      else if (delta > 30) verdict = 'WORTH_IT';
      else if (delta > 0) verdict = 'MARGINAL';
      else verdict = 'NO_PREMIUM';
    }

    if (dig.length > 0) {
      clusterResults.push({ make, digAvg, digN: dig.length, stdAvg, stdN: std.length, delta, verdict });
      console.log(`  ${make.padEnd(17)}| ${digAvg !== null ? '$' + digAvg.toFixed(0).padStart(5) : '  N/A '} (n=${String(dig.length).padStart(3)})         | ${stdAvg !== null ? '$' + stdAvg.toFixed(0).padStart(5) : '  N/A '} (n=${String(std.length).padStart(3)})    | ${delta !== null ? (delta >= 0 ? '+' : '') + '$' + delta.toFixed(0).padStart(4) : ' N/A '} | ${verdict}`);
    }
  }

  if (clusterResults.length === 0) {
    console.log('  No digital cluster sales found in YourSale data.');
  }

  // ════════════════════════════════════════════════════════════
  // TASK 6: VALIDATION SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log(`\nSellable-scope suggestions: ${totalSellable} unique, ${totalSellableMentions} mentions`);

  // Collect all verdicts
  const allResults = [
    ...ampResults.map(r => ({ ...r, type: 'AMP', label: `${r.make} ${r.brand} amp` })),
    ...camResults.map(r => ({ ...r, type: 'CAMERA', label: `${r.make} 360 camera`, premAvg: r.premAvg, baseAvg: r.stdAvg })),
    ...navResults.map(r => ({ ...r, type: 'NAV', label: `${r.make} nav radio`, premAvg: r.navAvg, baseAvg: r.stdAvg })),
    ...clusterResults.map(r => ({ ...r, type: 'CLUSTER', label: `${r.make} digital cluster`, premAvg: r.digAvg, baseAvg: r.stdAvg })),
  ];

  const confirmed = allResults.filter(r => r.verdict === 'CONFIRMED');
  const worthIt = allResults.filter(r => r.verdict === 'WORTH_IT');
  const marginal = allResults.filter(r => r.verdict === 'MARGINAL');
  const noPremium = allResults.filter(r => r.verdict === 'NO_PREMIUM');
  const insufficient = allResults.filter(r => r.verdict === 'INSUFFICIENT');

  console.log(`\nValidation verdicts:`);
  console.log(`  CONFIRMED (delta > $75):  ${confirmed.length}`);
  console.log(`  WORTH_IT  ($30-$75):      ${worthIt.length}`);
  console.log(`  MARGINAL  (< $30):        ${marginal.length}`);
  console.log(`  NO_PREMIUM (negative):    ${noPremium.length}`);
  console.log(`  INSUFFICIENT DATA:        ${insufficient.length}`);

  if (confirmed.length > 0) {
    console.log(`\n  ┌─── CONFIRMED PREMIUM PARTS (delta > $75) ───────────────────────────┐`);
    confirmed.sort((a, b) => (b.delta || 0) - (a.delta || 0));
    for (const r of confirmed) {
      console.log(`  │ ${r.label.padEnd(35)} $${r.premAvg.toFixed(0).padStart(5)} vs $${(r.baseAvg||0).toFixed(0).padStart(5)}  +$${(r.delta||0).toFixed(0).padStart(4)} │`);
    }
    console.log(`  └─────────────────────────────────────────────────────────────────────┘`);
  }

  if (worthIt.length > 0) {
    console.log(`\n  ┌─── WORTH_IT PREMIUM PARTS ($30-$75 delta) ──────────────────────────┐`);
    worthIt.sort((a, b) => (b.delta || 0) - (a.delta || 0));
    for (const r of worthIt) {
      console.log(`  │ ${r.label.padEnd(35)} $${r.premAvg.toFixed(0).padStart(5)} vs $${(r.baseAvg||0).toFixed(0).padStart(5)}  +$${(r.delta||0).toFixed(0).padStart(4)} │`);
    }
    console.log(`  └─────────────────────────────────────────────────────────────────────┘`);
  }

  if (marginal.length > 0) {
    console.log(`\n  ┌─── MARGINAL (< $30 delta) ──────────────────────────────────────────┐`);
    marginal.sort((a, b) => (b.delta || 0) - (a.delta || 0));
    for (const r of marginal) {
      console.log(`  │ ${r.label.padEnd(35)} $${r.premAvg.toFixed(0).padStart(5)} vs $${(r.baseAvg||0).toFixed(0).padStart(5)}  +$${(r.delta||0).toFixed(0).padStart(4)} │`);
    }
    console.log(`  └─────────────────────────────────────────────────────────────────────┘`);
  }

  if (noPremium.length > 0) {
    console.log(`\n  ┌─── NO PREMIUM (negative delta) ──────────────────────────────────────┐`);
    for (const r of noPremium) {
      console.log(`  │ ${r.label.padEnd(35)} $${r.premAvg.toFixed(0).padStart(5)} vs $${(r.baseAvg||0).toFixed(0).padStart(5)}  ${(r.delta||0) >= 0 ? '+' : ''}$${(r.delta||0).toFixed(0).padStart(4)} │`);
    }
    console.log(`  └──────────────────────────────────────────────────────────────────────┘`);
  }

  // Suggestions needing Playwright scrapes
  const sellableCategories = Object.keys(sellable);
  const brandsWithInternalData = new Set(ampResults.filter(r => r.verdict !== 'INSUFFICIENT').map(r => r.brand.toLowerCase()));
  const brandsNeedingScrapes = [];
  if (sellable['AUDIO_AMP']) {
    const brandsSeen = new Set();
    for (const item of sellable['AUDIO_AMP']) {
      const b = item.sub;
      if (!brandsSeen.has(b)) {
        brandsSeen.add(b);
        // Check if any make had sufficient data for this brand
        const hasData = ampResults.some(r => r.brand.toLowerCase() === b && r.verdict !== 'INSUFFICIENT');
        if (!hasData && b !== 'generic') {
          brandsNeedingScrapes.push(b);
        }
      }
    }
  }

  console.log(`\n  Suggestions needing Playwright scrapes (insufficient YourSale data):`);
  if (insufficient.length > 0) {
    for (const r of insufficient) {
      console.log(`    - ${r.label} (premium n=${r.premN || 0}, base n=${r.baseN || 0})`);
    }
  }
  if (brandsNeedingScrapes.length > 0) {
    console.log(`\n  Audio brands with ZERO YourSale amp matches:`);
    for (const b of brandsNeedingScrapes) {
      console.log(`    - ${b}`);
    }
  }

  await knex.destroy();
}

run().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
