#!/usr/bin/env node
'use strict';

/**
 * Rescore existing scout_alerts with new scoring math.
 * Updates match_score, match_reasons, and confidence columns.
 * Deletes alerts that fail the year hard gate.
 *
 * Usage: DATABASE_URL=... node service/scripts/rescore-existing-alerts.js
 */

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const { parseYearRange: piParseYear, detectPartType } = require('../utils/partIntelligence');
const { isReliable, detectNamedEngine, NAMED_ENGINES, getCeiling } = require('../lib/decoderCapability');

const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
});

// Inline scoring (same as ScoutAlertService computeMatchScore)
function extractDisplacement(s) { if (!s) return null; const m = s.match(/(\d+\.\d)\s*L/i); return m ? m[1] : null; }
function _extractCylFromTitle(t) { if (!t) return null; const m = t.match(/\bV(\d{1,2})\b/i) || t.match(/\bI(\d)\b/) || t.match(/\b(\d)-?cyl/i) || t.match(/\b(\d)\s*cylinder/i); return m ? parseInt(m[1]) : null; }
function _extractDriveFromTitle(t) { if (!t) return null; const u = t.toUpperCase(); if (/\b4WD\b|\b4X4\b/.test(u)) return '4WD'; if (/\bAWD\b/.test(u)) return 'AWD'; if (/\b2WD\b|\b4X2\b/.test(u)) return '2WD'; if (/\bFWD\b/.test(u)) return 'FWD'; if (/\bRWD\b/.test(u)) return 'RWD'; return null; }
function _extractPremiumAudio(t) { if (!t) return null; const m = t.match(/\b(Bose|B&O|Bang\s*&?\s*Olufsen|Alpine|JBL|Harman\s*Kardon|Mark\s*Levinson|Burmester|Meridian|Infinity|Beats)\b/i); return m ? m[1] : null; }
function _extractDieselMarker(t) { return t ? /\b(Diesel|TDI|Duramax|Cummins|Power\s*Stroke|PowerStroke|EcoDiesel)\b/i.test(t) : false; }

const PART_TYPE_SENSITIVITY = { ECM:['engine'],PCM:['engine'],THROTTLE:['engine'],TCM:['engine','drivetrain'],ABS:['drivetrain'],AMP:['trim'],RADIO:['trim'],NAV:['trim'],BCM:[],TIPM:[],CLUSTER:[],HEADLIGHT:[],TAILLIGHT:[] };
const PN_EXACT_YEAR_TYPES = new Set(['ECM','PCM','ECU','BCM','TIPM','ABS','TCM','TCU','AMP','RADIO','CLUSTER','THROTTLE','FUSE','JUNCTION']);
const ENGINE_SENSITIVE_TYPES = new Set(['ECM','PCM','ECU','TCM','TCU','THROTTLE']);

function computeMatchScore(wantTitle, vd, partType) {
  const reasons = [];
  let score = ENGINE_SENSITIVE_TYPES.has(partType) ? 55 : 50;
  reasons.push(ENGINE_SENSITIVE_TYPES.has(partType) ? 'YMM match (eng-sens): +55' : 'YMM match: +50');
  const sensitivity = partType ? (PART_TYPE_SENSITIVITY[partType] || []) : [];
  const vMake = (vd.make || '').toUpperCase();

  if (PN_EXACT_YEAR_TYPES.has(partType)) {
    const yr = piParseYear(wantTitle); const vYear = parseInt(vd.year) || 0;
    if (yr && vYear) { const span = yr.end - yr.start; if (span===0&&vYear===yr.start){score+=10;reasons.push('Year exact: +10');} else if(span<=1){score+=5;reasons.push('Year tight: +5');} else if(span>=4){score-=5;reasons.push('Year broad: -5');} }
  }

  if (sensitivity.includes('engine')) {
    const tCyl=_extractCylFromTitle(wantTitle), nEng=detectNamedEngine(wantTitle), tDisp=extractDisplacement(wantTitle);
    const vCyl=vd.decoded_cylinders?parseInt(vd.decoded_cylinders):null, vDisp=extractDisplacement(vd.decoded_engine||vd.engine||'');
    if(tCyl&&vCyl){if(tCyl===vCyl){score+=25;reasons.push('Cyl match V'+vCyl+': +25');}else{score-=50;reasons.push('Cyl mismatch V'+tCyl+' vs V'+vCyl+': -50');}}
    if(nEng){const eng=NAMED_ENGINES[nEng]||NAMED_ENGINES[nEng.replace(/\s+/g,'')];if(eng){if(eng.makes.includes(vMake)&&vDisp&&eng.displacements.some(d=>Math.abs(d-parseFloat(vDisp))<0.25)){score+=30;reasons.push(nEng+' match: +30');}else if(!eng.makes.includes(vMake)){score-=60;reasons.push(nEng+' wrong make: -60');}else{score-=30;reasons.push(nEng+' disp mismatch: -30');}}}
    if(!nEng&&tDisp&&vDisp){if(Math.abs(parseFloat(tDisp)-parseFloat(vDisp))<0.25){score+=25;reasons.push('Disp match: +25');}else{score-=50;reasons.push('Disp mismatch: -50');}}
    else if(!nEng&&tDisp&&!vDisp){score-=10;reasons.push('Engine unknown: -10');}
  }
  if(_extractDieselMarker(wantTitle)){if(vd.diesel===true)score+=35;else if(vd.diesel===false)score-=80;else score-=20;}
  if(sensitivity.includes('drivetrain')){score+=10;const td=_extractDriveFromTitle(wantTitle);if(td){const vD=(vd.decoded_drivetrain||vd.drivetrain||'').toUpperCase();if(vD){const v4=/4WD|4X4|AWD/.test(vD),p4=td==='4WD'||td==='AWD';if((p4&&v4)||(!p4&&!v4))score+=25;else score-=50;}else if(isReliable(vMake,'drivetrain'))score-=15;}}
  if(sensitivity.includes('trim')){const brand=_extractPremiumAudio(wantTitle);if(brand){const vT=(vd.trim_tier||'').toUpperCase();if(vT==='PREMIUM')score+=30;else if(vT==='PERFORMANCE')score+=25;else if(vT==='BASE')score-=40;else if(isReliable(vMake,'trim'))score-=10;}}

  const ceiling=getCeiling(partType,!!_extractPremiumAudio(wantTitle));
  if(score>ceiling)score=ceiling;if(score<0)score=0;if(score>100)score=100;
  return{score,reasons};
}

