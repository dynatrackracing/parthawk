/**
 * TRIM INTELLIGENCE LIVE TEST - DarkHawk
 * 
 * Pulls real yard_vehicle records from the database, decodes VINs 
 * via NHTSA API for trim, and shows before/after scoring impact.
 * 
 * Usage:
 *   cd C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node test-trim-intelligence.js
 */

'use strict';

const https = require('https');

// ─── INLINE TRIM TIER CONFIG (same logic as trim-tier-config.js) ──
const TIER = { PREMIUM: 1.0, CHECK: 0.5, BASE: 0.0 };

const TRIM_DEPENDENT_PARTS = [
  'amplifier', 'amp', 'premium radio', 'camera', 'parking sensor',
  'blind spot', 'heated seat', 'cooled seat', 'power liftgate',
  'power running board', 'heads up display', 'premium cluster',
  'lane departure', 'adaptive cruise', 'wireless charging',
  'power folding mirror', 'memory seat', 'surround view',
  'trailer brake controller', 'panoramic sunroof',
];

const UNIVERSAL_PARTS = [
  'ecm', 'ecu', 'pcm', 'bcm', 'tcm', 'abs', 'tipm',
  'fuse box', 'fuse relay', 'throttle body', 'throttle',
  'steering module', 'steering control', 'power steering',
  'airbag', 'hvac', 'climate control', 'ignition',
  'window regulator', 'window motor', 'door lock', 'seat belt', 'wiper',
];

const TRIM_TIERS = {
  // Ford
  'xl': TIER.BASE, 'xlt': TIER.CHECK, 'se': TIER.CHECK,
  'sel': TIER.CHECK, 'lariat': TIER.PREMIUM, 'king ranch': TIER.PREMIUM,
  'platinum': TIER.PREMIUM, 'limited': TIER.PREMIUM, 'raptor': TIER.PREMIUM,
  'tremor': TIER.PREMIUM,
  // Dodge/Ram/Chrysler
  'express': TIER.BASE, 'tradesman': TIER.BASE, 'sxt': TIER.CHECK,
  'slt': TIER.CHECK, 'big horn': TIER.CHECK, 'lone star': TIER.CHECK,
  'laramie': TIER.PREMIUM, 'longhorn': TIER.PREMIUM, 'rebel': TIER.PREMIUM,
  'citadel': TIER.PREMIUM, 'overland': TIER.PREMIUM, 'scat pack': TIER.PREMIUM,
  'hellcat': TIER.PREMIUM, 'rt': TIER.CHECK, 'r/t': TIER.CHECK,
  'gt': TIER.CHECK, 'touring': TIER.CHECK,
  // Jeep
  'latitude': TIER.CHECK, 'altitude': TIER.CHECK, 'trailhawk': TIER.CHECK,
  'sahara': TIER.CHECK, 'willys': TIER.BASE, 'summit': TIER.PREMIUM,
  'rubicon': TIER.PREMIUM, 'high altitude': TIER.PREMIUM, 'srt': TIER.PREMIUM,
  // Toyota
  'l': TIER.BASE, 'le': TIER.BASE, 'ce': TIER.BASE,
  'xle': TIER.CHECK, 'xse': TIER.CHECK, 'sr5': TIER.CHECK,
  'trd sport': TIER.CHECK, 'trd off-road': TIER.CHECK,
  'trd pro': TIER.PREMIUM, '1794': TIER.PREMIUM,
  // Honda
  'dx': TIER.BASE, 'lx': TIER.BASE, 'lx-p': TIER.BASE,
  'ex': TIER.CHECK, 'ex-l': TIER.CHECK,
  'elite': TIER.PREMIUM, 'type r': TIER.PREMIUM,
  // Hyundai/Kia
  'value edition': TIER.BASE, 'blue': TIER.BASE,
  'n line': TIER.CHECK, 'sx': TIER.CHECK, 'gt-line': TIER.CHECK,
  'calligraphy': TIER.PREMIUM, 'n': TIER.PREMIUM, 'sx prestige': TIER.PREMIUM,
  // GM
  'ls': TIER.BASE, 'wt': TIER.BASE, 'fleet': TIER.BASE,
  'lt': TIER.CHECK, 'z71': TIER.CHECK, 'rst': TIER.CHECK,
  'trail boss': TIER.CHECK, 'at4': TIER.CHECK,
  'ltz': TIER.PREMIUM, 'high country': TIER.PREMIUM,
  'denali': TIER.PREMIUM, 'premier': TIER.PREMIUM,
  // Nissan
  's': TIER.BASE, 'sv': TIER.CHECK, 'sl': TIER.PREMIUM,
  // BMW/Mercedes/Lexus - premium brands
  'amg': TIER.PREMIUM, 'm sport': TIER.PREMIUM, 'm': TIER.PREMIUM,
  'f sport': TIER.PREMIUM, 'luxury': TIER.PREMIUM,
  'premium': TIER.PREMIUM, 'prestige': TIER.PREMIUM,
  // Mazda
  'grand touring': TIER.PREMIUM, 'signature': TIER.PREMIUM,
  // Subaru
  // Misc
  'sport': TIER.CHECK, 'st': TIER.CHECK,
};

