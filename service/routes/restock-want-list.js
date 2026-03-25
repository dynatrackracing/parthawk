'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

// Get all active want list items with stock counts and sale data
router.get('/items', async (req, res) => {
  const knex = database;
  const items = await knex('restock_want_list').where({ active: true }).orderBy('created_at', 'asc');

  const results = [];
  for (const item of items) {
    const match = buildMatch(item.title);
    let stock = 0;
    let avgPrice = null;
    let lastSold = null;
    let matchedTitles = [];

    if (match) {
      // Count active listings
      let listingQuery = knex('YourListing').where('listingStatus', 'Active');
      listingQuery = applyMatch(listingQuery, match, 'title');
      const listings = await listingQuery.select('title').limit(10);
      stock = listings.length;
      matchedTitles = listings.map(l => l.title);

      // If we got 10 results, do a proper count (there may be more)
      if (stock === 10) {
        let countQuery = knex('YourListing').where('listingStatus', 'Active');
        countQuery = applyMatch(countQuery, match, 'title');
        const [{ count }] = await countQuery.count('* as count');
        stock = parseInt(count) || 0;
      }

      // Get avg price and last sold from YourSale
      let saleQuery = knex('YourSale');
      saleQuery = applyMatch(saleQuery, match, 'title');
      const sales = await saleQuery.select(
        knex.raw('AVG("salePrice") as avg_price'),
        knex.raw('MAX("soldDate") as last_sold'),
        knex.raw('COUNT(*) as sold_count')
      ).first();

      if (sales && parseInt(sales.sold_count) > 0) {
        avgPrice = Math.round(parseFloat(sales.avg_price) || 0);
        lastSold = sales.last_sold;
      }
    }

    results.push({
      id: item.id,
      title: item.title,
      notes: item.notes,
      pulled: item.pulled || false,
      pulled_date: item.pulled_date,
      stock,
      avgPrice,
      lastSold,
      matchedTitles,
      matchDebug: match ? match.debug : 'no match criteria',
      created_at: item.created_at
    });
  }

  // Sort: OUT OF STOCK (0, not pulled) → PULLED → LOW (1-2) → STOCKED (3+)
  results.sort((a, b) => {
    const rank = (item) => {
      if (item.stock === 0 && !item.pulled) return 0; // OUT OF STOCK — top
      if (item.pulled) return 1;                        // PULLED
      if (item.stock <= 2) return 2;                    // LOW
      return 3;                                          // STOCKED
    };
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.stock - b.stock;
  });

  res.json({ success: true, items: results, total: results.length });
});

// Toggle pulled status
router.post('/pull', async (req, res) => {
  const { id, pulled } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({
    pulled: !!pulled,
    pulled_date: pulled ? new Date().toISOString() : null
  });
  res.json({ success: true });
});

// Find matching vehicles in yards
router.post('/find-in-yard', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const knex = database;
  const parsed = parseVehicleFromTitle(title);
  if (!parsed) return res.json({ success: true, vehicles: [], message: 'Could not parse make/model from title' });

  let query = knex('yard_vehicle')
    .join('yard', 'yard.id', 'yard_vehicle.yard_id')
    .where('yard_vehicle.active', true)
    .where('yard.enabled', true);

  // Match make
  if (parsed.make) {
    query = query.where('yard_vehicle.make', 'ilike', `%${parsed.make}%`);
  }

  // Match model(s) — OR across multiple models
  if (parsed.models.length > 0) {
    query = query.where(function() {
      for (const model of parsed.models) {
        this.orWhere('yard_vehicle.model', 'ilike', `%${model}%`);
      }
    });
  }

  // Year range filter
  if (parsed.yearStart) {
    query = query.where('yard_vehicle.year', '>=', String(parsed.yearStart));
  }
  if (parsed.yearEnd) {
    query = query.where('yard_vehicle.year', '<=', String(parsed.yearEnd));
  }

  const vehicles = await query
    .select(
      'yard_vehicle.year', 'yard_vehicle.make', 'yard_vehicle.model',
      'yard_vehicle.row_number', 'yard_vehicle.date_added', 'yard_vehicle.color',
      'yard.name as yard_name'
    )
    .orderBy('yard_vehicle.date_added', 'desc')
    .limit(20);

  const results = vehicles.map(v => {
    const daysAgo = v.date_added
      ? Math.floor((Date.now() - new Date(v.date_added).getTime()) / 86400000)
      : null;
    return {
      year: v.year,
      make: v.make,
      model: v.model,
      color: v.color,
      row: v.row_number || '?',
      yard: v.yard_name,
      daysAgo: daysAgo !== null ? (daysAgo <= 0 ? 'today' : daysAgo + 'd ago') : '?'
    };
  });

  res.json({ success: true, vehicles: results });
});

