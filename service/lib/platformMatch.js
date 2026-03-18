/**
 * platformMatch.js — Platform Cross-Reference Engine for PartHawk
 * 
 * Resolves the problem: "2006 Chrysler 300 at yard should match Dodge Charger ECM sales"
 * 
 * Usage:
 *   const { getPlatformMatches, getExpandedSalesQuery } = require('./platformMatch');
 *   
 *   // Get all platform siblings for a yard vehicle
 *   const matches = await getPlatformMatches(pool, 'Chrysler', '300', 2006);
 *   // Returns: [{ make: 'Dodge', model: 'Charger', part_types: ['ECM','BCM','ABS',...] }, ...]
 *   
 *   // Get expanded SQL WHERE clause for YourSale matching
 *   const clause = await getExpandedSalesQuery(pool, 'Chrysler', '300', 2006);
 *   // Returns SQL that matches 300 + Charger + Challenger + Magnum titles
 */

const MODEL_ALIASES = {
  // Chrysler
  '300': ['300', '300c', '300s', '300 touring', '300 limited'],
  'Charger': ['Charger'],
  'Challenger': ['Challenger'],
  'Grand Cherokee': ['Grand Cherokee'],
  'Commander': ['Commander'],
  'Liberty': ['Liberty'],
  'Nitro': ['Nitro'],
  'Wrangler': ['Wrangler'],
  'Cherokee': ['Cherokee'],
  'Avenger': ['Avenger'],
  'Sebring': ['Sebring'],
  '200': ['200'],
  'Grand Caravan': ['Grand Caravan', 'Caravan'],
  'Town & Country': ['Town & Country', 'Town and Country', 'T&C'],
  'Pacifica': ['Pacifica'],
  'PT Cruiser': ['PT Cruiser'],
  'Dart': ['Dart'],
  'Caliber': ['Caliber'],
  'Journey': ['Journey'],
  'Durango': ['Durango'],
  'Magnum': ['Magnum'],
  
  // Ram (handles Dodge Ram vs Ram brand split 2010)
  '1500': ['1500', 'Ram 1500'],
  '2500': ['2500', 'Ram 2500'],
  '3500': ['3500', 'Ram 3500'],
  'Ram 1500': ['Ram 1500', '1500'],
  'Ram 2500': ['Ram 2500', '2500'],
  'Ram 3500': ['Ram 3500', '3500'],
  
  // GM
  'Silverado': ['Silverado'],
  'Sierra': ['Sierra'],
  'Tahoe': ['Tahoe'],
  'Yukon': ['Yukon'],
  'Suburban': ['Suburban'],
  'Escalade': ['Escalade'],
  'Traverse': ['Traverse'],
  'Acadia': ['Acadia'],
  'Enclave': ['Enclave'],
  'Trailblazer': ['Trailblazer'],
  'Envoy': ['Envoy'],
  'Equinox': ['Equinox'],
  'Terrain': ['Terrain'],
  'Express': ['Express'],
  'Savana': ['Savana'],
  'Impala': ['Impala'],
  
  // Ford
  'Edge': ['Edge'],
  'MKX': ['MKX'],
  'Explorer': ['Explorer'],
  'Taurus': ['Taurus'],
  'Flex': ['Flex'],
  'MKT': ['MKT'],
  'F-250': ['F-250', 'F250', 'Super Duty'],
  'F-350': ['F-350', 'F350', 'Super Duty'],
  'Excursion': ['Excursion'],
  'Escape': ['Escape'],
  'Mariner': ['Mariner'],
  'Tribute': ['Tribute'],
  'Fusion': ['Fusion'],
  
  // Japanese
  'Tundra': ['Tundra'],
  'Sequoia': ['Sequoia'],
  'Tucson': ['Tucson'],
  'Sportage': ['Sportage'],
  'Sonata': ['Sonata'],
  'Optima': ['Optima'],
  'Elantra': ['Elantra'],
  'Forte': ['Forte'],
  '350Z': ['350Z'],
  'G35': ['G35'],
  'Frontier': ['Frontier'],
  'Xterra': ['Xterra'],
  'Pathfinder': ['Pathfinder'],
  'CR-V': ['CR-V', 'CRV'],
  'Civic': ['Civic'],
  
  // VW
  'Jetta': ['Jetta'],
  'Golf': ['Golf'],
  'Passat': ['Passat'],
};

// Make aliases: LKQ scraper says "CHRYSLER" but sales say "Chrysler" or "Dodge"
const MAKE_ALIASES = {
  'CHRYSLER': ['Chrysler'],
  'DODGE': ['Dodge'],
  'JEEP': ['Jeep'],
  'RAM': ['Ram', 'Dodge'],  // Ram brand started 2010, before that it's Dodge Ram
  'CHEVROLET': ['Chevrolet', 'Chevy'],
  'CHEVY': ['Chevrolet', 'Chevy'],
  'GMC': ['GMC'],
  'FORD': ['Ford'],
  'LINCOLN': ['Lincoln'],
  'MERCURY': ['Mercury'],
  'TOYOTA': ['Toyota'],
  'LEXUS': ['Lexus'],
  'HONDA': ['Honda'],
  'ACURA': ['Acura'],
  'NISSAN': ['Nissan'],
  'INFINITI': ['Infiniti'],
  'HYUNDAI': ['Hyundai'],
  'KIA': ['Kia'],
  'MAZDA': ['Mazda'],
  'VOLKSWAGEN': ['Volkswagen', 'VW'],
  'BMW': ['BMW'],
  'MERCEDES-BENZ': ['Mercedes-Benz', 'Mercedes'],
  'SUBARU': ['Subaru'],
  'MITSUBISHI': ['Mitsubishi'],
  'VOLVO': ['Volvo'],
  'AUDI': ['Audi'],
};

