#!/usr/bin/env node
'use strict';

/**
 * generate-query-list.js
 *
 * Generates the deduped query list from your active inventory.
 * Run this BEFORE signing up for Apify to see exactly how many
 * unique queries you'd be paying for.
 *
 * Usage:
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node generate-query-list.js
 *
 * Optional flags:
 *   --source=your_listing    (default) Only your active inventory
 *   --source=importaparts    Only importaparts items with part numbers
 *   --source=both            Both sources
 *   --export                 Write queries to CSV file
 *   --limit=100              Limit rows pulled from DB (for testing)
 */

const knex = require('knex');
const fs = require('fs');
const { buildSearchQuery } = require('./service/scripts/smart-query-builder');

// ── Parse CLI flags ────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  const [key, val] = arg.replace('--', '').split('=');
  flags[key] = val || true;
}

const SOURCE = flags.source || 'your_listing';
const EXPORT = flags.export || false;
const LIMIT = flags.limit ? parseInt(flags.limit) : null;

// ── DB Connection ──────────────────────────────────────────────
const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 1, max: 3 },
});

// ── Part number suffix stripping ───────────────────────────────
function stripPartNumberSuffix(pn) {
  if (!pn) return null;
  pn = pn.trim().toUpperCase();

  // Chrysler/Mopar: 56044691AA → 56044691
  const chrysler = pn.match(/^(\d{7,})[A-Z]{2}$/);
  if (chrysler) return chrysler[1];

  // GM style: similar
  const gm = pn.match(/^(\d{7,})[A-Z]{1,2}$/);
  if (gm) return gm[1];

  return pn;
}

