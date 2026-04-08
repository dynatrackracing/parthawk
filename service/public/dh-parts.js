/**
 * DarkHawk Part Value Utilities — shared across all field pages.
 * Provides tier colors, price badges, and global part exclusion.
 *
 * Usage: <link rel="stylesheet" href="/admin/dh-parts.css">
 *        <script src="/admin/dh-parts.js"></script>
 */

/**
 * Get the value tier for a price.
 * @param {number} price
 * @returns {{ label:string, color:string, cssClass:string, pulses:boolean }}
 */
function getPartTier(price) {
  if (price >= 500) return { label: 'ELITE',   color: '#FFD700', cssClass: 'tier-elite',   pulses: true };
  if (price >= 350) return { label: 'PREMIUM', color: '#C39BD3', cssClass: 'tier-premium', pulses: true };
  if (price >= 250) return { label: 'HIGH',    color: '#3498DB', cssClass: 'tier-high',    pulses: false };
  if (price >= 150) return { label: 'SOLID',   color: '#2ECC40', cssClass: 'tier-solid',   pulses: false };
  if (price >= 100) return { label: 'BASE',    color: '#FF8C00', cssClass: 'tier-base',    pulses: false };
  return               { label: 'LOW',     color: '#FF4136', cssClass: 'tier-low',     pulses: false };
}

/**
 * Render an HTML price badge with the correct tier color.
 * @param {number} price — the dollar value
 * @param {string} [prefix] — optional prefix like 'REF'
 * @returns {string} HTML string
 */
function renderPriceBadge(price, prefix) {
  if (!price || price <= 0) return '<span class="part-badge tier-nodata">NO DATA</span>';
  var tier = getPartTier(price);
  var text = (prefix ? prefix + ' ' : '') + '$' + Math.round(price);
  return '<span class="part-badge ' + tier.cssClass + '">' + tier.label + ' ' + text + '</span>';
}

/**
 * Global part exclusion filter.
 * Returns true if the part should be HIDDEN (complete engines, transmissions, body panels).
 * Returns false for all sellable parts (modules, trim, glass, lighting, steering, etc.).
 * @param {string} title — part title or description
 * @returns {boolean}
 */
function isExcludedPart(title) {
  if (!title) return false;
  var t = title.toUpperCase();

  // --- COMPLETE ENGINES & ENGINE INTERNALS ---
  if (/\bENGINE ASSEMBLY\b/.test(t)) return true;
  if (/\bMOTOR ASSEMBLY\b/.test(t)) return true;
  if (/\bLONG BLOCK\b/.test(t)) return true;
  if (/\bSHORT BLOCK\b/.test(t)) return true;
  if (/\bCOMPLETE ENGINE\b/.test(t)) return true;
  if (/\bCRATE ENGINE\b/.test(t)) return true;
  if (/\bREMAN ENGINE\b/.test(t)) return true;
  if (/\bENGINE BLOCK\b/.test(t)) return true;
  if (/\bCYLINDER HEAD\b/.test(t)) return true;
  if (/\bPISTON\b/.test(t)) return true;
  if (/\bCRANKSHAFT\b/.test(t)) return true;
  if (/\bCONNECTING ROD\b/.test(t)) return true;
  if (/\bHEAD GASKET\b/.test(t)) return true;
  if (/\bOIL PAN\b/.test(t)) return true;
  if (/\bTIMING CHAIN\b/.test(t)) return true;
  if (/\bTIMING BELT\b/.test(t)) return true;
  if (/\bROCKER ARM\b/.test(t)) return true;
  if (/\bLIFTER\b/.test(t)) return true;
  if (/\bPUSHROD\b/.test(t)) return true;
  if (/\bOIL PUMP\b/.test(t)) return true;
  if (/\bFLYWHEEL\b/.test(t)) return true;
  if (/\bFLEXPLATE\b/.test(t)) return true;

  // --- COMPLETE TRANSMISSIONS (not modules — TCM is sellable) ---
  if (/\bTRANSMISSION ASSEMBLY\b/.test(t)) return true;
  if (/\bTRANSAXLE ASSEMBLY\b/.test(t)) return true;
  if (/\bCOMPLETE TRANSMISSION\b/.test(t)) return true;
  if (/\bREMAN TRANSMISSION\b/.test(t)) return true;

  // --- BODY PANELS ---
  if (/\bFENDER\b/.test(t)) return true;
  if (/\bBUMPER COVER\b/.test(t)) return true;
  if (/\bBUMPER ASSEMBLY\b/.test(t)) return true;
  if (/\bHOOD PANEL\b/.test(t)) return true;
  if (/\bDOOR SHELL\b/.test(t)) return true;
  if (/\bQUARTER PANEL\b/.test(t)) return true;
  if (/\bROCKER PANEL\b/.test(t)) return true;
  if (/\bBED SIDE\b/.test(t)) return true;
  if (/\bTRUCK BED\b/.test(t)) return true;
  if (/\bTRUNK LID\b/.test(t)) return true;
  if (/\bROOF PANEL\b/.test(t)) return true;

  // --- AIRBAGS / SRS (clock springs ARE sellable — not caught here) ---
  if (/\b(AIRBAG|AIR\s*BAG)\b/.test(t)) return true;
  if (/\bSRS\s*(MODULE|SENSOR|UNIT)\b/.test(t)) return true;
  if (/\bSUPPLEMENTAL\s*RESTRAINT\b/.test(t)) return true;

  return false;
}

/**
 * Render intel source icon for a part chip.
 * Priority: mark > quarry > stream > overstock.
 * @param {string[]} sources - array of source strings ('mark','quarry','stream','overstock','flag','sold')
 * @returns {string} HTML for the icon prefix, or '' if no intel source
 */
function renderIntelIcon(sources) {
  if (!sources || sources.length === 0) return '';
  if (sources.includes('mark'))      return '<span style="font-size:10px" title="Mark (target)">&#x1F3AF;</span>';
  if (sources.includes('quarry'))    return '<span class="intel-fire" style="font-size:10px" title="Quarry (hot seller)">&#x1F525;</span>';
  if (sources.includes('stream') || sources.includes('restock'))
    return '<span style="font-size:10px" title="Scour Stream">&#x1F501;</span>';
  if (sources.includes('overstock')) return '<span style="color:#ef4444" title="Overstock">&#x2715;</span>';
  return '';
}
