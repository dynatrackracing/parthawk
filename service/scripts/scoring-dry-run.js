#!/usr/bin/env node
'use strict';

/**
 * Scoring dry-run V2: simulate new scoring on all existing scout_alerts.
 * Read-only. No DB writes. Fixed: no duplicate joins, per-type coverage stats,
 * outlier samples, tuning hints.
 *
 * Usage: DATABASE_URL=... node service/scripts/scoring-dry-run.js
 */

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const { parseYearRange: piParseYear, detectPartType } = require('../utils/partIntelligence');
const { isReliable, detectNamedEngine, NAMED_ENGINES, getCeiling } = require('../lib/decoderCapability');

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

// --- Inline scoring helpers (same as ScoutAlertService) ---
function extractDisplacement(s) {
  if (!s) return null;
  const m = s.match(/(\d+\.\d)\s*L/i);
  return m ? m[1] : null;
}
function _extractCylFromTitle(title) {
  if (!title) return null;
  const m = title.match(/\bV(\d{1,2})\b/i) || title.match(/\bI(\d)\b/) || title.match(/\b(\d)-?cyl/i) || title.match(/\b(\d)\s*cylinder/i);
  return m ? parseInt(m[1]) : null;
}
function _extractDriveFromTitle(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  if (/\b4WD\b|\b4X4\b/.test(t)) return '4WD';
  if (/\bAWD\b/.test(t)) return 'AWD';
  if (/\b2WD\b|\b4X2\b/.test(t)) return '2WD';
  if (/\bFWD\b/.test(t)) return 'FWD';
  if (/\bRWD\b/.test(t)) return 'RWD';
  return null;
}
function _extractPremiumAudio(title) {
  if (!title) return null;
  const m = title.match(/\b(Bose|B&O|Bang\s*&?\s*Olufsen|Alpine|JBL|Harman\s*Kardon|Mark\s*Levinson|Burmester|Meridian|Infinity|Beats)\b/i);
  return m ? m[1] : null;
}
function _extractDieselMarker(title) {
  if (!title) return false;
  return /\b(Diesel|TDI|Duramax|Cummins|Power\s*Stroke|PowerStroke|EcoDiesel)\b/i.test(title);
}

const PART_TYPE_SENSITIVITY = {
  ECM: ['engine'], PCM: ['engine'], THROTTLE: ['engine'],
  TCM: ['engine', 'drivetrain'], ABS: ['drivetrain'],
  AMP: ['trim'], RADIO: ['trim'], NAV: ['trim'],
  BCM: [], TIPM: [], CLUSTER: [], HEADLIGHT: [], TAILLIGHT: [],
};
const PN_EXACT_YEAR_TYPES = new Set(['ECM','PCM','ECU','BCM','TIPM','ABS','TCM','TCU','AMP','RADIO','CLUSTER','THROTTLE','FUSE','JUNCTION']);

