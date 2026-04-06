#!/usr/bin/env node
'use strict';

/**
 * Restore vPIC SQL dump to Railway Postgres — streaming with COPY support.
 * Handles: psql meta-commands, dollar-quoting, COPY FROM stdin blocks.
 */

const fs = require('fs');
const readline = require('readline');
const { Client } = require('pg');
const { from: copyFrom } = require('pg-copy-streams');
const { Readable } = require('stream');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected.');

  // Drop existing vpic schema
  try {
    await client.query('DROP SCHEMA IF EXISTS vpic CASCADE');
    console.log('Dropped existing vpic schema.');
  } catch (e) { /* ignore */ }

  const rl = readline.createInterface({
    input: fs.createReadStream('vPICList_lite_2026_03.sql', 'utf8'),
    crlfDelay: Infinity,
  });

  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';
  let inCopy = false;
  let copyData = [];
  let copyStmt = '';
  let executed = 0;
  let errors = 0;
  let copies = 0;

  for await (const line of rl) {
    // Skip psql meta-commands
    if (line.startsWith('\\') && !inCopy) continue;

    // Handle COPY data blocks
    if (inCopy) {
      if (line === '\\.') {
        // End of COPY data — stream it
        try {
          const stream = client.query(copyFrom(copyStmt));
          const data = copyData.join('\n') + '\n';
          const readable = Readable.from([data]);
          await new Promise((resolve, reject) => {
            readable.pipe(stream).on('finish', resolve).on('error', reject);
          });
          copies++;
        } catch (e) {
          errors++;
          if (errors <= 3) console.log('COPY error: ' + e.message.substring(0, 120));
        }
        inCopy = false;
        copyData = [];
        copyStmt = '';
        continue;
      }
      copyData.push(line);
      continue;
    }

    // Check for COPY FROM stdin
    if (line.trim().startsWith('COPY ') && line.includes('FROM stdin')) {
      inCopy = true;
      copyStmt = line.trim();
      copyData = [];
      continue;
    }

    current += line + '\n';

    // Track dollar-quoting
    const dollarMatches = [...line.matchAll(/(\$[_a-zA-Z]*\$)/g)];
    for (const m of dollarMatches) {
      const tag = m[1];
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = tag;
      } else if (tag === dollarTag) {
        inDollarQuote = false;
        dollarTag = '';
      }
    }

    // Execute when we hit a semicolon outside dollar-quoting
    if (line.trimEnd().endsWith(';') && !inDollarQuote) {
      const stmt = current.trim();
      current = '';
      if (!stmt || stmt === ';') continue;

      try {
        await client.query(stmt);
        executed++;
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate key')) {
          errors++;
          if (errors <= 5) console.log('Error: ' + e.message.substring(0, 120));
        }
      }

      if ((executed + copies) % 200 === 0) {
        process.stdout.write('  ' + executed + ' stmts + ' + copies + ' copies...\r');
      }
    }
  }

  console.log('\nDone: ' + executed + ' statements, ' + copies + ' COPY blocks, ' + errors + ' errors');

  // Verify
  try {
    const cnt = await client.query('SELECT count(*) as cnt FROM vpic."Pattern"');
    console.log('Pattern rows: ' + cnt.rows[0].cnt);
  } catch (e) {
    console.log('Pattern check: ' + e.message.substring(0, 100));
  }

  // Test spVinDecode
  try {
    const test = await client.query("SELECT * FROM vpic.\"spVinDecode\"('1C4BJWDG3GL123456') LIMIT 10");
    console.log('spVinDecode test (' + test.rows.length + ' rows):');
    if (test.rows.length > 0) {
      console.log('Columns: ' + Object.keys(test.rows[0]).join(', '));
      for (const r of test.rows.slice(0, 5)) {
        const vals = Object.values(r).map(v => String(v || '').substring(0, 50));
        console.log('  ' + vals.join(' | '));
      }
    }
  } catch (e) {
    console.log('spVinDecode: ' + e.message.substring(0, 200));
    try {
      const funcs = await client.query("SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'vpic'");
      console.log('vpic functions: ' + funcs.rows.map(r => r.routine_name).join(', '));
    } catch (e2) {}
  }

  const sz = await client.query("SELECT pg_database_size('railway') / 1024 / 1024 as mb");
  console.log('DB size: ' + sz.rows[0].mb + ' MB');

  await client.end();
}

run().catch(e => { console.error('FATAL:', e.message.substring(0, 300)); process.exit(1); });