async function main() {
  console.log('Rescore existing alerts');
  const start = Date.now();

  const allAlerts = await knex('scout_alerts').select('*');
  console.log('Total alerts:', allAlerts.length);

  // Build vehicle index
  const vehicles = await knex('yard_vehicle as yv').join('yard as y','y.id','yv.yard_id').where('yv.active',true)
    .select('yv.year','yv.make','yv.model','y.name as yard_name','yv.decoded_engine','yv.decoded_cylinders',
      'yv.decoded_drivetrain','yv.decoded_transmission','yv.trim_tier','yv.decoded_trim','yv.trim_level',
      'yv.engine','yv.drivetrain','yv.diesel','yv.engine_type');
  const vIndex = {};
  for (const v of vehicles) {
    const key = [v.year,(v.make||'').toLowerCase(),(v.model||'').toLowerCase(),(v.yard_name||'').toLowerCase()].join('|');
    if (!vIndex[key]) vIndex[key] = v;
  }

  let updated = 0, deleted = 0, skipped = 0;
  for (const a of allAlerts) {
    const yr = piParseYear(a.source_title);
    if (!yr) {
      await knex('scout_alerts').where('id', a.id).del();
      deleted++;
      continue;
    }

    const key = [a.vehicle_year,(a.vehicle_make||'').toLowerCase(),(a.vehicle_model||'').toLowerCase(),(a.yard_name||'').toLowerCase()].join('|');
    const vd = vIndex[key];
    if (!vd) { skipped++; continue; }

    const pt = detectPartType(a.source_title) || 'OTHER';
    const result = computeMatchScore(a.source_title, vd, pt);
    const confidence = result.score >= 75 ? 'high' : result.score >= 55 ? 'medium' : 'low';

    await knex('scout_alerts').where('id', a.id).update({
      match_score: result.score,
      match_reasons: JSON.stringify(result.reasons),
      confidence: confidence,
    });
    updated++;

    if (updated % 500 === 0) console.log('Progress: ' + updated + '/' + allAlerts.length);
  }

  console.log('\n=== SUMMARY ===');
  console.log('Total:', allAlerts.length, 'Updated:', updated, 'Deleted (hard-gated):', deleted, 'Skipped (orphaned):', skipped);
  console.log('Time:', (Date.now() - start) + 'ms');

  // Verify
  const dist = await knex.raw('SELECT match_score / 10 * 10 as bucket, COUNT(*) as c FROM scout_alerts WHERE match_score IS NOT NULL GROUP BY 1 ORDER BY 1');
  console.log('\nPost-rescore distribution:');
  for (const r of dist.rows) console.log('  ' + String(r.bucket).padStart(3) + ': ' + r.c);

  await knex.destroy();
  console.log('Done');
}

main().catch(e => { console.error('FATAL:', e.message); knex.destroy(); process.exit(1); });
