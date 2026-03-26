/**
 * DARKHAWK — Smart Query Builder + Relevance Scorer
 *
 * Combined module for DarkHawk's price check pipeline.
 *
 * What this does:
 *   1. Takes an eBay listing title
 *   2. Extracts: make, model, years, partType
 *   3. Builds an optimized eBay search query
 *   4. Scores scraped sold comps against the original listing for relevance
 *
 * Usage:
 *   const { buildSearchQuery, filterRelevantItems } = require('./smart-query-builder');
 *   const result = buildSearchQuery('Honda CR-V 2005-2006 ECU ECM Engine Module');
 *   const filtered = filterRelevantItems(result.parts, scrapedItems);
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
//  PART TYPE EXTRACTION
// ═══════════════════════════════════════════════════════════════

const PART_TYPES = [
  { pattern: /\b(ECU|ECM|PCM)\b/i, type: 'ECU ECM' },
  { pattern: /\bengine\s*(control|computer)\s*(module|unit)?\b/i, type: 'ECU ECM' },
  { pattern: /\b(TCM|TCU)\b/i, type: 'TCM transmission module' },
  { pattern: /\btransmission\s*(control|computer)\s*(module|unit)?\b/i, type: 'TCM transmission module' },
  { pattern: /\bthrottle\s*body\b/i, type: 'throttle body' },
  { pattern: /\b(MAF|mass\s*air\s*flow)\b/i, type: 'MAF mass air flow sensor' },
  { pattern: /\bTIPM\b/i, type: 'TIPM' },
  { pattern: /\b(fuse\s*box|relay\s*box|power\s*distribution)\b/i, type: 'fuse box' },
  { pattern: /\b(BCM|body\s*control\s*module)\b/i, type: 'BCM body control module' },
  { pattern: /\b(GEM|generic\s*electronic\s*module)\b/i, type: 'GEM module' },
  { pattern: /\bSAM\s*(module|relay|fuse)?\b/i, type: 'SAM module' },
  { pattern: /\binstrument\s*cluster\b/i, type: 'instrument cluster' },
  { pattern: /\bspeedometer\b/i, type: 'instrument cluster speedometer' },
  { pattern: /\bABS\b.*\b(pump|module|unit)\b/i, type: 'ABS module pump' },
  { pattern: /\banti[- ]?lock\s*brake\b/i, type: 'ABS module pump' },
  { pattern: /\bbrake\s*(booster|master)\b/i, type: 'brake booster' },
  { pattern: /\b(AC|A\/C|climate)\s*control\b/i, type: 'AC climate control' },
  { pattern: /\bheater\s*(control|module|panel)\b/i, type: 'heater control' },
  { pattern: /\bblower\s*motor\b/i, type: 'blower motor' },
  { pattern: /\bHVAC\s*(module|control)\b/i, type: 'HVAC module' },
  { pattern: /\bheadlight\s*(assembly)?\b/i, type: 'headlight' },
  { pattern: /\btail\s*light\b/i, type: 'tail light' },
  { pattern: /\bblind\s*spot\s*(sensor|monitor|module)\b/i, type: 'blind spot sensor' },
  { pattern: /\bparking\s*(sensor|assist)\b/i, type: 'parking sensor' },
  { pattern: /\b(backup|rear|reverse)\s*camera\b/i, type: 'backup camera' },
  { pattern: /\bliftgate\s*(module|motor|actuator|control)\b/i, type: 'liftgate module' },
  { pattern: /\btailgate\s*(module|motor|actuator|control)\b/i, type: 'tailgate module' },
  { pattern: /\bsteering\s*(module|control|angle|sensor)\b/i, type: 'steering module' },
  { pattern: /\bairbag\s*(module|sensor|SRS)\b/i, type: 'airbag module' },
  { pattern: /\bSRS\s*(module|sensor)\b/i, type: 'airbag module' },
  { pattern: /\bgear\s*(selector|shifter)\b/i, type: 'gear selector shifter' },
  { pattern: /\bignition\s*(switch|cylinder|lock)\b/i, type: 'ignition switch cylinder' },
  { pattern: /\b(HMI|multimedia)\s*(interface|module|control)?\b/i, type: 'HMI multimedia module' },
  { pattern: /\binfotainment\b/i, type: 'HMI multimedia module' },
  { pattern: /\bdisplay\s*(screen|unit|module)\b/i, type: 'display screen' },
  { pattern: /\bnavigation\s*(unit|module|system)?\b/i, type: 'navigation unit' },
  { pattern: /\bwiper\s*motor\b/i, type: 'wiper motor' },
  { pattern: /\bwindow\s*(motor|regulator)\b/i, type: 'window motor regulator' },
  { pattern: /\bpower\s*steering\s*(pump|motor)\b/i, type: 'power steering pump' },
  { pattern: /\bstarter\s*(motor)?\b/i, type: 'starter motor' },
  { pattern: /\balternator\b/i, type: 'alternator' },
  { pattern: /\bdoor\s*(lock\s*)?(motor|actuator)\b/i, type: 'door lock actuator' },
  { pattern: /\bseat\s*(motor|actuator)\b/i, type: 'seat motor' },
  { pattern: /\bsunroof\s*(motor|actuator)\b/i, type: 'sunroof motor' },
  { pattern: /\bamp(lifier)?\b/i, type: 'amplifier' },
  { pattern: /\bradio\b/i, type: 'radio' },
  { pattern: /\bstereo\b/i, type: 'stereo radio' },
  { pattern: /\binverter\b/i, type: 'inverter' },
  { pattern: /\bmirror\s*(assembly)?\b/i, type: 'mirror' },
  { pattern: /\bsensor\b/i, type: 'sensor' },
];

// ═══════════════════════════════════════════════════════════════
//  MAKE / MODEL EXTRACTION
// ═══════════════════════════════════════════════════════════════

const MAKES = [
  'Honda', 'Toyota', 'Ford', 'Chevrolet', 'Chevy', 'Dodge', 'Jeep', 'Chrysler',
  'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'VW', 'Nissan', 'Mazda', 'Subaru',
  'Hyundai', 'Kia', 'Mitsubishi', 'Lexus', 'Acura', 'Infiniti', 'Cadillac',
  'Buick', 'GMC', 'Lincoln', 'Mercury', 'Pontiac', 'Saturn', 'Oldsmobile',
  'Ram', 'Volvo', 'Saab', 'Jaguar', 'Land Rover', 'Mini', 'Porsche', 'Fiat',
];

const BMW_MODELS = {
  '323i': '3-series', '325i': '3-series', '328i': '3-series', '330i': '3-series', '335i': '3-series',
  '525i': '5-series', '528i': '5-series', '530i': '5-series', '535i': '5-series', '540i': '5-series',
  'X3': 'X3', 'X5': 'X5', 'X6': 'X6',
};

const NOISE_WORDS = [
  'oem', 'genuine', 'new', 'used', 'programmed', 'tested', 'working', 'good',
  'assembly', 'module', 'unit', 'part', 'auto', 'car', 'truck', 'vehicle',
  'for', 'fits', 'and', 'the', 'with', 'or', 'a', 'an', 'to', 'from',
];

function extractPartType(title) {
  for (const { pattern, type } of PART_TYPES) {
    if (pattern.test(title)) return type;
  }
  return null;
}

function extractMake(title) {
  for (const make of MAKES) {
    if (new RegExp(`\\b${make}\\b`, 'i').test(title)) return make;
  }
  return null;
}

function extractModel(title, make) {
  if (!title) return null;
  if (make && make.toLowerCase() === 'bmw') {
    for (const [variant, series] of Object.entries(BMW_MODELS)) {
      if (title.includes(variant)) return series;
    }
    const chassis = title.match(/\b(E[0-9]{2}|F[0-9]{2}|G[0-9]{2})\b/i);
    if (chassis) return chassis[1].toUpperCase();
  }
  const modelPatterns = [
    /\b(CR-V|CRV|Civic|Accord|Pilot|Odyssey|Fit|HR-V|Element|Ridgeline|Insight)\b/i,
    /\b(Camry|Corolla|RAV4|Highlander|Tacoma|Tundra|4Runner|Prius|Sienna|Avalon|Yaris|Supra)\b/i,
    /\b(F-?150|F-?250|F-?350|Explorer|Escape|Mustang|Focus|Fusion|Edge|Expedition|Ranger|Bronco|E-?[0-9]{3}|Econoline)\b/i,
    /\b(RAM|Charger|Challenger|Durango|Dakota|Caravan|Journey|Nitro|Avenger|Magnum)\b/i,
    /\b(Wrangler|Cherokee|Grand Cherokee|Commander|Liberty|Compass|Patriot|Renegade|Gladiator)\b/i,
    /\b(PT Cruiser|300|Town & Country|Pacifica|Sebring|200|Crossfire)\b/i,
    /\b(Silverado|Tahoe|Suburban|Equinox|Traverse|Malibu|Impala|Cruze|Camaro|Corvette|Colorado|Trailblazer|Blazer|Sierra|Yukon|Acadia|Terrain)\b/i,
    /\b(Mazda\s*[2356]|MX-?5|Miata|CX-?[357]|CX-?[39]0?|RX-?[78]|Tribute|MPV)\b/i,
    /\b(Elantra|Sonata|Tucson|Santa Fe|Veloster|Accent|Genesis|Palisade|Kona|Ioniq)\b/i,
    /\b(Rio|Optima|Sorento|Sportage|Soul|Forte|Telluride|Stinger|Seltos|Carnival|Sedona)\b/i,
    /\b(Outlander|Lancer|Eclipse|Galant|Montero|Endeavor|Mirage|Pajero)\b/i,
    /\b(Altima|Maxima|Sentra|Rogue|Murano|Pathfinder|Frontier|Titan|Xterra|Versa|370Z|350Z|GT-R)\b/i,
    /\b(Outback|Forester|Impreza|WRX|Legacy|Crosstrek|Ascent|BRZ)\b/i,
    /\b(Jetta|Passat|Golf|Tiguan|Atlas|Beetle|GTI|Touareg|CC)\b/i,
    /\b(A[3-8]|Q[357]|S[3-8]|RS[3-7]|TT|R8|e-tron)\b/i,
    /\b([A-Z]-?Class|[CES][0-9]{3}|GL[ABCEKS]?|ML[0-9]{3}|SL[KS]?|AMG|Sprinter)\b/i,
    /\b(Cayenne|911|Boxster|Cayman|Panamera|Macan|Taycan)\b/i,
    /\b(TL|TSX|MDX|RDX|ILX|TLX|NSX|Integra|RSX|Legend)\b/i,
    /\b(G[0-9]{2}|Q[0-9]{2}|QX[0-9]{2}|FX[0-9]{2}|EX[0-9]{2}|M[0-9]{2})\b/i,
  ];
  for (const pattern of modelPatterns) {
    const match = title.match(pattern);
    if (match) {
      if (make && match[1].toLowerCase() === make.toLowerCase()) continue;
      return match[1];
    }
  }
  return null;
}

function extractYears(title) {
  const dashRange = title.match(/\b((?:19|20)\d{2})[-]((?:19|20)?\d{2})\b/);
  if (dashRange) {
    const startYear = dashRange[1];
    let endYear = dashRange[2];
    if (endYear.length === 2) endYear = startYear.substring(0, 2) + endYear;
    const start = parseInt(startYear), end = parseInt(endYear);
    if (end >= start && end - start <= 20 && start >= 1990 && end <= 2030) return `${startYear}-${endYear}`;
  }
  const spaceRange = title.match(/\b((?:19|20)\d{2})\s+((?:19|20)\d{2})\b/);
  if (spaceRange) {
    const start = parseInt(spaceRange[1]), end = parseInt(spaceRange[2]);
    if (end > start && end - start <= 5) return `${spaceRange[1]}-${spaceRange[2]}`;
  }
  const yearMatches = title.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    const valid = yearMatches.filter(y => { const n = parseInt(y); return n >= 1990 && n <= 2030; });
    if (valid.length > 0) return valid[0];
  }
  return null;
}

function extractDescriptiveWords(title, make, model) {
  const cleaned = title.replace(/\b(19|20)\d{2}[-\s]*(19|20)?\d{2,4}\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[,()[\]{}'"]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  const makeLower = make?.toLowerCase();
  const modelLower = model?.toLowerCase();
  const PART_DESCRIPTORS = ['motor','pump','sensor','switch','relay','fuse','valve','actuator','control','computer','controller','regulator','solenoid','coil','injector','compressor','condenser','radiator','fan','alternator','starter','caliper','rotor','bearing','hub','rack','harness','antenna','speaker','amplifier','radio','stereo','display','screen','camera','navigation','headlight','taillight','wiper','cluster','speedometer','airbag','sunroof','liftgate','tailgate','mirror'];
  const descriptive = words.filter(word => {
    if (NOISE_WORDS.includes(word)) return false;
    if (word === makeLower || word === modelLower) return false;
    if (/\d/.test(word) && /[a-z]/i.test(word) && word.length > 5) return false;
    if (/^\d+$/.test(word)) return false;
    return true;
  });
  const prioritized = descriptive.sort((a, b) => (PART_DESCRIPTORS.includes(a) ? 0 : 1) - (PART_DESCRIPTORS.includes(b) ? 0 : 1));
  return prioritized.slice(0, 3).join(' ') || null;
}

// ═══════════════════════════════════════════════════════════════
//  BUILD SEARCH QUERY
// ═══════════════════════════════════════════════════════════════

function buildSearchQuery(title) {
  const partType = extractPartType(title);
  const make = extractMake(title);
  const model = extractModel(title, make);
  const years = extractYears(title);
  const parts = [];
  if (make) parts.push(make);
  if (model) parts.push(model);
  if (years) parts.push(years);
  let descriptiveWords = null;
  if (partType) { parts.push(partType); }
  else if (make || model) { descriptiveWords = extractDescriptiveWords(title, make, model); if (descriptiveWords) parts.push(descriptiveWords); }
  if (parts.length < 2) {
    const fallback = title.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').toLowerCase().split(' ').filter(w => w.length > 2 && !NOISE_WORDS.includes(w)).slice(0, 6).join(' ');
    return { query: fallback, structured: false, parts: {} };
  }
  return { query: parts.join(' ').toLowerCase(), structured: true, parts: { make, model, years, partType: partType || descriptiveWords, isInferredPartType: !partType && !!descriptiveWords } };
}

// ═══════════════════════════════════════════════════════════════
//  RELEVANCE SCORING
// ═══════════════════════════════════════════════════════════════

function parseYearRange(yearStr) {
  if (!yearStr) return null;
  if (yearStr.includes('-')) { const [s, e] = yearStr.split('-').map(y => parseInt(y)); return [s, e]; }
  const y = parseInt(yearStr); return [y, y];
}

function yearsOverlap(r1, r2) {
  if (!r1 || !r2) return false;
  return r1[0] <= r2[1] && r2[0] <= r1[1];
}

function normalizePartType(pt) {
  if (!pt) return null;
  return pt.toLowerCase().replace(/\s+/g, ' ').replace(/module|unit|assembly/g, '').trim();
}

function scoreRelevance(ourItem, scrapedItem) {
  const scraped = { title: scrapedItem.title, partType: extractPartType(scrapedItem.title), make: extractMake(scrapedItem.title), model: extractModel(scrapedItem.title, extractMake(scrapedItem.title)), years: extractYears(scrapedItem.title) };
  const breakdown = { partType: 0, make: 0, model: 0, years: 0 };
  const ourPart = normalizePartType(ourItem.partType);
  const scrapedPart = normalizePartType(scraped.partType);
  if (ourPart && scrapedPart) {
    if (ourPart === scrapedPart) breakdown.partType = 40;
    else if (ourPart.includes(scrapedPart) || scrapedPart.includes(ourPart)) breakdown.partType = 30;
    else { const overlap = ourPart.split(' ').filter(p => scrapedPart.split(' ').includes(p)); if (overlap.length > 0) breakdown.partType = 20; }
  }
  if (ourItem.make && scraped.make && ourItem.make.toLowerCase() === scraped.make.toLowerCase()) breakdown.make = 25;
  if (ourItem.model && scraped.model) {
    const a = ourItem.model.toLowerCase().replace(/[-\s]/g, ''), b = scraped.model.toLowerCase().replace(/[-\s]/g, '');
    if (a === b) breakdown.model = 20; else if (a.includes(b) || b.includes(a)) breakdown.model = 15;
  }
  const ourYears = parseYearRange(ourItem.years), scrapedYears = parseYearRange(scraped.years);
  if (yearsOverlap(ourYears, scrapedYears)) breakdown.years = 15;
  else if (ourYears && scrapedYears && Math.abs(ourYears[0] - scrapedYears[0]) <= 2) breakdown.years = 8;
  const score = breakdown.partType + breakdown.make + breakdown.model + breakdown.years;
  const isRelevant = breakdown.partType >= 30 && (breakdown.make >= 25 || (breakdown.model >= 15 && breakdown.years >= 8));
  return { score, breakdown, isRelevant, extracted: scraped };
}

function filterRelevantItems(ourItem, scrapedItems) {
  const scored = scrapedItems.map(item => ({ ...item, relevance: scoreRelevance(ourItem, item) }));
  const relevant = scored.filter(item => item.relevance.isRelevant);
  relevant.sort((a, b) => b.relevance.score - a.relevance.score);
  return { total: scrapedItems.length, relevant: relevant.length, filtered: scrapedItems.length - relevant.length, items: relevant, avgScore: relevant.length > 0 ? relevant.reduce((sum, i) => sum + i.relevance.score, 0) / relevant.length : 0 };
}

module.exports = { buildSearchQuery, extractPartType, extractMake, extractModel, extractYears, scoreRelevance, filterRelevantItems };