function computeMatchScore(wantTitle, vd, partType) {
  const ENGINE_SENSITIVE_TYPES = new Set(['ECM', 'PCM', 'ECU', 'TCM', 'TCU', 'THROTTLE']);
  const reasons = [];
  let score = ENGINE_SENSITIVE_TYPES.has(partType) ? 55 : 50;
  reasons.push(ENGINE_SENSITIVE_TYPES.has(partType) ? 'YMM match (eng-sens): +55' : 'YMM match: +50');
  const sensitivity = partType ? (PART_TYPE_SENSITIVITY[partType] || []) : [];
  const vMake = (vd.make || '').toUpperCase();

  if (PN_EXACT_YEAR_TYPES.has(partType)) {
    const yr = piParseYear(wantTitle);
    const vYear = parseInt(vd.year) || 0;
    if (yr && vYear) {
      const span = yr.end - yr.start;
      if (span === 0 && vYear === yr.start) { score += 10; reasons.push('Year exact: +10'); }
      else if (span <= 1) { score += 5; reasons.push('Year tight: +5'); }
      else if (span >= 4) { score -= 5; reasons.push('Year broad: -5'); }
    }
  }

  let engineMatchFired = false, engineMismatchFired = false, noEngineSignal = true;
  if (sensitivity.includes('engine')) {
    const titleCyl = _extractCylFromTitle(wantTitle);
    const namedEng = detectNamedEngine(wantTitle);
    const titleDisp = extractDisplacement(wantTitle);
    const vCyl = vd.decoded_cylinders ? parseInt(vd.decoded_cylinders) : null;
    const vDisp = extractDisplacement(vd.decoded_engine || vd.engine || '');

    if (titleCyl && vCyl) {
      noEngineSignal = false;
      if (titleCyl === vCyl) { score += 25; reasons.push('Cyl match V' + vCyl + ': +25'); engineMatchFired = true; }
      else { score -= 50; reasons.push('Cyl mismatch V' + titleCyl + ' vs V' + vCyl + ': -50'); engineMismatchFired = true; }
    }
    if (namedEng) {
      noEngineSignal = false;
      const eng = NAMED_ENGINES[namedEng] || NAMED_ENGINES[namedEng.replace(/\s+/g, '')];
      if (eng) {
        if (eng.makes.includes(vMake) && vDisp && eng.displacements.some(d => Math.abs(d - parseFloat(vDisp)) < 0.25)) {
          score += 30; reasons.push(namedEng + ' match: +30'); engineMatchFired = true;
        } else if (!eng.makes.includes(vMake)) {
          score -= 60; reasons.push(namedEng + ' wrong make: -60'); engineMismatchFired = true;
        } else { score -= 30; reasons.push(namedEng + ' disp mismatch: -30'); engineMismatchFired = true; }
      }
    }
    if (!namedEng && titleDisp && vDisp) {
      noEngineSignal = false;
      if (Math.abs(parseFloat(titleDisp) - parseFloat(vDisp)) < 0.25) { score += 25; reasons.push('Disp match ' + vDisp + 'L: +25'); engineMatchFired = true; }
      else { score -= 50; reasons.push('Disp mismatch ' + titleDisp + 'L vs ' + vDisp + 'L: -50'); engineMismatchFired = true; }
    } else if (!namedEng && titleDisp && !vDisp) { score -= 10; reasons.push('Engine unknown: -10'); noEngineSignal = false; }
  }

  if (_extractDieselMarker(wantTitle)) {
    if (vd.diesel === true) { score += 35; reasons.push('Diesel match: +35'); }
    else if (vd.diesel === false) { score -= 80; reasons.push('Gas vehicle diesel part: -80'); }
    else { score -= 20; reasons.push('Diesel unknown: -20'); }
  }

  let dtMatch = false, dtMismatch = false, dtSkipped = false;
  if (sensitivity.includes('drivetrain')) {
    score += 10; reasons.push('ABS base: +10');
    const titleDrive = _extractDriveFromTitle(wantTitle);
    if (titleDrive) {
      const vDrive = (vd.decoded_drivetrain || vd.drivetrain || '').toUpperCase();
      if (vDrive) {
        const v4 = /4WD|4X4|AWD/.test(vDrive), p4 = titleDrive === '4WD' || titleDrive === 'AWD';
        if ((p4 && v4) || (!p4 && !v4)) { score += 25; reasons.push('DT match: +25'); dtMatch = true; }
        else { score -= 50; reasons.push('DT mismatch: -50'); dtMismatch = true; }
      } else {
        if (isReliable(vMake, 'drivetrain')) { score -= 15; reasons.push('DT unknown: -15'); }
        else { reasons.push('DT not encoded ' + vMake + ': 0'); dtSkipped = true; }
      }
    }
  }

  if (sensitivity.includes('trim')) {
    const brand = _extractPremiumAudio(wantTitle);
    if (brand) {
      const vTier = (vd.trim_tier || '').toUpperCase();
      if (vTier === 'PREMIUM') { score += 30; reasons.push('Premium trim: +30'); }
      else if (vTier === 'PERFORMANCE') { score += 25; reasons.push('Perf trim: +25'); }
      else if (vTier === 'BASE') { score -= 40; reasons.push('Base trim: -40'); }
      else if (isReliable(vMake, 'trim')) { score -= 10; reasons.push('Trim unknown: -10'); }
    }
  }

  const hasPremiumBrand = !!_extractPremiumAudio(wantTitle);
  const ceiling = getCeiling(partType, hasPremiumBrand);
  if (score > ceiling) { score = ceiling; reasons.push('Ceiling ' + ceiling); }
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, reasons, ceiling, engineMatchFired, engineMismatchFired, noEngineSignal, dtMatch, dtMismatch, dtSkipped };
}

