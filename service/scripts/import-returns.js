'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { database } = require('../database/database');
const { Model } = require('objection');

Model.knex(database);

const PART_TYPE_RULES = [
  { type: 'ECM', patterns: [/\bECM\b/, /\bPCM\b/, /ENGINE\s*CONTROL/, /ENGINE\s*COMPUTER/, /ENGINE\s*MODULE/] },
  { type: 'ABS', patterns: [/\bABS\b/, /BRAKE\s*PUMP/, /BRAKE\s*MODULE/, /ANTI[\s-]*LOCK/] },
  { type: 'TCM', patterns: [/\bTCM\b/, /\bTCU\b/, /TRANSMISSION\s*CONTROL/, /TRANSMISSION\s*MODULE/] },
  { type: 'BCM', patterns: [/\bBCM\b/, /BODY\s*CONTROL/] },
  { type: 'TIPM', patterns: [/\bTIPM\b/, /TOTALLY\s*INTEGRATED/, /\bFUSE\s*BOX\b/, /FUSE\s*RELAY/, /JUNCTION\s*BOX/] },
  { type: 'Radio', patterns: [/\bRADIO\b/, /\bCD\s*PLAYER\b/, /\bRECEIVER\b/, /\bHEAD\s*UNIT\b/, /\bSTEREO\b/, /\bUCONNECT\b/, /\bSYNC\b/] },
  { type: 'Amplifier', patterns: [/\bAMPLIFIER\b/, /\bAMP\s/] },
  { type: 'Cluster', patterns: [/\bCLUSTER\b/, /\bSPEEDOMETER\b/, /\bINSTRUMENT\b/] },
  { type: 'Steering Module', patterns: [/STEERING\s*MODULE/, /POWER\s*STEERING/, /\bEPS\s*MODULE\b/] },
  { type: 'HVAC Module', patterns: [/\bHVAC\b/, /CLIMATE\s*CONTROL/, /A\/?C\s*CONTROL/] },
  { type: 'Camera', patterns: [/\bCAMERA\b/, /BACKUP\s*CAM/] },
  { type: 'Airbag Module', patterns: [/AIRBAG\s*MODULE/, /\bSRS\s*MODULE\b/, /\bRESTRAINT\b/] },
  { type: 'Blind Spot', patterns: [/BLIND\s*SPOT/] },
  { type: 'Parking Sensor', patterns: [/PARKING\s*SENSOR/, /PARK\s*ASSIST/] },
  { type: 'Liftgate Module', patterns: [/LIFTGATE\s*MODULE/, /TAILGATE\s*MODULE/] },
  { type: 'Throttle Body', patterns: [/THROTTLE\s*BODY/] },
  { type: 'Third Brake Light', patterns: [/THIRD\s*BRAKE/, /3RD\s*BRAKE/] },
  { type: 'Transfer Case', patterns: [/TRANSFER\s*CASE/] },
  { type: 'Mirror', patterns: [/\bMIRROR\b/] },
  { type: 'Headlight', patterns: [/HEADLIGHT/, /HEAD\s*LIGHT/, /HEADLAMP/] },
  { type: 'Tail Light', patterns: [/TAIL\s*LIGHT/, /TAILLIGHT/, /TAIL\s*LAMP/] },
  { type: 'Door Lock', patterns: [/DOOR\s*LOCK/, /\bLATCH\b/] },
  { type: 'Window Motor', patterns: [/WINDOW\s*MOTOR/, /WINDOW\s*REG/] },
  { type: 'Blower Motor', patterns: [/BLOWER\s*MOTOR/] },
  { type: 'Wiper Motor', patterns: [/WIPER\s*MOTOR/] },
  { type: 'Sensor', patterns: [/\bSENSOR\b/] },
  { type: 'Key Fob', patterns: [/KEY\s*FOB/, /\bREMOTE\b/, /SMART\s*KEY/] },
];

