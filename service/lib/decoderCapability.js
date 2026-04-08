'use strict';

/**
 * Per-make decoder capability profile + named engine table + part type ceilings.
 * Built from SCORING_CALIBRATION_DATA.md Section 6 production data (2026-04-08).
 * Reliable = coverage >= 60% for that signal on that make.
 */

// Per-make signal reliability (from production yard_vehicle data)
const MAKE_CAPABILITY = {
  'FORD':           { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'CHEVROLET':      { engine: true, trim: true,  drivetrain: false, transmission: true },
  'NISSAN':         { engine: true, trim: false,  drivetrain: true,  transmission: true },
  'HONDA':          { engine: true, trim: true,  drivetrain: false, transmission: true },
  'TOYOTA':         { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'DODGE':          { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'HYUNDAI':        { engine: true, trim: true,  drivetrain: false, transmission: true },
  'KIA':            { engine: true, trim: true,  drivetrain: false, transmission: true },
  'JEEP':           { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'CHRYSLER':       { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'GMC':            { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'VOLKSWAGEN':     { engine: true, trim: true,  drivetrain: false, transmission: true },
  'BUICK':          { engine: true, trim: true,  drivetrain: false, transmission: true },
  'MERCEDES-BENZ':  { engine: true, trim: false, drivetrain: false, transmission: true },
  'BMW':            { engine: true, trim: true,  drivetrain: false, transmission: true },
  'MAZDA':          { engine: true, trim: true,  drivetrain: false, transmission: true },
  'CADILLAC':       { engine: true, trim: false, drivetrain: false, transmission: true },
  'INFINITI':       { engine: true, trim: false, drivetrain: true,  transmission: true },
  'ACURA':          { engine: true, trim: true,  drivetrain: false, transmission: true },
  'LEXUS':          { engine: true, trim: false, drivetrain: true,  transmission: true },
  'LINCOLN':        { engine: true, trim: false, drivetrain: false, transmission: true },
  'PONTIAC':        { engine: true, trim: true,  drivetrain: false, transmission: true },
  'MERCURY':        { engine: true, trim: true,  drivetrain: false, transmission: true },
  'MITSUBISHI':     { engine: true, trim: false, drivetrain: false, transmission: true },
  'SUBARU':         { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'RAM':            { engine: true, trim: true,  drivetrain: true,  transmission: true },
  'SATURN':         { engine: true, trim: true,  drivetrain: false, transmission: true },
  'SUZUKI':         { engine: true, trim: false, drivetrain: false, transmission: true },
  'SCION':          { engine: true, trim: true,  drivetrain: false, transmission: true },
};

function isReliable(make, signal) {
  const cap = MAKE_CAPABILITY[(make || '').toUpperCase()];
  if (!cap) return true; // unknown make, assume reliable
  return cap[signal] !== false;
}

// Named engine table -- engine names to make families + displacement ranges
const NAMED_ENGINES = {
  'HEMI':          { makes: ['DODGE', 'RAM', 'CHRYSLER', 'JEEP'], displacements: [5.7, 6.1, 6.2, 6.4] },
  'ECOBOOST':      { makes: ['FORD', 'LINCOLN'], displacements: [1.0, 1.5, 1.6, 2.0, 2.3, 2.7, 3.5] },
  'COYOTE':        { makes: ['FORD'], displacements: [5.0] },
  'PENTASTAR':     { makes: ['DODGE', 'RAM', 'CHRYSLER', 'JEEP'], displacements: [3.6] },
  'TRITON':        { makes: ['FORD'], displacements: [4.6, 5.4, 6.8] },
  'VORTEC':        { makes: ['CHEVROLET', 'GMC'], displacements: [4.3, 4.8, 5.3, 6.0, 6.2] },
  'CUMMINS':       { makes: ['DODGE', 'RAM'], displacements: [5.9, 6.7], diesel: true },
  'DURAMAX':       { makes: ['CHEVROLET', 'GMC'], displacements: [6.6], diesel: true },
  'POWER STROKE':  { makes: ['FORD'], displacements: [6.0, 6.4, 6.7, 7.3], diesel: true },
  'POWERSTROKE':   { makes: ['FORD'], displacements: [6.0, 6.4, 6.7, 7.3], diesel: true },
  'TDI':           { makes: ['VOLKSWAGEN', 'AUDI'], displacements: [1.9, 2.0, 3.0], diesel: true },
  'MAGNUM':        { makes: ['DODGE', 'RAM', 'CHRYSLER'], displacements: [3.9, 5.2, 5.9] },
  'MULTIAIR':      { makes: ['FIAT', 'JEEP', 'DODGE', 'CHRYSLER'], displacements: [1.4, 2.4] },
};

const NAMED_ENGINE_REGEX = /\b(HEMI|ECOBOOST|COYOTE|PENTASTAR|TRITON|VORTEC|CUMMINS|DURAMAX|POWER\s*STROKE|POWERSTROKE|TDI|MAGNUM|MULTIAIR)\b/i;

function detectNamedEngine(title) {
  if (!title) return null;
  const m = title.match(NAMED_ENGINE_REGEX);
  return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

// Part type score ceilings -- cap how high a score can go per type
const PART_TYPE_CEILINGS = {
  ECM: 85, PCM: 85, ECU: 85,
  TCM: 85, TCU: 85,
  ABS: 90,
  BCM: 80, TIPM: 80, CLUSTER: 80, FUSE: 80,
  AMP: 100, RADIO: 100, NAV: 100,
  THROTTLE: 90,
};
const DEFAULT_CEILING = 65; // OTHER part types

function getCeiling(partType, hasPremiumBrand) {
  if (partType && PART_TYPE_CEILINGS[partType] !== undefined) {
    // AMP/RADIO/NAV without premium brand capped lower
    if ((partType === 'AMP' || partType === 'RADIO' || partType === 'NAV') && !hasPremiumBrand) {
      return 75;
    }
    return PART_TYPE_CEILINGS[partType];
  }
  return DEFAULT_CEILING;
}

module.exports = {
  MAKE_CAPABILITY,
  isReliable,
  NAMED_ENGINES,
  detectNamedEngine,
  PART_TYPE_CEILINGS,
  getCeiling,
};
