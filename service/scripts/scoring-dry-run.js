#!/usr/bin/env node
'use strict';

/**
 * Scoring dry-run: simulate new scoring on all existing scout_alerts.
 * Read-only. No DB writes.
 *
 * Usage: DATABASE_URL=... node service/scripts/scoring-dry-run.js
 */

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

// We need to load the scoring function. Since computeMatchScore is not exported,
// we'll require the module which loads it, then re-implement the scoring call inline
// using the same logic that generateAlerts uses.
const { parseTitle, loadModelsFromDB } = require('../utils/partMatcher');
const { parseYearRange: piParseYear, detectPartType } = require('../utils/partIntelligence');

// Load computeMatchScore helpers directly
const { isReliable, detectNamedEngine, NAMED_ENGINES, getCeiling, PART_TYPE_CEILINGS } = require('../lib/decoderCapability');

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

// Inline the scoring helpers (same as ScoutAlertService but standalone)
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
  TCM: ['engine', 'drivetrain'],
  ABS: ['drivetrain'],
  AMP: ['trim'], RADIO: ['trim'], NAV: ['trim'],
  BCM: [], TIPM: [], CLUSTER: [], HEADLIGHT: [], TAILLIGHT: [],
};
const PN_EXACT_YEAR_TYPES = new Set(['ECM','PCM','ECU','BCM','TIPM','ABS','TCM','TCU','AMP','RADIO','CLUSTER','THROTTLE','FUSE','JUNCTION']);

function computeMatchScore(wantTitle, vehicleData, partType) {
  const reasons = [];
  let score = 50;
  reasons.push('Year/make/model match: +50');
  const sensitivity = partType ? (PART_TYPE_SENSITIVITY[partType] || []) : [];
  const vMake = (vehicleData.make || '').toUpperCase();

  if (PN_EXACT_YEAR_TYPES.has(partType)) {
    const yr = piParseYear(wantTitle);
    const vYear = parseInt(vehicleData.year) || 0;
    if (yr && vYear) {
      const span = yr.end - yr.start;
      if (span === 0 && vYear === yr.start) { score += 10; reasons.push('Year exact: +10'); }
      else if (span <= 1) { score += 5; reasons.push('Year range tight: +5'); }
      else if (span >= 4) { score -= 5; reasons.push('Year range broad: -5'); }
    }
  }

  if (sensitivity.includes('engine')) {
    const titleCyl = _extractCylFromTitle(wantTitle);
    const namedEng = detectNamedEngine(wantTitle);
    const titleDisp = extractDisplacement(wantTitle);
    const vCyl = vehicleData.decoded_cylinders ? parseInt(vehicleData.decoded_cylinders) : null;
    const vEngStr = (vehicleData.decoded_engine || vehicleData.engine || '');
    const vDisp = extractDisplacement(vEngStr);

    if (titleCyl && vCyl) {
      if (titleCyl === vCyl) { score += 25; } else { score -= 50; }
    }
    if (namedEng) {
      const eng = NAMED_ENGINES[namedEng] || NAMED_ENGINES[namedEng.replace(/\s+/g, '')];
      if (eng) {
        const makeMatch = eng.makes.includes(vMake);
        if (makeMatch && vDisp) {
          const dispMatch = eng.displacements.some(d => Math.abs(d - parseFloat(vDisp)) < 0.25);
          if (dispMatch) score += 30; else score -= 30;
        } else if (!makeMatch) { score -= 60; }
      }
    }
    if (!namedEng && titleDisp && vDisp) {
      if (Math.abs(parseFloat(titleDisp) - parseFloat(vDisp)) < 0.25) score += 25; else score -= 50;
    } else if (!namedEng && titleDisp && !vDisp) { score -= 10; }
  }

  if (_extractDieselMarker(wantTitle)) {
    if (vehicleData.diesel === true) score += 35;
    else if (vehicleData.diesel === false) score -= 80;
    else score -= 20;
  }

  if (sensitivity.includes('drivetrain')) {
    score += 10;
    const titleDrive = _extractDriveFromTitle(wantTitle);
    if (titleDrive) {
      const vDrive = (vehicleData.decoded_drivetrain || vehicleData.drivetrain || '').toUpperCase();
      if (vDrive) {
        const v4wd = /4WD|4X4|AWD/.test(vDrive);
        const p4wd = titleDrive === '4WD' || titleDrive === 'AWD';
        if ((p4wd && v4wd) || (!p4wd && !v4wd)) score += 25; else score -= 50;
      } else {
        if (isReliable(vMake, 'drivetrain')) score -= 15;
      }
    }
  }

  if (sensitivity.includes('trim')) {
    const brand = _extractPremiumAudio(wantTitle);
    if (brand) {
      const vTier = (vehicleData.trim_tier || '').toUpperCase();
      if (vTier === 'PREMIUM') score += 30;
      else if (vTier === 'PERFORMANCE') score += 25;
      else if (vTier === 'BASE') score -= 40;
      else if (isReliable(vMake, 'trim')) score -= 10;
    }
  }

  const hasPremiumBrand = !!_extractPremiumAudio(wantTitle);
  const ceiling = getCeiling(partType, hasPremiumBrand);
  if (score > ceiling) score = ceiling;
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, reasons, ceiling, hardGated: false };
}