const MAKE_PATTERNS = [
  { make: 'FORD', pattern: /\bFORD\b/ },
  { make: 'DODGE', pattern: /\bDODGE\b/ },
  { make: 'CHRYSLER', pattern: /\bCHRYSLER\b/ },
  { make: 'JEEP', pattern: /\bJEEP\b/ },
  { make: 'RAM', pattern: /\bRAM\b/ },
  { make: 'TOYOTA', pattern: /\bTOYOTA\b/ },
  { make: 'HONDA', pattern: /\bHONDA\b/ },
  { make: 'NISSAN', pattern: /\bNISSAN\b/ },
  { make: 'HYUNDAI', pattern: /\bHYUNDAI\b/ },
  { make: 'KIA', pattern: /\bKIA\b/ },
  { make: 'VOLKSWAGEN', pattern: /\b(?:VOLKSWAGEN|VW)\b/ },
  { make: 'BMW', pattern: /\bBMW\b/ },
  { make: 'MERCEDES', pattern: /\bMERCEDES\b/ },
  { make: 'AUDI', pattern: /\bAUDI\b/ },
  { make: 'SUBARU', pattern: /\bSUBARU\b/ },
  { make: 'MAZDA', pattern: /\bMAZDA\b/ },
  { make: 'CHEVROLET', pattern: /\b(?:CHEVROLET|CHEVY)\b/ },
  { make: 'GMC', pattern: /\bGMC\b/ },
  { make: 'BUICK', pattern: /\bBUICK\b/ },
  { make: 'CADILLAC', pattern: /\bCADILLAC\b/ },
  { make: 'LINCOLN', pattern: /\bLINCOLN\b/ },
  { make: 'ACURA', pattern: /\bACURA\b/ },
  { make: 'LEXUS', pattern: /\bLEXUS\b/ },
  { make: 'INFINITI', pattern: /\bINFINITI\b/ },
  { make: 'MITSUBISHI', pattern: /\bMITSUBISHI\b/ },
  { make: 'VOLVO', pattern: /\bVOLVO\b/ },
];

function detectPartType(title) {
  const upper = (title || '').toUpperCase();
  for (const rule of PART_TYPE_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(upper)) return rule.type;
    }
  }
  return 'Other';
}

function detectMake(title) {
  const upper = (title || '').toUpperCase();
  for (const { make, pattern } of MAKE_PATTERNS) {
    if (pattern.test(upper)) return make;
  }
  return 'Other';
}