// Add a new part
router.post('/add', async (req, res) => {
  const { title, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });

  const [item] = await database('restock_want_list')
    .insert({ title: title.trim(), notes: notes || null, active: true })
    .returning('*');

  res.json({ success: true, item });
});

// Delete (soft) a part
router.post('/delete', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  await database('restock_want_list').where({ id }).update({ active: false });
  res.json({ success: true });
});

// Parse make, model(s), and year range from a want list title
function parseVehicleFromTitle(title) {
  const titleLower = title.toLowerCase();

  // Extract year range
  let yearStart = null, yearEnd = null;
  const rangeMatch = title.match(/\b(19|20)(\d{2})\s*[-–]\s*(19|20)?(\d{2})\b/);
  if (rangeMatch) {
    yearStart = parseInt(rangeMatch[1] + rangeMatch[2]);
    const endDigits = rangeMatch[4];
    yearEnd = rangeMatch[3]
      ? parseInt(rangeMatch[3] + endDigits)
      : (endDigits.length === 2 ? parseInt(rangeMatch[1] + endDigits) : parseInt(endDigits));
  } else {
    const singleYear = title.match(/\b(19|20)\d{2}\b/);
    if (singleYear) {
      yearStart = parseInt(singleYear[0]);
      yearEnd = yearStart;
    }
    // Handle short years like "11-19" or "06-08"
    const shortRange = title.match(/\b(\d{2})\s*[-–]\s*(\d{2})\b/);
    if (shortRange && !rangeMatch) {
      const s = parseInt(shortRange[1]), e = parseInt(shortRange[2]);
      if (s >= 89 && s <= 99) yearStart = 1900 + s;
      else if (s >= 0 && s <= 30) yearStart = 2000 + s;
      if (e >= 89 && e <= 99) yearEnd = 1900 + e;
      else if (e >= 0 && e <= 30) yearEnd = 2000 + e;
    }
  }

  // Handle "2011+" style
  const plusMatch = title.match(/\b(19|20)(\d{2})\+/);
  if (plusMatch && !yearStart) {
    yearStart = parseInt(plusMatch[1] + plusMatch[2]);
    yearEnd = new Date().getFullYear();
  }

  // Find make
  let foundMake = null;
  for (const make of MAKES_LIST) {
    const re = new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) { foundMake = make; break; }
  }

  // Find models
  const foundModels = [];
  for (const model of MODELS) {
    const re = new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) foundModels.push(model);
  }

  if (!foundMake && foundModels.length === 0) return null;

  return { make: foundMake, models: foundModels, yearStart, yearEnd };
}

const MAKES_LIST = [
  'ford','toyota','honda','acura','bmw','volvo','infiniti','mazda','lincoln',
  'land rover','saturn','dodge','chrysler','jeep','nissan','buick','pontiac',
  'hyundai','kia','jaguar','lexus','cadillac','mitsubishi','suzuki','geo',
  'chevrolet','chevy','mercedes','ram',
];

// Known vehicle models
const MODELS = new Set([
  'f150','f250','f350','vue','tsx','ridgeline','xc90','xc70','coupe','m35',
  'sequoia','mazda6','town car','p38','dakota','durango','fusion','corolla',
  'gs300','charger','accord','srx','ranger','econoline','cr-v','crv','endeavor',
  'titan','pathfinder','qx4','grand vitara','tundra','lacrosse','lucerne',
  'grand prix','c70','s70','v70','miata','montero','xterra','santa fe',
  'xg350','xj6','xk8','explorer','transit','transit connect','fx35','ilx',
  'tl','escalade','grand cherokee','jetta','trailblazer','rav4','nv200',
  'nv2500','nv3500','pilot','flex','c230','prius','s550','rdx',
  'five hundred','solstice','tacoma','4runner','mdx','promaster','t100',
  'metro','sidekick','tracker','odyssey','caravan','dart','sienna',
  'pacifica','voyager','camaro','300','l100','q60','q40','ram',
]);