async function main() {
  console.log('Scoring Dry-Run');
  console.log('Time:', new Date().toISOString());
  const start = Date.now();

  // Load alerts joined to yard_vehicle
  const alerts = await knex.raw(`
    SELECT sa.*, yv.decoded_engine, yv.decoded_cylinders, yv.decoded_drivetrain,
           yv.decoded_transmission, yv.trim_tier, yv.decoded_trim, yv.trim_level,
           yv.engine, yv.drivetrain, yv.diesel, yv.engine_type,
           yv.make as v_make, yv.model as v_model
    FROM scout_alerts sa
    LEFT JOIN yard_vehicle yv ON sa.vehicle_year = yv.year::text
      AND LOWER(sa.vehicle_make) = LOWER(yv.make)
      AND LOWER(sa.vehicle_model) = LOWER(yv.model)
      AND yv.active = true
    LIMIT 10000
  `);

  console.log('Loaded alerts:', alerts.rows.length);

  const histogram = {};
  for (let b = 0; b <= 100; b += 5) histogram[b] = 0;
  const bySource = {};
  const byPartType = {};
  const samples = { high: [], medhigh: [], medium: [], low: [] };
  let hardGated = 0;
  let oldHighNewLow = 0, oldLowNewHigh = 0;
  const gateReasons = {};

  for (const a of alerts.rows) {
    // Check if year hard gate would reject
    const yr = piParseYear(a.source_title);
    if (!yr) {
      hardGated++;
      gateReasons['No year in title'] = (gateReasons['No year in title'] || 0) + 1;
      continue;
    }

    const partType = detectPartType(a.source_title) || 'OTHER';
    const vehicleData = {
      make: a.vehicle_make, model: a.vehicle_model, year: a.vehicle_year,
      decoded_engine: a.decoded_engine, decoded_cylinders: a.decoded_cylinders,
      decoded_drivetrain: a.decoded_drivetrain, decoded_transmission: a.decoded_transmission,
      trim_tier: a.trim_tier, decoded_trim: a.decoded_trim, trim_level: a.trim_level,
      engine: a.engine, drivetrain: a.drivetrain, diesel: a.diesel,
    };

    const result = computeMatchScore(a.source_title, vehicleData, partType);
    const bucket = Math.floor(result.score / 5) * 5;
    histogram[bucket] = (histogram[bucket] || 0) + 1;

    if (!bySource[a.source]) bySource[a.source] = { total: 0, avgScore: 0, scores: [] };
    bySource[a.source].total++;
    bySource[a.source].scores.push(result.score);

    if (!byPartType[partType]) byPartType[partType] = { total: 0, scores: [] };
    byPartType[partType].total++;
    byPartType[partType].scores.push(result.score);

    const tier = result.score >= 75 ? 'high' : result.score >= 55 ? 'medhigh' : result.score >= 40 ? 'medium' : 'low';
    if (samples[tier].length < 5) {
      samples[tier].push({
        score: result.score, source: a.source, confidence: a.confidence,
        title: (a.source_title || '').substring(0, 60),
        vehicle: a.vehicle_year + ' ' + a.vehicle_make + ' ' + a.vehicle_model,
        reasons: result.reasons.slice(0, 5),
      });
    }

    if (a.confidence === 'high' && result.score < 55) oldHighNewLow++;
    if (a.confidence === 'low' && result.score >= 75) oldLowNewHigh++;
  }

  // Output
  console.log('\n=== HISTOGRAM (5-point buckets) ===');
  for (let b = 0; b <= 100; b += 5) {
    const count = histogram[b] || 0;
    const bar = '#'.repeat(Math.min(count, 80));
    if (count > 0) console.log(String(b).padStart(3) + '-' + String(b+4).padStart(3) + ': ' + String(count).padStart(5) + ' ' + bar);
  }

  console.log('\n=== BY SOURCE ===');
  for (const [src, data] of Object.entries(bySource)) {
    const avg = Math.round(data.scores.reduce((a,b)=>a+b,0) / data.scores.length);
    console.log(src.padEnd(18) + 'n=' + String(data.total).padEnd(6) + 'avg=' + avg);
  }

  console.log('\n=== BY PART TYPE (top 10) ===');
  const sortedPT = Object.entries(byPartType).sort((a,b) => b[1].total - a[1].total).slice(0, 10);
  for (const [pt, data] of sortedPT) {
    const avg = Math.round(data.scores.reduce((a,b)=>a+b,0) / data.scores.length);
    console.log(pt.padEnd(15) + 'n=' + String(data.total).padEnd(6) + 'avg=' + avg);
  }

  console.log('\n=== HARD GATE REFUSALS ===');
  console.log('Total:', hardGated);
  for (const [reason, count] of Object.entries(gateReasons)) console.log('  ' + reason + ': ' + count);

  console.log('\n=== CONFIDENCE SHIFT ===');
  console.log('Old HIGH now <55:', oldHighNewLow);
  console.log('Old LOW now 75+:', oldLowNewHigh);

  console.log('\n=== SURVIVAL AT THRESHOLDS ===');
  const scored = alerts.rows.length - hardGated;
  for (const thresh of [55, 60, 65]) {
    let survive = 0;
    for (let b = thresh; b <= 100; b += 5) survive += (histogram[b] || 0);
    console.log('Threshold ' + thresh + ': ' + survive + '/' + scored + ' survive (' + Math.round(survive/scored*100) + '%)');
  }

  console.log('\n=== SAMPLES ===');
  for (const [tier, items] of Object.entries(samples)) {
    console.log('\n' + tier.toUpperCase() + ':');
    for (const s of items) {
      console.log('  score=' + s.score + ' [' + s.source + '] old=' + s.confidence + ' ' + s.title);
      console.log('    -> ' + s.vehicle);
      console.log('    reasons: ' + s.reasons.join(' | '));
    }
  }

  const elapsed = Date.now() - start;
  console.log('\n=== TIMING ===');
  console.log('Total: ' + elapsed + 'ms, per alert: ' + (elapsed / alerts.rows.length).toFixed(2) + 'ms');

  await knex.destroy();
  console.log('\nDone. Review output above before proceeding to rescore.');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
