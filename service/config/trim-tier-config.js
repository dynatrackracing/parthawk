'use strict';

/**
 * TRIM TIER CONFIGURATION
 *
 * Three tiers control how trim-dependent parts are scored:
 *   PREMIUM (1.0x) - Score all parts normally
 *   CHECK   (0.5x) - Puller verifies on-site
 *   BASE    (0.0x) - Suppress trim-dependent part scores
 *
 * If trim not found, default = CHECK (0.5x)
 */

const TIER = { PERFORMANCE: 1.3, PREMIUM: 1.0, CHECK: 0.5, BASE: 0.0 };

const TRIM_DEPENDENT_PARTS = [
  'amplifier', 'amp', 'premium radio', 'camera', 'parking sensor',
  'blind spot', 'heated seat', 'cooled seat', 'ventilated seat',
  'power liftgate', 'power running board', 'heads up display',
  'premium cluster', 'lane departure', 'adaptive cruise',
  'wireless charging', 'power folding mirror', 'memory seat',
  'surround view', 'trailer brake controller', 'panoramic sunroof',
];

const UNIVERSAL_PARTS = [
  'ecm', 'ecu', 'pcm', 'bcm', 'tcm', 'abs', 'tipm',
  'fuse box', 'fuse relay', 'throttle body', 'throttle',
  'steering module', 'steering control', 'power steering',
  'airbag', 'hvac', 'climate control', 'ignition',
  'window regulator', 'window motor', 'door lock', 'seat belt', 'wiper',
];

const TRIM_TIERS = {
  // BASE
  'xl': TIER.BASE, 's': TIER.BASE, 'work truck': TIER.BASE,
  'express': TIER.BASE, 'tradesman': TIER.BASE, 'st': TIER.CHECK,
  'willys': TIER.BASE, 'special service': TIER.BASE, 'hfe': TIER.BASE,
  'enforcer': TIER.BASE, 'l': TIER.BASE, 'le': TIER.BASE, 'ce': TIER.BASE,
  'dx': TIER.BASE, 'lx': TIER.BASE, 'lx-s': TIER.BASE, 'lx-p': TIER.BASE,
  'ls': TIER.BASE, 'wt': TIER.BASE, 'fleet': TIER.BASE,
  'value edition': TIER.BASE, 'blue': TIER.BASE, 'es': TIER.BASE,
  'gls': TIER.BASE,
  // CHECK
  'xlt': TIER.CHECK, 'se': TIER.CHECK, 'sel': TIER.CHECK, 'sxt': TIER.CHECK,
  'sport': TIER.CHECK, 'titanium': TIER.CHECK, 'ssv': TIER.CHECK,
  'slt': TIER.CHECK, 'big horn': TIER.CHECK, 'lone star': TIER.CHECK,
  'rt': TIER.CHECK, 'r/t': TIER.CHECK, 'gt': TIER.CHECK, 'touring': TIER.CHECK,
  'latitude': TIER.CHECK, 'altitude': TIER.CHECK, 'trailhawk': TIER.CHECK,
  'sahara': TIER.CHECK, 'laredo': TIER.CHECK,
  'xle': TIER.CHECK, 'xse': TIER.CHECK, 'sr5': TIER.CHECK,
  'trd sport': TIER.CHECK, 'trd off-road': TIER.CHECK,
  'ex': TIER.CHECK, 'ex-l': TIER.CHECK,
  'lt': TIER.CHECK, 'z71': TIER.CHECK, 'rst': TIER.CHECK, 'at4': TIER.CHECK,
  'trail boss': TIER.CHECK, 'custom': TIER.CHECK,
  'sv': TIER.CHECK, 'n line': TIER.CHECK, 'sx': TIER.CHECK,
  'preferred': TIER.CHECK, 'select': TIER.CHECK,
  'pursuit': TIER.CHECK, 'daytona': TIER.CHECK,
  'eco': TIER.CHECK, 'gl': TIER.CHECK,
  'outdoorsman': TIER.CHECK, 'sr': TIER.CHECK,
  // PREMIUM
  'lariat': TIER.PREMIUM, 'king ranch': TIER.PREMIUM,
  'platinum': TIER.PREMIUM, 'limited': TIER.PREMIUM,
  'raptor': TIER.PREMIUM, 'tremor': TIER.PREMIUM,
  'laramie': TIER.PREMIUM, 'laramie limited': TIER.PREMIUM,
  'laramie longhorn': TIER.PREMIUM, 'longhorn': TIER.PREMIUM,
  'rebel': TIER.PREMIUM, 'citadel': TIER.PREMIUM,
  'overland': TIER.PREMIUM, 'summit': TIER.PREMIUM,
  'rubicon': TIER.PREMIUM, 'srt': TIER.PREMIUM,
  'srt 392': TIER.PREMIUM, 'srt hellcat': TIER.PREMIUM,
  'high altitude': TIER.PREMIUM, 'trackhawk': TIER.PREMIUM,
  'trd pro': TIER.PREMIUM, '1794': TIER.PREMIUM, 'capstone': TIER.PREMIUM,
  'elite': TIER.PREMIUM, 'type r': TIER.PREMIUM,
  'ltz': TIER.PREMIUM, 'high country': TIER.PREMIUM,
  'denali': TIER.PREMIUM, 'premier': TIER.PREMIUM, 'at4x': TIER.PREMIUM,
  'sl': TIER.PREMIUM, 'calligraphy': TIER.PREMIUM,
  'grand touring': TIER.PREMIUM, 'signature': TIER.PREMIUM,
  'f sport': TIER.PREMIUM, 'luxury': TIER.PREMIUM,
  'premium': TIER.PREMIUM, 'prestige': TIER.PREMIUM,
};