// Known part types
const PART_PHRASES = [
  'yaw rate sensor', 'yaw rate', 'fuse box', 'ignition switch', 'ignition lock',
  'body control module', 'brake booster', 'brake accumulator', 'brake pump',
  'throttle body', 'oil cooler', 'intake manifold', 'center console lid',
  'center console', 'door module', 'door control module', 'steering angle sensor',
  'power steering pump', 'turn signal', 'wiper switch', 'combo switch',
  'spare tire', 'spare tire donut', 'gear shifter', 'floor shifter',
  'rear window motor', 'fan solenoid', 'fan complete', 'camshaft set',
  'control module', 'transfer case', 'rear door hinge',
];

function buildMatch(title) {
  // 1. Extract OEM part numbers
  const pnMatches = title.match(/\b[A-Z0-9]{2,}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/gi) || [];
  const numPns = title.match(/\b\d{5,}\b/g) || [];
  const partNumbers = [...pnMatches, ...numPns]
    .filter(pn => pn.length >= 5 && !/^\d{4}$/.test(pn) && !/^(19|20)\d{2}$/.test(pn));

  // 2. Extract model names
  const titleLower = title.toLowerCase();
  const foundModels = [];
  for (const model of MODELS) {
    const re = new RegExp('\\b' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(titleLower)) foundModels.push(model);
  }

  // 3. Extract part type phrase
  let foundPartPhrase = null;
  for (const phrase of PART_PHRASES) {
    if (titleLower.includes(phrase)) {
      if (!foundPartPhrase || phrase.length > foundPartPhrase.length) foundPartPhrase = phrase;
    }
  }

  // 4. Fallback part words
  const partStopWords = new Set([
    'oem','the','and','for','with','only','new','used','genuine','w','a','an',
    'in','on','of','to','or','set','left','right','upper','lower','rear','front',
    'driver','passenger','automatic','manual','electric','non-turbo','turbo',
    'plastic','dark','gray','black','blue','yellow','discount','prices','check',
    'get','plugs','good','shape','not','complete','combo','assembly','unused',
    'tire','needs','show','whiskers','wear','bolt','housing','block','unit',
    'smaller','sedan','coupe','dr','4dr',
  ]);

  let partWords = [];
  if (!foundPartPhrase) {
    const cleaned = title
      .replace(/\([^)]*\)/g, '')
      .replace(/\b[A-Z0-9]{2,}-[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b/g, '')
      .replace(/\b\d+\b/g, '')
      .replace(/[^a-zA-Z\s]/g, ' ');
    partWords = cleaned.split(/\s+/)
      .map(w => w.toLowerCase().trim())
      .filter(w => w.length >= 3 && !partStopWords.has(w) && !new Set(MAKES_LIST).has(w) && !MODELS.has(w));
    partWords = [...new Set(partWords)].slice(0, 2);
  }

  // Strategy 1: Part number match
  if (partNumbers.length > 0) {
    return { type: 'pn', partNumbers, models: foundModels, debug: `PN: ${partNumbers.join(', ')}` };
  }

  // Strategy 2: Model + part phrase/words
  if (foundModels.length > 0 && (foundPartPhrase || partWords.length > 0)) {
    const partTerms = foundPartPhrase
      ? foundPartPhrase.split(' ').filter(w => w.length >= 3)
      : partWords;
    return { type: 'keywords', models: foundModels, partTerms, debug: `Models: [${foundModels.join(', ')}] + Parts: [${partTerms.join(', ')}]` };
  }

  // Strategy 3: Make + part phrase
  if (foundPartPhrase) {
    const partTerms = foundPartPhrase.split(' ').filter(w => w.length >= 3);
    let foundMake = null;
    for (const make of MAKES_LIST) {
      const re = new RegExp('\\b' + make.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (re.test(titleLower)) { foundMake = make; break; }
    }
    if (foundMake) {
      return { type: 'keywords', models: [], make: foundMake, partTerms, debug: `Make: ${foundMake} + Parts: [${partTerms.join(', ')}]` };
    }
  }

  return null;
}

function applyMatch(query, match, col) {
  if (match.type === 'pn') {
    query = query.where(function() {
      for (const pn of match.partNumbers) {
        this.orWhere(col, 'ilike', `%${pn}%`);
      }
    });
    return query;
  }

  if (match.type === 'keywords') {
    if (match.models.length > 0) {
      query = query.where(function() {
        for (const model of match.models) {
          this.orWhere(col, 'ilike', `%${model}%`);
        }
      });
    } else if (match.make) {
      query = query.where(col, 'ilike', `%${match.make}%`);
    }

    for (const term of match.partTerms) {
      query = query.andWhere(col, 'ilike', `%${term}%`);
    }
    return query;
  }

  return query;
}

module.exports = router;