function parseMoney(val) {
  const s = String(val || '').replace(/[$,"\s]/g, '').trim();
  if (!s || s === '--') return 0;
  return parseFloat(s) || 0;
}

function parseDate(val) {
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

async function run() {
  const dataDir = path.join(__dirname, '..', 'data');

  if (!fs.existsSync(dataDir)) {
    console.error('service/data/ directory does not exist. Create it and add the Transaction CSV files.');
    process.exit(1);
  }

  const csvFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('Transaction') && f.endsWith('.csv'));

  if (csvFiles.length === 0) {
    console.error('No Transaction CSV files found in service/data/');
    console.error('Copy the 4 files named TransactionMar28202618_*.csv into service/data/');
    process.exit(1);
  }

  console.log(`Found ${csvFiles.length} CSV files`);

  const existing = await database('return_transaction').count('* as cnt').first();
  console.log(`Existing rows in return_transaction: ${existing.cnt}`);

  let totalImported = 0;
  let totalSkipped = 0;

  for (const file of csvFiles) {
    const filePath = path.join(dataDir, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n');

    const headerIdx = lines.findIndex(l => l.includes('"Transaction creation date"'));
    if (headerIdx === -1) {
      console.log(`  Skipping ${file} - no header found`);
      continue;
    }

    const csvText = lines.slice(headerIdx).join('\n');
    let records;
    try {
      records = parse(csvText, { columns: true, skip_empty_lines: true, relax_column_count: true });
    } catch (e) {
      console.error(`  Error parsing ${file}: ${e.message}`);
      continue;
    }

    const refunds = records.filter(r => r['Type'] === 'Refund');
    console.log(`  ${file}: ${refunds.length} refunds found`);

    const batch = [];
    for (const r of refunds) {
      const txDate = parseDate(r['Transaction creation date']);
      if (!txDate) continue;

      const title = r['Item title'] && r['Item title'] !== '--' ? r['Item title'] : null;
      if (!title) { totalSkipped++; continue; }

      const grossAmount = parseMoney(r['Gross transaction amount']);
      const inadFee = parseMoney(r['Very high "item not as described" fee']);
      const referenceId = r['Reference ID'] && r['Reference ID'] !== '--' ? r['Reference ID'] : null;

      batch.push({
        transaction_date: txDate,
        order_number: r['Order number'] !== '--' ? r['Order number'] : null,
        legacy_order_id: r['Legacy order ID'] !== '--' ? r['Legacy order ID'] : null,
        buyer_username: r['Buyer username'] !== '--' ? r['Buyer username'] : null,
        buyer_name: r['Buyer name'] !== '--' ? r['Buyer name'] : null,
        ship_city: r['Ship to city'] !== '--' ? r['Ship to city'] : null,
        ship_state: r['Ship to province/region/state'] !== '--' ? r['Ship to province/region/state'] : null,
        ship_zip: r['Ship to zip'] !== '--' ? r['Ship to zip'] : null,
        ship_country: r['Ship to country'] !== '--' ? r['Ship to country'] : null,
        net_amount: parseMoney(r['Net amount']),
        gross_amount: grossAmount,
        ebay_item_id: r['Item ID'] !== '--' ? r['Item ID'] : null,
        transaction_id: r['Transaction ID'] !== '--' ? r['Transaction ID'] : null,
        item_title: title,
        custom_label: r['Custom label'] !== '--' ? r['Custom label'] : null,
        item_subtotal: parseMoney(r['Item subtotal']),
        shipping_handling: parseMoney(r['Shipping and handling']),
        fvf_fixed: parseMoney(r['Final Value Fee - fixed']),
        fvf_variable: parseMoney(r['Final Value Fee - variable']),
        regulatory_fee: parseMoney(r['Regulatory operating fee']),
        inad_fee: inadFee,
        international_fee: parseMoney(r['International fee']),
        reference_id: referenceId,
        payout_id: r['Payout ID'] !== '--' ? r['Payout ID'] : null,
        part_type: detectPartType(title),
        make: detectMake(title),
        is_formal_return: referenceId ? /Return ID/i.test(referenceId) : false,
        has_inad_fee: Math.abs(inadFee) > 0,
        abs_gross: Math.abs(grossAmount),
      });
    }

    // Dedupe by order_number if table already has data
    let toInsert = batch;
    if (parseInt(existing.cnt) > 0 && batch.length > 0) {
      const orderNums = batch.filter(b => b.order_number).map(b => b.order_number);
      if (orderNums.length > 0) {
        // Check in chunks of 500 to avoid query limit
        const existingSet = new Set();
        for (let i = 0; i < orderNums.length; i += 500) {
          const chunk = orderNums.slice(i, i + 500);
          const found = await database('return_transaction')
            .select('order_number')
            .whereIn('order_number', chunk);
          found.forEach(f => existingSet.add(f.order_number));
        }
        toInsert = batch.filter(b => !b.order_number || !existingSet.has(b.order_number));
        console.log(`  Deduped: ${batch.length - toInsert.length} already exist, inserting ${toInsert.length}`);
      }
    }

    // Batch insert in chunks of 200
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      await database('return_transaction').insert(chunk);
    }
    totalImported += toInsert.length;
  }

  console.log(`\nDone. Imported: ${totalImported}, Skipped (no title): ${totalSkipped}`);

  const finalCount = await database('return_transaction').count('* as cnt').first();
  console.log(`Total rows in return_transaction: ${finalCount.cnt}`);

  process.exit(0);
}

run().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