async function main() {
  console.log('Scoring Dry-Run V2');
  console.log('Time:', new Date().toISOString());
  const start = Date.now();

  // Load ALL alerts
  const allAlerts = await knex('scout_alerts').select('*');
  console.log('Total alerts:', allAlerts.length);

  // For each alert, resolve ONE yard_vehicle row by YMM+yard
  // Use a pre-built index to avoid N+1 queries
  const vehicles = await knex('yard_vehicle as yv')
    .join('yard as y', 'y.id', 'yv.yard_id')
    .where('yv.active', true)
    .select('yv.year', 'yv.make', 'yv.model', 'y.name as yard_name',
      'yv.decoded_engine', 'yv.decoded_cylinders', 'yv.decoded_drivetrain',
      'yv.decoded_transmission', 'yv.trim_tier', 'yv.decoded_trim', 'yv.trim_level',
      'yv.engine', 'yv.drivetrain', 'yv.diesel', 'yv.engine_type');

  // Index: year|make|model|yard -> first vehicle data
  const vIndex = {};
  for (const v of vehicles) {
    const key = [v.year, (v.make||'').toLowerCase(), (v.model||'').toLowerCase(), (v.yard_name||'').toLowerCase()].join('|');
    if (!vIndex[key]) vIndex[key] = v; // first match only
  }
  console.log('Vehicle index entries:', Object.keys(vIndex).length);

  // --- STEP 2: Per-part-type title coverage stats ---
  console.log('\n=== PER-PART-TYPE TITLE SIGNAL COVERAGE ===');
  const typeCoverage = {};
  for (const a of allAlerts) {
    const pt = detectPartType(a.source_title) || 'OTHER';
    if (!typeCoverage[pt]) typeCoverage[pt] = { total:0, cyl:0, named:0, disp:0, dt:0, diesel:0, audio:0 };
    typeCoverage[pt].total++;
    if (_extractCylFromTitle(a.source_title)) typeCoverage[pt].cyl++;
    if (detectNamedEngine(a.source_title)) typeCoverage[pt].named++;
    if (extractDisplacement(a.source_title)) typeCoverage[pt].disp++;
    if (_extractDriveFromTitle(a.source_title)) typeCoverage[pt].dt++;
    if (_extractDieselMarker(a.source_title)) typeCoverage[pt].diesel++;
    if (_extractPremiumAudio(a.source_title)) typeCoverage[pt].audio++;
  }
  console.log('Type'.padEnd(12)+'N'.padEnd(6)+'Cyl%'.padEnd(6)+'Named%'.padEnd(7)+'Disp%'.padEnd(6)+'DT%'.padEnd(5)+'Dies%'.padEnd(6)+'Audio%');
  for (const [pt, c] of Object.entries(typeCoverage).sort((a,b) => b[1].total - a[1].total).slice(0, 15)) {
    const n = c.total;
    console.log(pt.padEnd(12)+String(n).padEnd(6)+String(Math.round(c.cyl/n*100)).padEnd(6)+String(Math.round(c.named/n*100)).padEnd(7)+String(Math.round(c.disp/n*100)).padEnd(6)+String(Math.round(c.dt/n*100)).padEnd(5)+String(Math.round(c.diesel/n*100)).padEnd(6)+Math.round(c.audio/n*100));
  }

  // --- Score all alerts ---
  const histogram = {};
  for (let b = 0; b <= 100; b += 5) histogram[b] = 0;
  const bySource = {}, byPT = {};
  let hardGated = 0, orphaned = 0, scored = 0;
  let oldHighNewLow = 0, oldLowNewHigh = 0;
  let engMatch = 0, engMismatch = 0, engNoSignal = 0;
  let dtMatchC = 0, dtMismatchC = 0, dtSkippedC = 0;
  const allResults = [];

  for (const a of allAlerts) {
    const yr = piParseYear(a.source_title);
    if (!yr) { hardGated++; continue; }

    const key = [a.vehicle_year, (a.vehicle_make||'').toLowerCase(), (a.vehicle_model||'').toLowerCase(), (a.yard_name||'').toLowerCase()].join('|');
    const vd = vIndex[key];
    if (!vd) { orphaned++; continue; }

    const pt = detectPartType(a.source_title) || 'OTHER';
    const result = computeMatchScore(a.source_title, vd, pt);
    scored++;

    const bucket = Math.floor(result.score / 5) * 5;
    histogram[bucket] = (histogram[bucket] || 0) + 1;

    if (!bySource[a.source]) bySource[a.source] = { scores: [] };
    bySource[a.source].scores.push(result.score);
    if (!byPT[pt]) byPT[pt] = { scores: [] };
    byPT[pt].scores.push(result.score);

    if (a.confidence === 'high' && result.score < 55) oldHighNewLow++;
    if (a.confidence === 'low' && result.score >= 75) oldLowNewHigh++;

    if (result.engineMatchFired) engMatch++;
    if (result.engineMismatchFired) engMismatch++;
    if (result.noEngineSignal && (PART_TYPE_SENSITIVITY[pt] || []).includes('engine')) engNoSignal++;
    if (result.dtMatch) dtMatchC++;
    if (result.dtMismatch) dtMismatchC++;
    if (result.dtSkipped) dtSkippedC++;

    allResults.push({ ...result, id: a.id, source: a.source, pt, oldConf: a.confidence,
      title: a.source_title, vehicle: a.vehicle_year + ' ' + a.vehicle_make + ' ' + a.vehicle_model,
      vEngine: vd.decoded_engine, vCyl: vd.decoded_cylinders, vTier: vd.trim_tier, vDT: vd.decoded_drivetrain });
  }

  console.log('\n=== COUNTS ===');
  console.log('Total alerts:', allAlerts.length, ' Scored:', scored, ' Hard-gated:', hardGated, ' Orphaned:', orphaned);
  console.assert(scored === allAlerts.length - hardGated - orphaned, 'COUNT MISMATCH');

  console.log('\n=== HISTOGRAM ===');
  for (let b = 0; b <= 100; b += 5) {
    const c = histogram[b] || 0;
    if (c > 0) console.log(String(b).padStart(3)+'-'+String(b+4).padStart(3)+': '+String(c).padStart(5)+' '+'#'.repeat(Math.min(Math.round(c/10),60)));
  }

  console.log('\n=== BY SOURCE ===');
  for (const [src, d] of Object.entries(bySource)) {
    const avg = Math.round(d.scores.reduce((a,b)=>a+b,0)/d.scores.length);
    console.log(src.padEnd(18)+'n='+String(d.scores.length).padEnd(6)+'avg='+avg);
  }

  console.log('\n=== BY PART TYPE ===');
  for (const [pt, d] of Object.entries(byPT).sort((a,b)=>b[1].scores.length-a[1].scores.length).slice(0,12)) {
    const avg = Math.round(d.scores.reduce((a,b)=>a+b,0)/d.scores.length);
    console.log(pt.padEnd(12)+'n='+String(d.scores.length).padEnd(6)+'avg='+avg);
  }

  console.log('\n=== CONFIDENCE SHIFT ===');
  console.log('Old HIGH now <55:', oldHighNewLow);
  console.log('Old LOW now 75+:', oldLowNewHigh);

  console.log('\n=== SURVIVAL ===');
  for (const thresh of [55, 60, 65, 70]) {
    let s = 0; for (let b = thresh; b <= 100; b += 5) s += (histogram[b]||0);
    console.log('Threshold '+thresh+': '+s+'/'+scored+' ('+Math.round(s/scored*100)+'%)');
  }

  // --- STEP 3: Outlier samples ---
  allResults.sort((a,b) => b.score - a.score);
  function printSample(label, items) {
    console.log('\n--- ' + label + ' ---');
    for (const r of items.slice(0,10)) {
      console.log('  #'+r.id+' ['+r.source+'] '+r.pt+' score='+r.score+' ceil='+r.ceiling+' old='+r.oldConf);
      console.log('    title: '+(r.title||'').substring(0,80));
      console.log('    vehicle: '+r.vehicle+' eng='+r.vEngine+' cyl='+r.vCyl+' tier='+r.vTier+' dt='+r.vDT);
      console.log('    reasons: '+r.reasons.join(' | '));
    }
  }
  printSample('TOP 10 HIGHEST', allResults.slice(0,10));
  printSample('BOTTOM 10 LOWEST', allResults.slice(-10).reverse());
  const ecmMid = allResults.filter(r => ['ECM','PCM','ECU','THROTTLE'].includes(r.pt) && r.score >= 40 && r.score <= 60);
  printSample('ECM/THROTTLE 40-60 range', ecmMid);
  const absSample = allResults.filter(r => r.pt === 'ABS');
  printSample('ABS alerts', absSample);
  const audioSample = allResults.filter(r => ['AMP','RADIO','NAV'].includes(r.pt));
  printSample('AUDIO alerts', audioSample);
  const univMid = allResults.filter(r => ['BCM','TIPM','CLUSTER','FUSE','HEADLIGHT','TAILLIGHT'].includes(r.pt) && r.score >= 50 && r.score <= 60);
  printSample('UNIVERSAL 50-60', univMid);

  // --- STEP 4: Tuning hints ---
  console.log('\n=== TUNING HINTS ===');
  console.log('\nEngine path fire rates (engine-sensitive parts only):');
  console.log('  Match fired (+25/+30): ' + engMatch);
  console.log('  Mismatch fired (-50/-60): ' + engMismatch);
  console.log('  No engine signal in title: ' + engNoSignal);

  console.log('\nDrivetrain path fire rates:');
  console.log('  Match: ' + dtMatchC + ' Mismatch: ' + dtMismatchC + ' Skipped (unreliable make): ' + dtSkippedC);

  console.log('\nPer-type "what if baseline were higher":');
  for (const [pt, d] of Object.entries(byPT).sort((a,b)=>b[1].scores.length-a[1].scores.length).slice(0,8)) {
    const avg = d.scores.reduce((a,b)=>a+b,0)/d.scores.length;
    if (avg < 55) {
      const avg10 = avg + 10, avg20 = avg + 20;
      console.log('  ' + pt.padEnd(12) + 'avg=' + Math.round(avg) + ' +10->' + Math.round(avg10) + (avg10>=55?' (above 55)':' (still below)') + ' +20->' + Math.round(avg20) + (avg20>=55?' (above 55)':' (still below)'));
    }
  }

  const elapsed = Date.now() - start;
  console.log('\n=== TIMING ===');
  console.log('Total: ' + elapsed + 'ms, per alert: ' + (elapsed / allAlerts.length).toFixed(2) + 'ms');
  console.log('\nDone. Review output before proceeding to rescore.');
  await knex.destroy();
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