// ── Extract part number from title ─────────────────────────────
function extractPartNumber(title) {
  if (!title) return null;
  const patterns = [
    /\b(\d{7,}\w{0,2})\b/,
    /\b(\d{5}-\d{2}\w{0,3})\b/,
    /\b([A-Z]{2}\d[A-Z]-\d{4,5}-[A-Z])\b/i,
    /\b([A-Z]{2}\d{3}-\d{3,5})\b/i,
  ];

  for (const pat of patterns) {
    const match = title.match(pat);
    if (match) return match[1];
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  DarkHawk — Apify Query List Generator');
  console.log(`  Source: ${SOURCE}`);
  console.log('═══════════════════════════════════════════════════\n');

  let rows = [];

  if (SOURCE === 'your_listing' || SOURCE === 'both') {
    let q = db('YourListing')
      .select('title', 'sku', 'currentPrice')
      .where('listingStatus', 'Active')
      .whereNotNull('title');
    if (LIMIT) q = q.limit(LIMIT);

    const listings = await q;
    console.log(`[YourListing] Pulled ${listings.length} active listings`);
    rows.push(...listings.map(r => ({
      title: r.title,
      partNumber: r.sku || extractPartNumber(r.title),
      currentPrice: r.currentPrice ? parseFloat(r.currentPrice) : null,
      source: 'your_listing',
    })));
  }

  if (SOURCE === 'importaparts' || SOURCE === 'both') {
    let q = db('Item')
      .select('title', 'manufacturerPartNumber', 'price')
      .whereNotNull('manufacturerPartNumber')
      .where('seller', 'importapart');
    if (LIMIT) q = q.limit(LIMIT);

    const items = await q;
    console.log(`[importapart] Pulled ${items.length} items with part numbers`);
    rows.push(...items.map(r => ({
      title: r.title,
      partNumber: r.manufacturerPartNumber,
      currentPrice: r.price ? parseFloat(r.price) : null,
      source: 'importaparts',
    })));
  }

  console.log(`\nTotal raw rows: ${rows.length}\n`);

  // ── Build & deduplicate queries ──────────────────────────────
  const queryMap = new Map();
  let skipped = 0;

  for (const row of rows) {
    const result = buildSearchQuery(row.title);
    if (!result.structured || !result.query || result.query.length < 5) {
      skipped++;
      continue;
    }

    const key = result.query.toLowerCase().trim().replace(/\s+/g, ' ');
    const pnBase = stripPartNumberSuffix(row.partNumber) || extractPartNumber(row.title);

    if (!queryMap.has(key)) {
      queryMap.set(key, {
        query: result.query,
        parts: result.parts,
        partNumberBase: pnBase ? stripPartNumberSuffix(pnBase) : null,
        sources: new Set(),
        sampleTitles: [],
        prices: [],
        count: 0,
      });
    }

    const entry = queryMap.get(key);
    entry.sources.add(row.source);
    entry.count++;
    if (entry.sampleTitles.length < 3) entry.sampleTitles.push(row.title);
    if (row.currentPrice) entry.prices.push(row.currentPrice);
    if (!entry.partNumberBase && pnBase) entry.partNumberBase = stripPartNumberSuffix(pnBase);
  }

  // ── Stats ────────────────────────────────────────────────────
  const queries = Array.from(queryMap.values());
  const withPN = queries.filter(q => q.partNumberBase).length;
  const withoutPN = queries.length - withPN;

  console.log('── RESULTS ──────────────────────────────────────');
  console.log(`Raw rows:              ${rows.length}`);
  console.log(`Skipped (bad query):   ${skipped}`);
  console.log(`Unique queries:        ${queries.length}`);
  console.log(`  With part number:    ${withPN}`);
  console.log(`  Without part number: ${withoutPN}`);
  console.log(`Dedup ratio:           ${rows.length > 0 ? (rows.length / queries.length).toFixed(1) : 0}x`);
  console.log('');

  // ── Cost estimate ────────────────────────────────────────────
  const resultsPerQuery = 20;
  const totalResults = queries.length * resultsPerQuery;
  const costCaffein = (totalResults / 1000) * 2;
  const costMarielise = (totalResults / 1000) * 25;

  console.log('── COST ESTIMATE ────────────────────────────────');
  console.log(`Queries × ${resultsPerQuery} results each = ${totalResults.toLocaleString()} total results`);
  console.log(`caffein.dev ($2/1K):     $${costCaffein.toFixed(2)}`);
  console.log(`marielise.dev ($25/1K):  $${costMarielise.toFixed(2)}`);
  console.log('');

  // ── Top queries by listing count ─────────────────────────────
  const sorted = queries.sort((a, b) => b.count - a.count);
  console.log('── TOP 25 QUERIES (by listing count) ────────────');
  console.log('Count | PN Base       | Query');
  console.log('──────┼───────────────┼─────────────────────────────────');
  for (const q of sorted.slice(0, 25)) {
    const pn = (q.partNumberBase || '—').padEnd(13);
    const cnt = String(q.count).padStart(5);
    console.log(`${cnt} | ${pn} | ${q.query.substring(0, 55)}`);
  }
  console.log('');

  // ── Part type breakdown ──────────────────────────────────────
  const partTypeCounts = {};
  for (const q of queries) {
    const pt = q.parts.partType || 'unknown';
    partTypeCounts[pt] = (partTypeCounts[pt] || 0) + 1;
  }

  const ptSorted = Object.entries(partTypeCounts).sort((a, b) => b[1] - a[1]);
  console.log('── QUERY BREAKDOWN BY PART TYPE ──────────────────');
  for (const [pt, count] of ptSorted.slice(0, 15)) {
    const bar = '█'.repeat(Math.min(40, Math.round(count / queries.length * 100)));
    console.log(`  ${pt.padEnd(30)} ${String(count).padStart(5)}  ${bar}`);
  }
  console.log('');

  // ── Export to CSV ────────────────────────────────────────────
  if (EXPORT) {
    const csvRows = ['query,part_number_base,part_type,make,model,years,source,listing_count,sample_title'];
    for (const q of sorted) {
      const row = [
        `"${q.query}"`,
        q.partNumberBase || '',
        q.parts.partType || '',
        q.parts.make || '',
        q.parts.model || '',
        q.parts.years || '',
        Array.from(q.sources).join('+'),
        q.count,
        `"${(q.sampleTitles[0] || '').replace(/"/g, '""')}"`,
      ].join(',');
      csvRows.push(row);
    }

    const filename = `apify-query-list-${SOURCE}-${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(filename, csvRows.join('\n'));
    console.log(`Exported ${queries.length} queries to ${filename}`);
  }

  // ── Sample queries for manual Apify test ─────────────────────
  console.log('── SAMPLE QUERIES FOR MANUAL APIFY TEST ─────────');
  console.log('Copy these into the Apify console to validate data quality:\n');

  const targetTypes = ['ECU ECM', 'BCM body control module', 'ABS module pump', 'amplifier', 'TIPM'];
  const samples = [];

  for (const targetType of targetTypes) {
    const match = queries.find(q => q.parts.partType === targetType);
    if (match) samples.push(match);
  }

  while (samples.length < 5 && sorted.length > samples.length) {
    const candidate = sorted[samples.length];
    if (!samples.includes(candidate)) samples.push(candidate);
  }

  for (let i = 0; i < Math.min(5, samples.length); i++) {
    const s = samples[i];
    console.log(`  ${i + 1}. "${s.query}"`);
    console.log(`     Part type: ${s.parts.partType || 'unknown'} | PN: ${s.partNumberBase || 'none'} | ${s.count} listings`);
    console.log(`     Sample: ${s.sampleTitles[0]?.substring(0, 70) || ''}`);
    console.log('');
  }

  await db.destroy();
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