const MAKE_TRIM_OVERRIDES = {
  ram:    { 'st': TIER.BASE, 'sport': TIER.CHECK, 'outdoorsman': TIER.CHECK },
  honda:  { 'touring': TIER.PREMIUM },
  acura:  { 'touring': TIER.PREMIUM },
  subaru: { 'premium': TIER.CHECK, 'touring': TIER.PREMIUM, 'base': TIER.BASE },
  mazda:  { 'sport': TIER.BASE, 'gt': TIER.PREMIUM },
  nissan: { 'sv': TIER.CHECK, 'sr': TIER.CHECK },
  toyota: { 'sr': TIER.BASE },
};

const PREMIUM_BRANDS = [
  'lexus', 'acura', 'infiniti', 'cadillac', 'lincoln',
  'bmw', 'mercedes', 'mercedes-benz', 'audi', 'volvo',
  'buick', 'porsche', 'jaguar', 'land rover', 'mini',
];

function getTrimTier(make, trim) {
  if (!trim || !trim.trim()) {
    return { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
  }
  const makeLower = (make || '').toLowerCase().trim();
  const trimLower = trim.toLowerCase().trim();
  const isPremiumBrand = PREMIUM_BRANDS.includes(makeLower);

  let result = null;

  if (makeLower && MAKE_TRIM_OVERRIDES[makeLower]) {
    const override = MAKE_TRIM_OVERRIDES[makeLower][trimLower];
    if (override !== undefined) result = tierToResult(override);
  }
  if (!result && TRIM_TIERS[trimLower] !== undefined) result = tierToResult(TRIM_TIERS[trimLower]);

  if (!result) {
    const sortedKeys = Object.keys(TRIM_TIERS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      const pattern = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(trimLower)) {
        if (makeLower && MAKE_TRIM_OVERRIDES[makeLower]?.[key] !== undefined) {
          result = tierToResult(MAKE_TRIM_OVERRIDES[makeLower][key]);
        } else {
          result = tierToResult(TRIM_TIERS[key]);
        }
        break;
      }
    }
  }

  if (!result) result = { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };

  // Premium brand floor: never fully suppress trim-dependent parts
  if (isPremiumBrand && result.tier === 'BASE') {
    result = { tier: 'CHECK', multiplier: TIER.CHECK, badge: 'CHECK TRIM', color: 'yellow' };
  }

  return result;
}

function isTrimDependent(partType) {
  if (!partType) return false;
  const pt = partType.toLowerCase().trim();
  for (const universal of UNIVERSAL_PARTS) { if (pt.includes(universal)) return false; }
  for (const dep of TRIM_DEPENDENT_PARTS) { if (pt.includes(dep)) return true; }
  return false;
}

function getPartScoreMultiplier(make, trim, partType) {
  if (!isTrimDependent(partType)) {
    return { multiplier: 1.0, reason: 'universal', badge: null };
  }
  const { tier, multiplier, badge, color } = getTrimTier(make, trim);
  return { multiplier, reason: `trim-dependent (${tier})`, badge, color };
}

function tierToResult(multiplier) {
  if (multiplier === TIER.PERFORMANCE) return { tier: 'PERFORMANCE', multiplier: 1.3, badge: 'PERFORMANCE', color: 'orange' };
  if (multiplier === TIER.PREMIUM) return { tier: 'PREMIUM', multiplier: 1.0, badge: 'PREMIUM TRIM', color: 'green' };
  if (multiplier === TIER.BASE) return { tier: 'BASE', multiplier: 0.0, badge: 'BASE TRIM', color: 'red' };
  return { tier: 'CHECK', multiplier: 0.5, badge: 'CHECK TRIM', color: 'yellow' };
}

module.exports = {
  TRIM_TIERS, MAKE_TRIM_OVERRIDES, TRIM_DEPENDENT_PARTS, UNIVERSAL_PARTS,
  PREMIUM_BRANDS, TIER, getTrimTier, isTrimDependent, getPartScoreMultiplier,
};
