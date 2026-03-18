'use strict';

/**
 * Smart Query Builder for eBay Sold Items Search
 *
 * The goal: Build a search query that finds COMPARABLE items
 *
 * Priority order:
 * 1. PART TYPE (ECU, ABS, throttle body, TIPM, etc.) - MOST IMPORTANT
 * 2. MAKE (Honda, Ford, BMW, etc.)
 * 3. MODEL (CR-V, Explorer, 323i, etc.) - but simplified
 * 4. YEAR RANGE (2005-2006, 1999-2000, etc.)
 *
 * What to AVOID:
 * - Multiple model variants (323i 328i 528i → just use 3-series or E46)
 * - Marketing words (programmed, OEM, genuine, tested)
 * - Generic words (module, assembly, unit)
 */

// Part type patterns - order matters (more specific first)
const PART_TYPES = [
  // Engine/Powertrain
  { pattern: /\b(ECU|ECM|PCM)\b/i, type: 'ECU ECM' },
  { pattern: /\bengine\s*(control|computer)\s*(module|unit)?\b/i, type: 'ECU ECM' },
  { pattern: /\b(TCM|TCU)\b/i, type: 'TCM transmission module' },
  { pattern: /\btransmission\s*(control|computer)\s*(module|unit)?\b/i, type: 'TCM transmission module' },
  { pattern: /\bthrottle\s*body\b/i, type: 'throttle body' },
  { pattern: /\b(MAF|mass\s*air\s*flow)\b/i, type: 'MAF mass air flow sensor' },

  // Electrical/Body
  { pattern: /\bTIPM\b/i, type: 'TIPM' },
  { pattern: /\b(fuse\s*box|relay\s*box|power\s*distribution)\b/i, type: 'fuse box' },
  { pattern: /\b(BCM|body\s*control\s*module)\b/i, type: 'BCM body control module' },
  { pattern: /\b(GEM|generic\s*electronic\s*module)\b/i, type: 'GEM module' },
  { pattern: /\bSAM\s*(module|relay|fuse)?\b/i, type: 'SAM module' },
  { pattern: /\binstrument\s*cluster\b/i, type: 'instrument cluster' },
  { pattern: /\bspeedometer\b/i, type: 'instrument cluster speedometer' },

  // Brakes/Suspension
  { pattern: /\bABS\b.*\b(pump|module|unit)\b/i, type: 'ABS module pump' },
  { pattern: /\banti[- ]?lock\s*brake\b/i, type: 'ABS module pump' },
  { pattern: /\bbrake\s*(booster|master)\b/i, type: 'brake booster' },

  // HVAC
  { pattern: /\b(AC|A\/C|climate)\s*control\b/i, type: 'AC climate control' },
  { pattern: /\bheater\s*(control|module|panel)\b/i, type: 'heater control' },
  { pattern: /\bblower\s*motor\b/i, type: 'blower motor' },

  // Lighting
  { pattern: /\bheadlight\s*(assembly)?\b/i, type: 'headlight' },
  { pattern: /\btail\s*light\b/i, type: 'tail light' },

  // Drivetrain/Transmission
  { pattern: /\bgear\s*(selector|shifter)\b/i, type: 'gear selector shifter' },
  { pattern: /\bshift(er)?\s*(assembly|lever|knob)?\b/i, type: 'gear selector shifter' },

  // Ignition/Locks
  { pattern: /\bignition\s*(switch|cylinder|lock)\b/i, type: 'ignition switch cylinder' },
  { pattern: /\bcylinder\s*lock\b/i, type: 'ignition switch cylinder' },
  { pattern: /\block\s*cylinder\b/i, type: 'ignition switch cylinder' },

  // Infotainment/Electronics
  { pattern: /\b(HMI|multimedia)\s*(interface|module|control)?\b/i, type: 'HMI multimedia module' },
  { pattern: /\binfotainment\b/i, type: 'HMI multimedia module' },
  { pattern: /\bdisplay\s*(screen|unit|module)\b/i, type: 'display screen' },
  { pattern: /\bnavigation\s*(unit|module|system)?\b/i, type: 'navigation unit' },

  // Motors/Mechanical
  { pattern: /\bwiper\s*motor\b/i, type: 'wiper motor' },
  { pattern: /\bwindshield\s*wiper\s*motor\b/i, type: 'wiper motor' },
  { pattern: /\bwindow\s*(motor|regulator)\b/i, type: 'window motor regulator' },
  { pattern: /\bpower\s*steering\s*(pump|motor)\b/i, type: 'power steering pump' },
  { pattern: /\bstarter\s*(motor)?\b/i, type: 'starter motor' },
  { pattern: /\balternator\b/i, type: 'alternator' },
  { pattern: /\bconvertible\s*top\b/i, type: 'convertible top motor' },
  { pattern: /\bsoft\s*top\s*(motor|lift|pump)\b/i, type: 'convertible top motor' },
  { pattern: /\btop\s*lift\s*motor\b/i, type: 'convertible top motor' },
  { pattern: /\btrunk\s*(lid\s*)?(motor|actuator|latch)\b/i, type: 'trunk motor latch' },
  { pattern: /\bliftgate\s*(motor|strut|actuator)\b/i, type: 'liftgate motor' },
  { pattern: /\btailgate\s*(motor|strut|actuator)\b/i, type: 'tailgate motor' },
  { pattern: /\bdoor\s*(lock\s*)?(motor|actuator)\b/i, type: 'door lock actuator' },
  { pattern: /\bseat\s*(motor|actuator)\b/i, type: 'seat motor' },
  { pattern: /\bsunroof\s*(motor|actuator)\b/i, type: 'sunroof motor' },
  { pattern: /\bmoonroof\s*(motor|actuator)\b/i, type: 'sunroof motor' },

  // Other
  { pattern: /\bamp(lifier)?\b/i, type: 'amplifier' },
  { pattern: /\bradio\b/i, type: 'radio' },
  { pattern: /\bstereo\b/i, type: 'stereo radio' },
  { pattern: /\binverter\b/i, type: 'inverter' },
  { pattern: /\bconverter\b/i, type: 'converter' },
  { pattern: /\bmirror\s*(assembly)?\b/i, type: 'mirror' },
  { pattern: /\bsensor\b/i, type: 'sensor' },
];