const MAKE_TRIM_OVERRIDES = {
  ram: { 'st': TIER.BASE, 'sport': TIER.CHECK },
  honda: { 'touring': TIER.PREMIUM },
  acura: { 'touring': TIER.PREMIUM },
  subaru: { 'touring': TIER.PREMIUM, 'premium': TIER.CHECK, 'base': TIER.BASE },
  mazda: { 'sport': TIER.BASE, 'gt': TIER.PREMIUM },
  nissan: { 'sv': TIER.CHECK, 'sr': TIER.CHECK },
  toyota: { 'sr': TIER.BASE },
};

const PREMIUM_BRANDS = [
  'lexus', 'acura', 'infiniti', 'cadillac', 'lincoln',
  'bmw', 'mercedes', 'mercedes-benz', 'audi', 'volvo',
  'buick', 'porsche', 'jaguar', 'land rover', 'mini',
];

function isTrimDependent(partType) {
  if (!partType) return false;
  const pt = partType.toLowerCase();
  for (const u of UNIVERSAL_PARTS) { if (pt.includes(u)) return false; }
  for (const d of TRIM_DEPENDENT_PARTS) { if (pt.includes(d)) return true; }
  return false;
}

function getTrimTier(make, trim) {
  if (!trim || !trim.trim()) {
    return { tier: 'UNKNOWN', multiplier: TIER.CHECK, badge: 'NO TRIM DATA', color: 'grey' };
  }
  const makeLower = (make || '').toLowerCase().trim();
  const trimLower = trim.toLowerCase().trim();

  // Make-specific override first
  if (makeLower && MAKE_TRIM_OVERRIDES[makeLower]) {
    const override = MAKE_TRIM_OVERRIDES[makeLower][trimLower];
    if (override !== undefined) return tierToResult(override);
  }

  // Global map
  if (TRIM_TIERS[trimLower] !== undefined) return tierToResult(TRIM_TIERS[trimLower]);

  // Partial match (longest first)
  const sortedKeys = Object.keys(TRIM_TIERS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(trimLower)) {
      if (makeLower && MAKE_TRIM_OVERRIDES[makeLower] && MAKE_TRIM_OVERRIDES[makeLower][key] !== undefined) {
        return tierToResult(MAKE_TRIM_OVERRIDES[makeLower][key]);
      }
      return tierToResult(TRIM_TIERS[key]);
    }
  }

  // Premium brand default
  if (PREMIUM_BRANDS.includes(makeLower)) {
    return { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
  }

  return { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
}

function tierToResult(multiplier) {
  if (multiplier === TIER.PREMIUM) return { tier: 'PREMIUM', multiplier: 1.0, badge: 'PREMIUM TRIM', color: 'green' };
  if (multiplier === TIER.BASE) return { tier: 'BASE', multiplier: 0.0, badge: 'BASE TRIM', color: 'red' };
  return { tier: 'CHECK', multiplier: 0.5, badge: 'CHECK TRIM', color: 'yellow' };
}

// ─── NHTSA VIN DECODER ────────────────────────────────────────────

function decodeVIN(vin) {
  return new Promise((resolve, reject) => {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const r = json.Results?.[0] || {};
          resolve({
            vin,
            year: r.ModelYear || null,
            make: r.Make || null,
            model: r.Model || null,
            trim: r.Trim || null,
            engine: r.DisplacementL ? `${parseFloat(r.DisplacementL).toFixed(1)}L` : null,
            driveType: r.DriveType || null,
            bodyClass: r.BodyClass || null,
            series: r.Series || null,
          });
        } catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── SIMULATED PART MATCHES ───────────────────────────────────────
// These are the typical part types DynaTrack pulls.
// In production, this comes from the actual partIntelligence query.
const PART_TYPES_TO_SCORE = [
  // Universal (should always score normally)
  { type: 'ECM', label: 'ECM/PCM', avgPrice: 280, trimDep: false },
  { type: 'BCM', label: 'BCM', avgPrice: 140, trimDep: false },
  { type: 'TCM', label: 'TCM', avgPrice: 180, trimDep: false },
  { type: 'ABS', label: 'ABS Module', avgPrice: 320, trimDep: false },
  { type: 'TIPM', label: 'TIPM/Fuse Box', avgPrice: 160, trimDep: false },
  { type: 'Throttle Body', label: 'Throttle Body', avgPrice: 120, trimDep: false },
  { type: 'Power Steering', label: 'Steering Module', avgPrice: 150, trimDep: false },

  // Trim-dependent (score should vary by trim)
  { type: 'Amplifier', label: 'Audio Amp', avgPrice: 180, trimDep: true },
  { type: 'Camera', label: 'Backup Camera', avgPrice: 140, trimDep: true },
  { type: 'Parking Sensor', label: 'Park Sensor', avgPrice: 100, trimDep: true },
  { type: 'Blind Spot', label: 'Blind Spot Module', avgPrice: 130, trimDep: true },
  { type: 'Heated Seat', label: 'Heated Seat Module', avgPrice: 110, trimDep: true },
  { type: 'Premium Cluster', label: 'Premium Cluster', avgPrice: 200, trimDep: true },
];

// ─── MAIN ─────────────────────────────────────────────────────────

const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  searchPath: ['public'],
});

async function run() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  DARKHAWK TRIM INTELLIGENCE - LIVE TEST');
  console.log('  Pulling real yard vehicles, decoding VINs, simulating scoring impact');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // Discover yard_vehicle columns first
  const cols = await knex.raw(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'yard_vehicle' ORDER BY ordinal_position
  `);
  console.log('yard_vehicle columns:', cols.rows.map(r => r.column_name).join(', '));
  console.log('');

  // Pull yard vehicles with VINs
  const vehicles = await knex('yard_vehicle')
    .select('*')
    .whereNotNull('vin')
    .where('vin', '!=', '')
    .whereRaw("LENGTH(vin) = 17")
    .orderByRaw('RANDOM()')
    .limit(20);

  console.log(`Found ${vehicles.length} yard vehicles with valid 17-char VINs.\n`);

  if (vehicles.length === 0) {
    console.log('No vehicles with VINs found. Check yard_vehicle table.');
    await knex.destroy();
    return;
  }

  // Decode VINs via NHTSA
  console.log('Decoding VINs via NHTSA API...\n');

  const decoded = [];
  for (const v of vehicles) {
    try {
      const d = await decodeVIN(v.vin);
      decoded.push({ ...v, decoded: d });
      // Be nice to NHTSA - small delay between calls
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ⚠️ Failed to decode ${v.vin}: ${err.message}`);
    }
  }

  console.log(`Successfully decoded ${decoded.length} VINs.\n`);

  // Score each vehicle with and without trim intelligence
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SCORING COMPARISON: WITHOUT vs WITH TRIM INTELLIGENCE');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  let totalSuppressed = 0;
  let totalFlagged = 0;
  let totalBoosted = 0;

  for (const v of decoded) {
    const d = v.decoded;
    const trimInfo = getTrimTier(d.make, d.trim);

    // Header
    // Header - use NHTSA decoded data, fall back to DB columns
    const vYear = d.year || v.year || v.vehicle_year || '?';
    const vMake = d.make || v.make || v.vehicle_make || '?';
    const vModel = d.model || v.model || v.vehicle_model || '?';
    const yearMakeModel = `${vYear} ${vMake} ${vModel}`;
    const trimDisplay = d.trim || '(no trim from NHTSA)';
    const rowDisplay = v.row || v.row_number || v.location_row || '?';
    const yardDisplay = v.yard_name || v.location || v.yard || v.location_name || '?';
    
    console.log(`┌─────────────────────────────────────────────────────────────────────────`);
    console.log(`│ ${yearMakeModel} ${trimDisplay}`);
    console.log(`│ VIN: ${v.vin} | Row: ${rowDisplay} | Yard: ${yardDisplay}`);
    console.log(`│ Trim Tier: ${trimInfo.badge} (${trimInfo.color}, ${trimInfo.multiplier}x on trim-dep parts)`);
    console.log(`│`);
    console.log(`│ ${'Part Type'.padEnd(22)} ${'Avg $'.padStart(7)} ${'Without'.padStart(9)} ${'With Trim'.padStart(11)} ${'Change'.padStart(8)}  Notes`);
    console.log(`│ ${'─'.repeat(80)}`);

    let vehicleTotalBefore = 0;
    let vehicleTotalAfter = 0;

    for (const part of PART_TYPES_TO_SCORE) {
      // Simulate a base score (just using avgPrice as proxy)
      const baseScore = Math.min(100, Math.round(part.avgPrice / 4));
      
      // WITHOUT trim intelligence: everything scores at full
      const scoreBefore = baseScore;

      // WITH trim intelligence: apply multiplier if trim-dependent
      let scoreAfter = baseScore;
      let note = '';

      if (part.trimDep) {
        scoreAfter = Math.round(baseScore * trimInfo.multiplier);
        
        if (trimInfo.multiplier === 0.0) {
          note = '🔴 SUPPRESSED - base trim';
          totalSuppressed++;
        } else if (trimInfo.multiplier === 0.5) {
          note = '🟡 HALVED - verify on-site';
          totalFlagged++;
        } else {
          note = '🟢 Full score - premium trim';
          totalBoosted++;
        }
      } else {
        note = '── universal (unchanged)';
      }

      vehicleTotalBefore += scoreBefore;
      vehicleTotalAfter += scoreAfter;

      const changeStr = scoreAfter === scoreBefore ? '   ──' : `  ${scoreAfter > scoreBefore ? '+' : ''}${scoreAfter - scoreBefore}`;

      console.log(`│ ${part.label.padEnd(22)} $${String(part.avgPrice).padStart(5)} ${String(scoreBefore).padStart(9)} ${String(scoreAfter).padStart(11)} ${changeStr.padStart(8)}  ${note}`);
    }

    const totalChange = vehicleTotalAfter - vehicleTotalBefore;
    const changeSign = totalChange >= 0 ? '' : '';
    console.log(`│ ${'─'.repeat(80)}`);
    console.log(`│ ${'VEHICLE TOTAL'.padEnd(22)} ${''.padStart(7)} ${String(vehicleTotalBefore).padStart(9)} ${String(vehicleTotalAfter).padStart(11)} ${String(changeSign + totalChange).padStart(8)}`);
    console.log(`└─────────────────────────────────────────────────────────────────────────\n`);
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');
  console.log(`  Vehicles tested:        ${decoded.length}`);
  console.log(`  Parts SUPPRESSED:       ${totalSuppressed} (base trim, would have been wasted pulls)`);
  console.log(`  Parts FLAGGED:          ${totalFlagged} (CHECK TRIM, puller verifies on-site)`);
  console.log(`  Parts scored normally:  ${totalBoosted} (premium trim confirmed)`);
  console.log(`  Universal parts:        always scored at 1.0x regardless of trim\n`);

  // Trim distribution
  const trimDist = { PREMIUM: 0, CHECK: 0, BASE: 0, UNKNOWN: 0 };
  for (const v of decoded) {
    const tier = getTrimTier(v.decoded.make, v.decoded.trim);
    trimDist[tier.tier] = (trimDist[tier.tier] || 0) + 1;
  }
  console.log('  Trim tier distribution of tested vehicles:');
  console.log(`    PREMIUM TRIM:   ${trimDist.PREMIUM || 0}`);
  console.log(`    CHECK TRIM:     ${trimDist.CHECK || 0}`);
  console.log(`    BASE TRIM:      ${trimDist.BASE || 0}`);
  console.log(`    NO TRIM DATA:   ${trimDist.UNKNOWN || 0}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════');

  await knex.destroy();
}

run().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
