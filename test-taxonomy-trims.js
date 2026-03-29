/**
 * TEST: eBay Taxonomy API Trim Catalog Query
 * 
 * Queries eBay's compatibility taxonomy for all available trims
 * on specific year/make/model combos. This is the same API your
 * AutoService.getCompatibilityTaxonomy() already uses.
 * 
 * Uses OAuth Application token (auto-refreshing via TokenManager).
 * NOT the Trading API token.
 * 
 * Usage:
 *   cd C:\Users\atenr\Downloads\parthawk-complete\parthawk-deploy
 *   set DATABASE_URL=postgresql://postgres:jOWykUhLuUbWSVASAAZZHqsDVfyqaFTN@switchyard.proxy.rlwy.net:12023/railway
 *   node test-taxonomy-trims.js
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const EbayAuthToken = require('ebay-oauth-nodejs-client');

// ─── GET OAUTH APPLICATION TOKEN ──────────────────────────────────
async function getToken() {
  const ebayAuthToken = new EbayAuthToken({
    clientId: process.env.TRADING_API_APP_NAME,
    clientSecret: process.env.TRADING_API_CERT_NAME,
    redirectUri: process.env.REDIRECT_URL,
  });

  const response = await ebayAuthToken.getApplicationToken('PRODUCTION');
  const { access_token } = JSON.parse(response);
  return access_token;
}

// ─── QUERY TAXONOMY API ───────────────────────────────────────────
const CATEGORY_ID = 33563; // eBay Motors Parts & Accessories

async function getTrimsForVehicle(token, year, make, model) {
  const filter = `Year:${year},Make:${make},Model:${model}`;
  
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/100/get_compatibility_property_values',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params: {
        compatibility_property: 'Trim',
        category_id: CATEGORY_ID,
        filter: filter,
      },
    });

    return response.data?.compatibilityPropertyValues || [];
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.errors?.[0]?.message || err.message;
    console.log(`    ❌ Error (${status}): ${msg}`);
    return [];
  }
}

async function getModelsForMake(token, year, make) {
  const filter = `Year:${year},Make:${make}`;
  
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://api.ebay.com/commerce/taxonomy/v1/category_tree/100/get_compatibility_property_values',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      params: {
        compatibility_property: 'Model',
        category_id: CATEGORY_ID,
        filter: filter,
      },
    });

    return response.data?.compatibilityPropertyValues || [];
  } catch (err) {
    console.log(`    ❌ Error getting models: ${err.message}`);
    return [];
  }
}

// ─── INLINE TRIM TIER CLASSIFIER ─────────────────────────────────
const TIER = { PREMIUM: 'PREMIUM', CHECK: 'CHECK', BASE: 'BASE' };

const TRIM_TIERS = {
  'xl': TIER.BASE, 's': TIER.BASE, 'work truck': TIER.BASE,
  'express': TIER.BASE, 'tradesman': TIER.BASE, 'willys': TIER.BASE,
  'l': TIER.BASE, 'le': TIER.BASE, 'ce': TIER.BASE,
  'dx': TIER.BASE, 'lx': TIER.BASE, 'ls': TIER.BASE, 'wt': TIER.BASE,
  'fleet': TIER.BASE, 'value edition': TIER.BASE, 'blue': TIER.BASE,
  'es': TIER.BASE,
  
  'xlt': TIER.CHECK, 'se': TIER.CHECK, 'sel': TIER.CHECK,
  'st': TIER.CHECK, 'sxt': TIER.CHECK, 'sport': TIER.CHECK,
  'titanium': TIER.CHECK, 'slt': TIER.CHECK, 'big horn': TIER.CHECK,
  'lone star': TIER.CHECK, 'rt': TIER.CHECK, 'r/t': TIER.CHECK,
  'gt': TIER.CHECK, 'touring': TIER.CHECK, 'latitude': TIER.CHECK,
  'altitude': TIER.CHECK, 'trailhawk': TIER.CHECK, 'sahara': TIER.CHECK,
  'xle': TIER.CHECK, 'xse': TIER.CHECK, 'sr5': TIER.CHECK,
  'ex': TIER.CHECK, 'ex-l': TIER.CHECK, 'lt': TIER.CHECK,
  'z71': TIER.CHECK, 'rst': TIER.CHECK, 'at4': TIER.CHECK,
  'sv': TIER.CHECK, 'n line': TIER.CHECK, 'sx': TIER.CHECK,
  'preferred': TIER.CHECK, 'select': TIER.CHECK,
  
  'lariat': TIER.PREMIUM, 'king ranch': TIER.PREMIUM,
  'platinum': TIER.PREMIUM, 'limited': TIER.PREMIUM,
  'raptor': TIER.PREMIUM, 'tremor': TIER.PREMIUM,
  'laramie': TIER.PREMIUM, 'longhorn': TIER.PREMIUM,
  'rebel': TIER.PREMIUM, 'citadel': TIER.PREMIUM,
  'overland': TIER.PREMIUM, 'summit': TIER.PREMIUM,
  'rubicon': TIER.PREMIUM, 'srt': TIER.PREMIUM,
  'trd pro': TIER.PREMIUM, '1794': TIER.PREMIUM,
  'elite': TIER.PREMIUM, 'type r': TIER.PREMIUM,
  'ltz': TIER.PREMIUM, 'high country': TIER.PREMIUM,
  'denali': TIER.PREMIUM, 'premier': TIER.PREMIUM,
  'sl': TIER.PREMIUM, 'calligraphy': TIER.PREMIUM,
  'grand touring': TIER.PREMIUM, 'signature': TIER.PREMIUM,
  'f sport': TIER.PREMIUM, 'luxury': TIER.PREMIUM,
  'premium': TIER.PREMIUM, 'prestige': TIER.PREMIUM,
};

const MAKE_OVERRIDES = {
  ram: { 'st': TIER.BASE },
  honda: { 'touring': TIER.PREMIUM },
  mazda: { 'sport': TIER.BASE, 'gt': TIER.PREMIUM },
  subaru: { 'premium': TIER.CHECK, 'touring': TIER.PREMIUM },
  nissan: { 'sv': TIER.CHECK, 'sr': TIER.CHECK },
  toyota: { 'sr': TIER.BASE },
};

function classifyTrim(make, trimName) {
  const makeLower = (make || '').toLowerCase();
  const trimLower = (trimName || '').toLowerCase().trim();
  
  // Make-specific override
  if (MAKE_OVERRIDES[makeLower]?.[trimLower] !== undefined) {
    return MAKE_OVERRIDES[makeLower][trimLower];
  }
  
  // Global lookup
  if (TRIM_TIERS[trimLower] !== undefined) {
    return TRIM_TIERS[trimLower];
  }
  
  // Partial match
  const sortedKeys = Object.keys(TRIM_TIERS).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (trimLower.includes(key)) {
      if (MAKE_OVERRIDES[makeLower]?.[key] !== undefined) {
        return MAKE_OVERRIDES[makeLower][key];
      }
      return TRIM_TIERS[key];
    }
  }
  
  return TIER.CHECK; // Unknown defaults to CHECK
}

function tierEmoji(tier) {
  if (tier === TIER.PREMIUM) return '🟢';
  if (tier === TIER.BASE) return '🔴';
  return '🟡';
}

// ─── MAIN ─────────────────────────────────────────────────────────
async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  EBAY TAXONOMY API - TRIM CATALOG TEST');
  console.log('  Using OAuth Application Token (auto-refresh)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get OAuth token
  console.log('Getting OAuth application token...');
  let token;
  try {
    token = await getToken();
    console.log(`✅ Token obtained (${token.substring(0, 20)}...)\n`);
  } catch (err) {
    console.error('❌ Failed to get token:', err.message);
    return;
  }

  // Test vehicles - covers your top makes
  const testVehicles = [
    { year: 2015, make: 'Ram', model: '1500' },
    { year: 2017, make: 'Ford', model: 'F-150' },
    { year: 2016, make: 'Jeep', model: 'Grand Cherokee' },
    { year: 2018, make: 'Toyota', model: 'Camry' },
    { year: 2015, make: 'Honda', model: 'Accord' },
    { year: 2019, make: 'Chevrolet', model: 'Silverado 1500' },
    { year: 2017, make: 'Dodge', model: 'Charger' },
    { year: 2018, make: 'Hyundai', model: 'Sonata' },
    { year: 2016, make: 'Nissan', model: 'Altima' },
    { year: 2017, make: 'BMW', model: '3 Series' },
  ];

  for (const v of testVehicles) {
    console.log(`┌─ ${v.year} ${v.make} ${v.model}`);
    
    const trims = await getTrimsForVehicle(token, v.year, v.make, v.model);
    
    if (trims.length === 0) {
      console.log('│  ⚠️  No trims returned');
    } else {
      console.log(`│  ${trims.length} trims found:`);
      
      let baseCount = 0, checkCount = 0, premiumCount = 0;
      
      trims.forEach(t => {
        const trimName = t.value || t;
        const tier = classifyTrim(v.make, trimName);
        const emoji = tierEmoji(tier);
        console.log(`│    ${emoji} ${tier.padEnd(8)} │ ${trimName}`);
        
        if (tier === TIER.BASE) baseCount++;
        else if (tier === TIER.PREMIUM) premiumCount++;
        else checkCount++;
      });
      
      console.log(`│  Summary: ${baseCount} base, ${checkCount} check, ${premiumCount} premium`);
    }
    
    console.log('└─\n');
    await new Promise(r => setTimeout(r, 500));
  }

  // Bonus: Show how many models exist for a make in a year
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  CATALOG SCALE TEST: How many models per make?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const scaleMakes = ['Ford', 'Ram', 'Toyota', 'Honda', 'Chevrolet'];
  
  for (const make of scaleMakes) {
    const models = await getModelsForMake(token, 2018, make);
    console.log(`  ${make} (2018): ${models.length} models`);
    if (models.length > 0) {
      const modelNames = models.map(m => m.value || m).slice(0, 10).join(', ');
      console.log(`    ${modelNames}${models.length > 10 ? ', ...' : ''}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════════════');
}

run().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
});