// Known makes with common model simplifications
const MAKES = [
  'Honda', 'Toyota', 'Ford', 'Chevrolet', 'Chevy', 'Dodge', 'Jeep', 'Chrysler',
  'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'VW', 'Nissan', 'Mazda', 'Subaru',
  'Hyundai', 'Kia', 'Mitsubishi', 'Lexus', 'Acura', 'Infiniti', 'Cadillac',
  'Buick', 'GMC', 'Lincoln', 'Mercury', 'Pontiac', 'Saturn', 'Oldsmobile',
  'Ram', 'Volvo', 'Saab', 'Jaguar', 'Land Rover', 'Mini', 'Porsche', 'Fiat',
];

// BMW model simplification
const BMW_MODELS = {
  '323i': '3-series', '325i': '3-series', '328i': '3-series', '330i': '3-series', '335i': '3-series',
  '525i': '5-series', '528i': '5-series', '530i': '5-series', '535i': '5-series', '540i': '5-series',
  'X3': 'X3', 'X5': 'X5', 'X6': 'X6',
};

// Words to always remove
const NOISE_WORDS = [
  'oem', 'genuine', 'new', 'used', 'programmed', 'tested', 'working', 'good',
  'assembly', 'module', 'unit', 'part', 'auto', 'car', 'truck', 'vehicle',
  'for', 'fits', 'and', 'the', 'with', 'or', 'a', 'an', 'to', 'from',
];