/**
 * Get all platform-sibling vehicles for a given make/model/year.
 * Accepts either a Knex instance (database) or a pg pool.
 * @returns Array of { make, model, part_types[], platform_name, notes }
 */
async function getPlatformMatches(db, make, model, year) {
  const query = `
    SELECT DISTINCT
      pv2.make, pv2.model,
      array_agg(DISTINCT psp.part_type) as part_types,
      pg.platform as platform_name,
      pg.notes
    FROM platform_vehicle pv1
    JOIN platform_group pg ON pv1.platform_group_id = pg.id
    JOIN platform_vehicle pv2 ON pv2.platform_group_id = pg.id AND pv2.id != pv1.id
    JOIN platform_shared_part psp ON psp.platform_group_id = pg.id
    WHERE LOWER(pv1.make) = LOWER(?)
      AND LOWER(pv1.model) = LOWER(?)
      AND ? BETWEEN pg.year_start AND pg.year_end
    GROUP BY pv2.make, pv2.model, pg.platform, pg.notes
  `;

  try {
    // Support both Knex (db.raw) and pg pool (db.query)
    if (db.raw) {
      const result = await db.raw(query, [make, model, year]);
      return result.rows || result;
    } else {
      const result = await db.query(query, [make, model, year]);
      return result.rows;
    }
  } catch (err) {
    // Tables may not exist yet — return empty silently
    return [];
  }
}

/**
 * Build expanded ILIKE conditions for YourSale title matching
 * Includes the original vehicle + all platform siblings
 * 
 * @returns { conditions: string[], params: string[] } for use in WHERE clause
 */
async function getExpandedSalesQuery(db, make, model, year) {
  // Start with the original vehicle
  const makeAliases = MAKE_ALIASES[make.toUpperCase()] || [make];
  const modelAliases = MODEL_ALIASES[model] || [model];

  let allVehicles = [{ make, model, makeAliases, modelAliases }];

  // Get platform siblings
  const siblings = await getPlatformMatches(db, make, model, year);
  for (const sib of siblings) {
    const sibMakeAliases = MAKE_ALIASES[sib.make.toUpperCase()] || [sib.make];
    const sibModelAliases = MODEL_ALIASES[sib.model] || [sib.model];
    allVehicles.push({
      make: sib.make,
      model: sib.model,
      makeAliases: sibMakeAliases,
      modelAliases: sibModelAliases,
    });
  }
  
  // Build ILIKE conditions
  let conditions = [];
  let params = [];
  let paramIdx = 1;
  
  for (const veh of allVehicles) {
    for (const mk of veh.makeAliases) {
      for (const mdl of veh.modelAliases) {
        conditions.push(`(title ILIKE $${paramIdx} AND title ILIKE $${paramIdx + 1})`);
        params.push(`%${mk}%`, `%${mdl}%`);
        paramIdx += 2;
      }
    }
  }
  
  return { conditions, params };
}

/**
 * Enhanced scoring: adjust score based on platform data
 * If a vehicle at the yard has platform siblings with strong sales, boost its score
 */
function applyPlatformBonus(baseScore, platformMatches, salesData) {
  if (!platformMatches || platformMatches.length === 0) return baseScore;
  
  // Calculate total sibling sales volume
  let siblingRevenue = 0;
  let siblingUnits = 0;
  
  for (const match of platformMatches) {
    const key = `${match.make}|${match.model}`;
    if (salesData[key]) {
      siblingRevenue += salesData[key].revenue || 0;
      siblingUnits += salesData[key].units || 0;
    }
  }
  
  // Bonus: up to 20% boost based on sibling sales
  if (siblingUnits > 0) {
    const bonus = Math.min(0.20, siblingUnits * 0.01);
    return Math.round(baseScore * (1 + bonus));
  }
  
  return baseScore;
}

/**
 * Normalize make names from yard scraper to match sales data
 */
function normalizeMake(yardMake) {
  if (!yardMake) return yardMake;
  const upper = yardMake.toUpperCase().trim();
  const aliases = MAKE_ALIASES[upper];
  return aliases ? aliases[0] : yardMake;
}

/**
 * Normalize model names — strip common suffixes and standardize
 */
function normalizeModel(model) {
  if (!model) return model;
  return model
    .replace(/\s+(Base|S|SE|LE|XLE|SXT|SLT|LT|LS|XL|XLT|Limited|Sport|Touring|Premium)\s*$/i, '')
    .trim();
}

module.exports = {
  getPlatformMatches,
  getExpandedSalesQuery,
  applyPlatformBonus,
  normalizeMake,
  normalizeModel,
  MAKE_ALIASES,
  MODEL_ALIASES,
};
