#!/usr/bin/env node
/**
 * DARKHAWK — Historical Sales CSV Backfill
 * Adapted to actual YourSale schema:
 *   id, ebayOrderId (UNIQUE), ebayItemId, title, sku, quantity,
 *   salePrice, soldDate, buyerUsername, shippedDate, createdAt, updatedAt, store
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CSV_FILES = [
  { file: 'eBay-OrdersReport-Mar-17-2026-17_47_58-0700-11294078063.csv', store: 'dynatrack' },
  { file: 'eBay-OrdersReport-Mar-17-2026-17_48_21-0700-13289108147.csv', store: 'dynatrack' },
  { file: 'eBay-OrdersReport-Mar-17-2026-17_51_33-0700-12305963929.csv', store: 'autolumen' },
  { file: 'eBay-OrdersReport-Mar-17-2026-17_51_53-0700-12305963994.csv', store: 'autolumen' },
  { file: 'eBay-OrdersReport-Mar-17-2026-17_53_16-0700-13289109021.csv', store: 'dynatrack' },
];

const COL = {
  ORDER_NUMBER: 1, BUYER_USERNAME: 2, ITEM_NUMBER: 22, ITEM_TITLE: 23,
  CUSTOM_LABEL: 24, QUANTITY: 26, SOLD_FOR: 27, SALE_DATE: 52,
  SHIPPED_ON: 57, TRANSACTION_ID: 64,
};

function parseEbayDate(s) {
  if (!s || !s.trim()) return null;
  const m = s.trim().match(/^(\w{3})-(\d{1,2})-(\d{2})$/);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const mon = months[m[1]]; if (!mon) return null;
  let yr = parseInt(m[3]); yr = yr < 50 ? 2000 + yr : 1900 + yr;
  return `${yr}-${mon}-${m[2].padStart(2,'0')}T00:00:00.000Z`;
}

function parsePrice(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/[$,\s]/g, '')) || 0;
}

function parseCSVLine(line) {
  const fields = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (line[i] === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
    else cur += line[i];
  }
  fields.push(cur.trim());
  return fields;
}

function parseCSVFile(filePath, store) {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const lines = raw.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].includes('Sales Record Number')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) { console.warn('  No header in ' + path.basename(filePath)); return []; }

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const f = parseCSVLine(line);
    const itemId = f[COL.ITEM_NUMBER]?.trim();
    const saleDate = parseEbayDate(f[COL.SALE_DATE]);
    if (!itemId || !saleDate) continue;

    const orderId = f[COL.ORDER_NUMBER]?.trim() || '';
    const txnId = f[COL.TRANSACTION_ID]?.trim() || '';
    // Build ebayOrderId matching YourDataManager format: orderId-itemId
    const ebayOrderId = orderId && txnId ? `${orderId}-${itemId}` : `csv-${itemId}-${txnId || saleDate}`;

    rows.push({
      ebayOrderId,
      ebayItemId: itemId,
      title: f[COL.ITEM_TITLE]?.trim() || null,
      sku: f[COL.CUSTOM_LABEL]?.trim() || null,
      quantity: parseInt(f[COL.QUANTITY]?.trim() || '1') || 1,
      salePrice: parsePrice(f[COL.SOLD_FOR]),
      soldDate: saleDate,
      buyerUsername: f[COL.BUYER_USERNAME]?.trim() || null,
      shippedDate: parseEbayDate(f[COL.SHIPPED_ON]) || null,
      store,
    });
  }
  return rows;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('DARKHAWK — Historical Sales Backfill\n');

  // Pre-count
  const { rows: [{ count: pre }] } = await client.query('SELECT COUNT(*) as count FROM "YourSale"');
  console.log('Before:', parseInt(pre).toLocaleString(), 'records\n');

  // Parse all CSVs
  const csvDir = 'C:\\DarkHawk\\csv-imports';
  let allRows = [];
  for (const { file, store } of CSV_FILES) {
    const fp = path.join(csvDir, file);
    if (!fs.existsSync(fp)) { console.log('  MISSING:', file); continue; }
    const rows = parseCSVFile(fp, store);
    console.log('  ' + file.substring(0, 40) + '...: ' + rows.length + ' rows (' + store + ')');
    allRows.push(...rows);
  }
  console.log('Total parsed:', allRows.length);

  // Dedup within CSVs
  const seen = new Set();
  const deduped = [];
  for (const r of allRows) {
    if (seen.has(r.ebayOrderId)) continue;
    seen.add(r.ebayOrderId);
    deduped.push(r);
  }
  console.log('After dedup:', deduped.length, '\n');

  // Insert
  let inserted = 0, skipped = 0, errors = 0;
  for (let i = 0; i < deduped.length; i++) {
    const r = deduped[i];
    try {
      const result = await client.query(`
        INSERT INTO "YourSale" (id, "ebayOrderId", "ebayItemId", title, sku, quantity, "salePrice", "soldDate", "buyerUsername", "shippedDate", "createdAt", "updatedAt", store)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)
        ON CONFLICT ("ebayOrderId") DO NOTHING
      `, [crypto.randomUUID(), r.ebayOrderId, r.ebayItemId, r.title, r.sku, r.quantity, r.salePrice, r.soldDate, r.buyerUsername, r.shippedDate, r.store]);
      if (result.rowCount > 0) inserted++; else skipped++;
    } catch (e) {
      errors++;
      if (errors <= 3) console.error('  Error:', e.message.substring(0, 100));
    }
    if ((i + 1) % 500 === 0) process.stdout.write('\r  Progress: ' + Math.round((i+1)/deduped.length*100) + '% (' + inserted + ' new, ' + skipped + ' dupes)');
  }

  const { rows: [{ count: post }] } = await client.query('SELECT COUNT(*) as count FROM "YourSale"');

  console.log('\n\n=== BACKFILL COMPLETE ===');
  console.log('Before:  ', parseInt(pre).toLocaleString());
  console.log('Inserted:', inserted.toLocaleString());
  console.log('Skipped: ', skipped.toLocaleString(), '(already existed)');
  console.log('Errors:  ', errors);
  console.log('After:   ', parseInt(post).toLocaleString());

  // Date coverage
  const { rows: monthly } = await client.query(`SELECT TO_CHAR("soldDate", 'YYYY-MM') as month, COUNT(*) as sales FROM "YourSale" GROUP BY 1 ORDER BY 1`);
  console.log('\nMonthly coverage:');
  monthly.forEach(m => console.log('  ' + m.month + ': ' + m.sales + ' sales'));

  await client.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