// Words that are likely part descriptions (nouns we want to keep)
const PART_DESCRIPTOR_WORDS = [
  'motor', 'pump', 'sensor', 'switch', 'relay', 'fuse', 'valve', 'actuator',
  'control', 'computer', 'controller', 'regulator', 'solenoid', 'coil',
  'injector', 'compressor', 'condenser', 'evaporator', 'radiator', 'fan',
  'belt', 'pulley', 'tensioner', 'bracket', 'mount', 'hose', 'pipe', 'tube',
  'cover', 'lid', 'cap', 'door', 'panel', 'trim', 'bezel', 'grille', 'bumper',
  'mirror', 'glass', 'handle', 'latch', 'lock', 'hinge', 'strut', 'spring',
  'shock', 'arm', 'link', 'bar', 'rod', 'shaft', 'axle', 'bearing', 'hub',
  'caliper', 'rotor', 'pad', 'drum', 'cylinder', 'master', 'slave', 'booster',
  'rack', 'pinion', 'gear', 'transmission', 'transfer', 'differential',
  'intake', 'exhaust', 'manifold', 'header', 'catalytic', 'muffler', 'resonator',
  'filter', 'cleaner', 'box', 'housing', 'case', 'body', 'block', 'head',
  'gasket', 'seal', 'oring', 'clamp', 'clip', 'bolt', 'nut', 'screw',
  'wiring', 'harness', 'connector', 'plug', 'socket', 'terminal', 'ground',
  'antenna', 'speaker', 'amplifier', 'radio', 'stereo', 'display', 'screen',
  'camera', 'navigation', 'gps', 'bluetooth', 'usb', 'aux', 'cd', 'dvd',
  'headlight', 'taillight', 'foglight', 'signal', 'marker', 'bulb', 'led',
  'wiper', 'washer', 'nozzle', 'reservoir', 'tank', 'bottle', 'canister',
  'pedal', 'lever', 'knob', 'button', 'dial', 'gauge', 'cluster', 'speedometer',
  'tachometer', 'odometer', 'fuel', 'temperature', 'pressure', 'level',
  'airbag', 'seatbelt', 'pretensioner', 'buckle', 'retractor',
  'sunroof', 'moonroof', 'convertible', 'top', 'roof', 'soft', 'hard',
  'trunk', 'hood', 'tailgate', 'liftgate', 'hatch', 'gate',
  'window', 'windshield', 'rear', 'front', 'side', 'driver', 'passenger',
  'left', 'right', 'upper', 'lower', 'inner', 'outer', 'center', 'middle',
  'electric', 'electronic', 'power', 'manual', 'automatic', 'hybrid',
  'abs', 'ecu', 'ecm', 'pcm', 'tcm', 'bcm', 'tipm', 'gem', 'sam',
  'ac', 'hvac', 'climate', 'heater', 'blower', 'vent', 'duct',
  'key', 'ignition', 'immobilizer', 'transponder', 'remote', 'fob',
  'steering', 'column', 'wheel', 'tilt', 'telescopic', 'clock',
];

/**
 * Extract part type from title
 */
function extractPartType(title) {
  for (const { pattern, type } of PART_TYPES) {
    if (pattern.test(title)) {
      return type;
    }
  }
  return null;
}

/**
 * Extract descriptive words from title when part type is unknown
 * This is our fallback to handle categories we don't explicitly know
 */
