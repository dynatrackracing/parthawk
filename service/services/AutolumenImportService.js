'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const csv = require('csv-parse/sync');

const STORE = 'autolumen';

class AutolumenImportService {
  constructor() {
    this.log = log.child({ class: 'AutolumenImportService' }, true);
  }

  async importActiveListings(csvText) {
    const records = this.parseCSV(csvText);
    if (!records.length) throw new Error('No valid records found in CSV');

    const mapped = records.map(row => {
      const itemId = this.col(row, ['Item ID', 'Item Number', 'ItemID']);
      const title = this.col(row, ['Title', 'Item Title']);
      const sku = this.col(row, ['Custom Label', 'Custom label', 'SKU']);
      const price = this.parsePrice(this.col(row, ['Current Price', 'Price', 'Start Price', 'Sold For']));
      const qty = parseInt(this.col(row, ['Available Quantity', 'Quantity Available', 'Quantity'])) || 1;
      const startDate = this.parseDate(this.col(row, ['Start Date', 'Start Time', 'Sale Date']));

      if (!itemId && !title) return null;

      return {
        ebayItemId: itemId || `autolumen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title || '',
        sku: sku || null,
        currentPrice: price,
        quantityAvailable: qty,
        listingStatus: 'Active',
        startTime: startDate,
        store: STORE,
        syncedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }).filter(Boolean);

    if (!mapped.length) throw new Error('No valid listings parsed from CSV');

    const trx = await database.transaction();
    try {
      const deactivated = await trx('YourListing')
        .where('store', STORE)
        .where('listingStatus', 'Active')
        .update({ listingStatus: 'Ended', updatedAt: new Date() });

      let inserted = 0;
      for (const record of mapped) {
        await trx('YourListing')
          .insert(record)
          .onConflict('ebayItemId')
          .merge({
            title: record.title, sku: record.sku,
            currentPrice: record.currentPrice,
            quantityAvailable: record.quantityAvailable,
            listingStatus: 'Active', store: STORE,
            syncedAt: new Date(), updatedAt: new Date(),
          });
        inserted++;
      }

      await trx.commit();
      this.log.info({ deactivated, inserted, total: mapped.length }, 'Autolumen active listings imported');
      return { success: true, deactivated, inserted, total: mapped.length };
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }

  async importSalesHistory(csvText) {
    const records = this.parseCSV(csvText);
    if (!records.length) throw new Error('No valid records found in CSV');

    let synced = 0, skipped = 0, errors = 0;

    for (const row of records) {
      try {
        const orderId = this.col(row, ['Order Number', 'Order number']);
        const itemId = this.col(row, ['Item Number', 'Item ID', 'ItemID']);
        const title = this.col(row, ['Item Title', 'Title']);
        const sku = this.col(row, ['Custom Label', 'Custom label', 'SKU']);
        const qty = parseInt(this.col(row, ['Quantity'])) || 1;
        const price = this.parsePrice(this.col(row, ['Sold For', 'Item subtotal', 'Total Price']));
        const saleDate = this.parseDate(this.col(row, ['Sale Date', 'Paid On Date', 'Transaction creation date']));
        const buyer = this.col(row, ['Buyer Username', 'Buyer username']);
        const transactionId = this.col(row, ['Transaction ID']);
        const tracking = this.col(row, ['Tracking Number']);

        if (!orderId && !itemId) { skipped++; continue; }
        if (!title || title.length < 3) { skipped++; continue; }
        if (!price || price <= 0) { skipped++; continue; }

        const ebayOrderId = orderId || `autolumen-sale-${itemId}-${saleDate?.toISOString()?.slice(0, 10) || 'unknown'}`;

        await database('YourSale')
          .insert({
            ebayOrderId, ebayItemId: itemId || null, title, sku: sku || null,
            salePrice: price, quantity: qty, soldDate: saleDate || new Date(),
            buyerUsername: buyer || null, transactionId: transactionId || null,
            trackingNumber: tracking || null, store: STORE,
            createdAt: new Date(), updatedAt: new Date(),
          })
          .onConflict('ebayOrderId')
          .merge({ title, sku: sku || null, salePrice: price, store: STORE, updatedAt: new Date() });

        synced++;
      } catch (err) {
        errors++;
        if (errors <= 5) this.log.warn({ err: err.message }, 'Sale import row failed');
      }
    }

    this.log.info({ synced, skipped, errors }, 'Autolumen sales history imported');
    return { success: true, synced, skipped, errors };
  }

  async importTransactions(csvText) {
    const records = this.parseCSV(csvText);
    if (!records.length) throw new Error('No valid records found in CSV');

    let synced = 0, skipped = 0, errors = 0;

    for (const row of records) {
      try {
        const type = this.col(row, ['Type']);
        if (type && type.toLowerCase() !== 'order') { skipped++; continue; }

        const orderId = this.col(row, ['Order number', 'Order Number', 'Legacy order ID']);
        const itemId = this.col(row, ['Item ID']);
        const title = this.col(row, ['Item title', 'Item Title']);
        const sku = this.col(row, ['Custom label', 'Custom Label']);
        const qty = parseInt(this.col(row, ['Quantity'])) || 1;
        const price = this.parsePrice(this.col(row, ['Item subtotal', 'Gross transaction amount']));
        const saleDate = this.parseDate(this.col(row, ['Transaction creation date']));
        const buyer = this.col(row, ['Buyer username', 'Buyer Username']);
        const transactionId = this.col(row, ['Transaction ID']);

        if (!title || title.length < 3) { skipped++; continue; }
        if (!price || price <= 0) { skipped++; continue; }

        const ebayOrderId = orderId || `autolumen-txn-${itemId || ''}-${saleDate?.toISOString()?.slice(0, 10) || Date.now()}`;

        await database('YourSale')
          .insert({
            ebayOrderId, ebayItemId: itemId || null, title, sku: sku || null,
            salePrice: price, quantity: qty, soldDate: saleDate || new Date(),
            buyerUsername: buyer || null, transactionId: transactionId || null,
            store: STORE, createdAt: new Date(), updatedAt: new Date(),
          })
          .onConflict('ebayOrderId')
          .merge({ title, sku: sku || null, salePrice: price, store: STORE, updatedAt: new Date() });

        synced++;
      } catch (err) {
        errors++;
        if (errors <= 5) this.log.warn({ err: err.message }, 'Transaction import row failed');
      }
    }

    this.log.info({ synced, skipped, errors }, 'Autolumen transactions imported');
    return { success: true, synced, skipped, errors };
  }

  async getStats() {
    const [listings, sales] = await Promise.all([
      database('YourListing').where('store', STORE).where('listingStatus', 'Active').count('* as count').first(),
      database('YourSale').where('store', STORE).count('* as count').first(),
    ]);
    const recentSales = await database('YourSale')
      .where('store', STORE)
      .where('soldDate', '>=', database.raw("NOW() - INTERVAL '90 days'"))
      .count('* as count').sum('salePrice as revenue').first();
    const lastImport = await database('YourListing')
      .where('store', STORE).max('syncedAt as last_synced').first();

    return {
      activeListings: parseInt(listings?.count || 0),
      totalSales: parseInt(sales?.count || 0),
      sales90d: parseInt(recentSales?.count || 0),
      revenue90d: Math.round(parseFloat(recentSales?.revenue || 0) * 100) / 100,
      lastImport: lastImport?.last_synced || null,
    };
  }

  // ── CSV Parsing Helpers ──

  parseCSV(text) {
    let clean = text.replace(/^\uFEFF/, '');
    const lines = clean.split('\n');
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      if (/Item|Title|Order|Transaction/i.test(lines[i]) && lines[i].includes(',')) {
        headerIdx = i; break;
      }
    }
    if (headerIdx === -1) throw new Error('Could not find header row in CSV');
    clean = lines.slice(headerIdx).join('\n');
    try {
      return csv.parse(clean, {
        columns: true, skip_empty_lines: true, relax_column_count: true,
        trim: true, skip_records_with_error: true,
      });
    } catch (err) { throw new Error(`CSV parse failed: ${err.message}`); }
  }

  col(row, names) {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== '' && row[name] !== '--') return row[name].trim();
      const lower = name.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lower && row[key] !== '' && row[key] !== '--') return row[key].trim();
      }
    }
    return null;
  }

  parsePrice(val) {
    if (!val) return null;
    const num = parseFloat(val.replace(/[$,]/g, '').trim());
    return isNaN(num) ? null : Math.abs(num);
  }

  parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    const match = val.match(/^(\w{3})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = parseInt(match[3]) + (parseInt(match[3]) < 50 ? 2000 : 1900);
      const d2 = new Date(`${match[1]} ${match[2]}, ${year}`);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }
}

module.exports = AutolumenImportService;