function extractDescriptiveWords(title, make, model) {
  // Clean the title - remove year ranges first
  const cleanedTitle = title
    .replace(/\b(19|20)\d{2}[-\s]*(19|20)?\d{2,4}\b/g, ' ')  // Remove year ranges like 2004-2009
    .replace(/\b(19|20)\d{2}\b/g, ' ')  // Remove single years
    .replace(/[,()[\]{}'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  const words = cleanedTitle.split(' ').filter(w => w.length > 2);

  // Remove make, model, and noise words
  const makeLower = make?.toLowerCase();
  const modelLower = model?.toLowerCase();

  const descriptive = words.filter(word => {
    // Skip noise words
    if (NOISE_WORDS.includes(word)) return false;
    // Skip make/model
    if (word === makeLower || word === modelLower) return false;
    // Skip part numbers (alphanumeric patterns like AB123CD or 123ABC)
    if (/\d/.test(word) && /[a-z]/i.test(word) && word.length > 5) return false;
    // Skip pure numbers
    if (/^\d+$/.test(word)) return false;
    return true;
  });

  // Prioritize known part descriptor words, then take others
  const prioritized = [];
  const others = [];

  for (const word of descriptive) {
    if (PART_DESCRIPTOR_WORDS.includes(word)) {
      prioritized.push(word);
    } else {
      others.push(word);
    }
  }

  // Return up to 4 most relevant words (prioritized first)
  return [...prioritized, ...others].slice(0, 4).join(' ');
}

/**
 * Extract make from title (whole word match only)
 */
function extractMake(title) {
  const titleLower = title.toLowerCase();
  for (const make of MAKES) {
    // Use word boundary regex to avoid matching "Ram" in "Programmed"
    const pattern = new RegExp(`\\b${make.toLowerCase()}\\b`);
    if (pattern.test(titleLower)) {
      return make;
    }
  }
  return null;
}

/**
 * Extract model from title (simplified)
 */
function extractModel(title, make) {
  // For BMW, simplify to series
  if (make && make.toLowerCase() === 'bmw') {
    for (const [model, series] of Object.entries(BMW_MODELS)) {
      if (title.includes(model)) {
        return series;
      }
    }
    // BMW chassis codes
    const bmwChassis = title.match(/\b(E[0-9]{2}|F[0-9]{2}|G[0-9]{2})\b/i);
    if (bmwChassis) return bmwChassis[1].toUpperCase();
  }

  // Common model patterns by make - order matters (specific patterns first)
  const modelPatterns = [
    // Honda
    /\b(CR-V|CRV|Civic|Accord|Pilot|Odyssey|Fit|HR-V|Element|Ridgeline|Insight)\b/i,
    // Toyota
    /\b(Camry|Corolla|RAV4|Highlander|Tacoma|Tundra|4Runner|Prius|Sienna|Avalon|Yaris|Supra)\b/i,
    // Ford
    /\b(F-?150|F-?250|F-?350|Explorer|Escape|Mustang|Focus|Fusion|Edge|Expedition|Ranger|Bronco|E-?[0-9]{3}|E[0-9]{3}|Econoline|Van)\b/i,
    // Dodge/Ram
    /\b(RAM|Charger|Challenger|Durango|Dakota|Caravan|Journey|Nitro|Avenger|Magnum)\b/i,
    // Jeep
    /\b(Wrangler|Cherokee|Grand Cherokee|Commander|Liberty|Compass|Patriot|Renegade|Gladiator)\b/i,
    // Chrysler
    /\b(PT Cruiser|300|Town & Country|Pacifica|Sebring|200|Crossfire)\b/i,
    // Chevrolet/GMC
    /\b(Silverado|Tahoe|Suburban|Equinox|Traverse|Malibu|Impala|Cruze|Camaro|Corvette|Colorado|Trailblazer|Blazer|Sierra|Yukon|Acadia|Terrain)\b/i,
    // Mazda
    /\b(Mazda\s*[2356]|MX-?5|Miata|CX-?[357]|CX-?[39]0?|RX-?[78]|Tribute|MPV)\b/i,
    // Hyundai
    /\b(Elantra|Sonata|Tucson|Santa Fe|Veloster|Accent|Genesis|Palisade|Kona|Ioniq)\b/i,
    // Kia
    /\b(Rio|Optima|Sorento|Sportage|Soul|Forte|Telluride|Stinger|Seltos|Carnival|Sedona)\b/i,
    // Mitsubishi
    /\b(Outlander|Lancer|Eclipse|Galant|Montero|Endeavor|Mirage|Pajero)\b/i,
    // Nissan
    /\b(Altima|Maxima|Sentra|Rogue|Murano|Pathfinder|Frontier|Titan|Xterra|Versa|370Z|350Z|GT-R)\b/i,
    // Subaru
    /\b(Outback|Forester|Impreza|WRX|Legacy|Crosstrek|Ascent|BRZ)\b/i,
    // Volkswagen
    /\b(Jetta|Passat|Golf|Tiguan|Atlas|Beetle|GTI|Touareg|CC)\b/i,
    // Audi
    /\b(A[3-8]|Q[357]|S[3-8]|RS[3-7]|TT|R8|e-tron)\b/i,
    // Mercedes
    /\b([A-Z]-?Class|[CES][0-9]{3}|GL[ABCEKS]?|ML[0-9]{3}|SL[KS]?|AMG|Sprinter)\b/i,
    // Porsche
    /\b(Cayenne|911|Boxster|Cayman|Panamera|Macan|Taycan)\b/i,
    // Lexus
    /\b([GILNR][SXCT][0-9]{3}|ES|IS|GS|LS|NX|RX|GX|LX|UX)\b/i,
    // Acura
    /\b(TL|TSX|MDX|RDX|ILX|TLX|NSX|Integra|RSX|Legend)\b/i,
    // Infiniti
    /\b(G[0-9]{2}|Q[0-9]{2}|QX[0-9]{2}|FX[0-9]{2}|EX[0-9]{2}|JX[0-9]{2}|M[0-9]{2})\b/i,
  ];

  for (const pattern of modelPatterns) {
    const match = title.match(pattern);
    if (match) {
      // Don't return the make as the model
      const model = match[1];
      if (make && model.toLowerCase() === make.toLowerCase()) {
        continue;
      }
      return model;
    }
  }

  return null;
}

/**
 * Extract year or year range
 */
function extractYears(title) {
  // Year range pattern: 2005-2006, 2005-06
  const dashRangeMatch = title.match(/\b((?:19|20)\d{2})[-]((?:19|20)?\d{2})\b/);
  if (dashRangeMatch) {
    const startYear = dashRangeMatch[1];
    let endYear = dashRangeMatch[2];
    // Handle 2-digit end year (2005-06 -> 2005-2006)
    if (endYear.length === 2) {
      const century = startYear.substring(0, 2);
      endYear = century + endYear;
    }
    // Validate it's a reasonable range (not model numbers like 2500-3500)
    const start = parseInt(startYear);
    const end = parseInt(endYear);
    if (end >= start && end - start <= 20 && start >= 1990 && end <= 2030) {
      return `${startYear}-${endYear}`;
    }
  }

  // Two consecutive years with space: 1999 2000
  const spaceRangeMatch = title.match(/\b((?:19|20)\d{2})\s+((?:19|20)\d{2})\b/);
  if (spaceRangeMatch) {
    const start = parseInt(spaceRangeMatch[1]);
    const end = parseInt(spaceRangeMatch[2]);
    // Must be consecutive or close years
    if (end > start && end - start <= 5) {
      return `${spaceRangeMatch[1]}-${spaceRangeMatch[2]}`;
    }
  }

  // Single year pattern (but not model numbers like 2500)
  const yearMatches = title.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches) {
    // Filter to valid years (1990-2030)
    const validYears = yearMatches.filter(y => {
      const num = parseInt(y);
      return num >= 1990 && num <= 2030;
    });
    if (validYears.length > 0) {
      return validYears[0];
    }
  }

  return null;
}

/**
 * Build optimized search query from title
 */
function buildSearchQuery(title) {
  const partType = extractPartType(title);
  const make = extractMake(title);
  const model = extractModel(title, make);
  const years = extractYears(title);

  // Build query with priority: make + model + year + part type
  const parts = [];

  if (make) parts.push(make);
  if (model) parts.push(model);
  if (years) parts.push(years);

  // If we have a known part type, use it
  // Otherwise, extract descriptive words as fallback
  let descriptiveWords = null;
  if (partType) {
    parts.push(partType);
  } else if (make || model) {
    // We have vehicle info but no recognized part type
    // Extract descriptive words from the title as fallback
    descriptiveWords = extractDescriptiveWords(title, make, model);
    if (descriptiveWords) {
      parts.push(descriptiveWords);
    }
  }

  // If we couldn't extract any structured data, fall back to cleaned title
  if (parts.length < 2) {
    const fallback = title
      .replace(/[,()]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .split(' ')
      .filter(w => w.length > 2 && !NOISE_WORDS.includes(w))
      .slice(0, 6)
      .join(' ');
    return { query: fallback, structured: false, parts: {} };
  }

  return {
    query: parts.join(' ').toLowerCase(),
    structured: true,
    parts: {
      make,
      model,
      years,
      partType: partType || descriptiveWords,  // Use descriptive words as partType fallback
      isInferredPartType: !partType && !!descriptiveWords  // Flag that we inferred it
    }
  };
}

// Test the query builder
if (require.main === module) {
  const TEST_TITLES = [
    'Honda CR-V 2.4L A/T 2005-2006 Programmed ECU ECM Engine Module',
    'Programmed PT Cruiser 2006-2010 TIPM Fuse Box Power Module',
    'Dodge RAM 2500 3500 5.9L Programmed ECU ECM PCM Engine Control',
    'Ford Explorer 2014 2015 ABS Anti Lock Brake Pump Assembly',
    'BMW 323i 328i 528i 1999 2000 Electronic Throttle Body Assembly',
  ];

  console.log('=== Smart Query Builder Test ===\n');

  TEST_TITLES.forEach((title, i) => {
    const result = buildSearchQuery(title);
    console.log(`[${i + 1}] ${title.substring(0, 60)}...`);
    console.log(`    Query: "${result.query}"`);
    console.log(`    Parts: ${JSON.stringify(result.parts)}`);
    console.log('');
  });
}

module.exports = { buildSearchQuery, extractPartType, extractMake, extractModel, extractYears };
