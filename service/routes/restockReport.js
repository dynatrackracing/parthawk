'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

const RESTOCK_QUERY = `
WITH recent_sales AS (
  SELECT
    title,
    "salePrice"::numeric as price,
    "soldDate",
    -- Extract OEM part number from title
    COALESCE(
      -- Chrysler: 56044691AA
      (regexp_match(title, '\\m(\\d{8}[A-Z]{2})\\M'))[1],
      -- Ford: BL3T-14B205-AB or AL3Z-2C204-A
      (regexp_match(title, '\\m([A-Z]{1,4}\\d{1,2}[A-Z]-[A-Z0-9]{4,6}(?:-[A-Z]{1,2})?)\\M'))[1],
      -- Toyota/Honda: 89661-04510 or 39980-TS8-A0
      (regexp_match(title, '\\m(\\d{5}-[A-Z0-9]{2,7}(?:-[A-Z0-9]{1,3})?)\\M'))[1],
      -- GM: 22767372
      (regexp_match(title, '\\m(\\d{8})\\M'))[1],
      -- Euro: 8T0 035 223AN or A0014264D
      (regexp_match(title, '\\m([A-Z]\\d{3,}[A-Z]?)\\M'))[1]
    ) as part_number,
    -- Extract make
    CASE
      WHEN title ILIKE '%Toyota%' THEN 'Toyota'
      WHEN title ILIKE '%Honda%' THEN 'Honda'
      WHEN title ILIKE '%Ford%' THEN 'Ford'
      WHEN title ILIKE '%Dodge%' THEN 'Dodge'
      WHEN title ILIKE '%Chrysler%' THEN 'Chrysler'
      WHEN title ILIKE '%Jeep%' THEN 'Jeep'
      WHEN title ILIKE '%Ram%' AND title NOT ILIKE '%Ramcharger%' THEN 'Ram'
      WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet'
      WHEN title ILIKE '%GMC%' THEN 'GMC'
      WHEN title ILIKE '%Nissan%' THEN 'Nissan'
      WHEN title ILIKE '%Hyundai%' THEN 'Hyundai'
      WHEN title ILIKE '%Kia%' THEN 'Kia'
      WHEN title ILIKE '%Mazda%' THEN 'Mazda'
      WHEN title ILIKE '%Subaru%' THEN 'Subaru'
      WHEN title ILIKE '%BMW%' THEN 'BMW'
      WHEN title ILIKE '%Mercedes%' THEN 'Mercedes'
      WHEN title ILIKE '%Volkswagen%' OR title ILIKE '%VW %' THEN 'Volkswagen'
      WHEN title ILIKE '%Audi%' THEN 'Audi'
      WHEN title ILIKE '%Lexus%' THEN 'Lexus'
      WHEN title ILIKE '%Acura%' THEN 'Acura'
      WHEN title ILIKE '%Infiniti%' THEN 'Infiniti'
      WHEN title ILIKE '%Volvo%' THEN 'Volvo'
      WHEN title ILIKE '%Mitsubishi%' THEN 'Mitsubishi'
      WHEN title ILIKE '%Buick%' THEN 'Buick'
      WHEN title ILIKE '%Cadillac%' THEN 'Cadillac'
      WHEN title ILIKE '%Lincoln%' THEN 'Lincoln'
      WHEN title ILIKE '%Mini%' THEN 'Mini'
      ELSE 'Other'
    END as make,
    -- Extract model (word after make name)
    SUBSTRING(title FROM '(?:Toyota|Honda|Ford|Dodge|Chrysler|Jeep|Ram|Chevy|Chevrolet|GMC|Nissan|Hyundai|Kia|Mazda|BMW|Mercedes|Volkswagen|Audi|Lexus|Acura|Infiniti|Volvo|Mitsubishi|Buick|Cadillac|Lincoln|Subaru|Mini)\\s+(\\w+)') as model,
    -- Extract part type
    CASE
      WHEN title ~* '\\m(TCM|TCU|transmission control)\\M' THEN 'TCM'
      WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM'
      WHEN title ~* '\\m(ECU|ECM|PCM|engine control|engine computer|engine module)\\M' THEN 'ECM'
      WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM'
      WHEN title ~* '\\m(fuse box|fuse relay|junction box|ipdm|relay box)\\M' THEN 'Fuse Box'
      WHEN title ~* '\\m(ABS|anti.lock|brake pump|brake module)\\M' THEN 'ABS'
      WHEN title ~* '\\m(amplifier|bose|harman|JBL)\\M' THEN 'Amplifier'
      WHEN title ~* '\\m(radio|stereo|infotainment|head unit|receiver)\\M' THEN 'Radio'
      WHEN title ~* '\\m(cluster|speedometer|gauge|instrument)\\M' THEN 'Cluster'
      WHEN title ~* '\\m(throttle body)\\M' THEN 'Throttle'
      ELSE 'Other'
    END as part_type,
    -- Extract year(s)
    (regexp_match(title, '\\m((?:19|20)\\d{2})\\M'))[1] as title_year
  FROM "YourSale"
  WHERE "soldDate" >= NOW() - INTERVAL '7 days'
    AND "salePrice"::numeric >= 50
    AND title IS NOT NULL
),
grouped AS (
  SELECT
    make,
    NULLIF(model, '') as model,
    part_type,
    part_number_base(part_number) as base_pn,
    array_agg(DISTINCT part_number) FILTER (WHERE part_number IS NOT NULL) as variant_pns,
    COUNT(*) as sold_7d,
    ROUND(AVG(price), 2) as avg_price,
    ROUND(SUM(price), 2) as total_rev,
    MAX("soldDate") as last_sold,
    MIN(title_year) as year_min,
    MAX(title_year) as year_max,
    (array_agg(title ORDER BY price DESC))[1] as sample_title
  FROM recent_sales
  WHERE make != 'Other' AND part_type != 'Other'
  GROUP BY make, model, part_type, part_number_base(part_number)
),
with_stock AS (
  SELECT g.*,
    -- Stock check: match by base part number extracted from listing titles
    COALESCE((
      SELECT SUM(COALESCE(l."quantityAvailable", 1))
      FROM "YourListing" l
      WHERE l."listingStatus" = 'Active'
        AND part_number_base(
          COALESCE(
            (regexp_match(l.title, '\\m(\\d{8}[A-Z]{2})\\M'))[1],
            (regexp_match(l.title, '\\m([A-Z]{1,4}\\d{1,2}[A-Z]-[A-Z0-9]{4,6}(?:-[A-Z]{1,2})?)\\M'))[1],
            (regexp_match(l.title, '\\m(\\d{5}-[A-Z0-9]{2,7}(?:-[A-Z0-9]{1,3})?)\\M'))[1],
            (regexp_match(l.title, '\\m(\\d{8})\\M'))[1]
          )
        ) = g.base_pn
    ), 0) as stock
  FROM grouped g
  WHERE g.base_pn IS NOT NULL
)
SELECT *,
  LEAST(100, (
    CASE WHEN sold_7d >= 4 THEN 35 WHEN sold_7d >= 3 THEN 28 WHEN sold_7d >= 2 THEN 20 ELSE 10 END
    + CASE WHEN avg_price >= 300 THEN 25 WHEN avg_price >= 200 THEN 20 WHEN avg_price >= 150 THEN 15 WHEN avg_price >= 100 THEN 10 ELSE 5 END
    + CASE WHEN stock = 0 THEN 25 WHEN stock = 1 THEN 15 ELSE 0 END
    + CASE WHEN last_sold >= NOW() - INTERVAL '3 days' THEN 15 WHEN last_sold >= NOW() - INTERVAL '5 days' THEN 10 ELSE 5 END
  )) as score,
  CASE
    WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW'
    WHEN stock = 0 THEN 'OUT OF STOCK'
    WHEN stock = 1 THEN 'LOW STOCK'
    ELSE 'MONITOR'
  END as action
FROM with_stock
WHERE stock <= 1
ORDER BY total_rev DESC
LIMIT 100;
`;

// Fallback query when part_number_base() doesn't exist or base_pn is sparse
const RESTOCK_FALLBACK = `
WITH recent_sales AS (
  SELECT
    title,
    "salePrice"::numeric as price,
    "soldDate",
    CASE
      WHEN title ILIKE '%Toyota%' THEN 'Toyota' WHEN title ILIKE '%Honda%' THEN 'Honda'
      WHEN title ILIKE '%Ford%' THEN 'Ford' WHEN title ILIKE '%Dodge%' THEN 'Dodge'
      WHEN title ILIKE '%Chrysler%' THEN 'Chrysler' WHEN title ILIKE '%Jeep%' THEN 'Jeep'
      WHEN title ILIKE '%Ram%' AND title NOT ILIKE '%Ramcharger%' THEN 'Ram'
      WHEN title ILIKE '%Chevrolet%' OR title ILIKE '%Chevy%' THEN 'Chevrolet'
      WHEN title ILIKE '%GMC%' THEN 'GMC' WHEN title ILIKE '%Nissan%' THEN 'Nissan'
      WHEN title ILIKE '%Hyundai%' THEN 'Hyundai' WHEN title ILIKE '%Kia%' THEN 'Kia'
      WHEN title ILIKE '%BMW%' THEN 'BMW' WHEN title ILIKE '%Mercedes%' THEN 'Mercedes'
      WHEN title ILIKE '%Audi%' THEN 'Audi' WHEN title ILIKE '%Lexus%' THEN 'Lexus'
      WHEN title ILIKE '%Acura%' THEN 'Acura' WHEN title ILIKE '%Mazda%' THEN 'Mazda'
      WHEN title ILIKE '%Infiniti%' THEN 'Infiniti' WHEN title ILIKE '%Subaru%' THEN 'Subaru'
      ELSE 'Other'
    END as make,
    CASE
      WHEN title ~* '\\m(TCM|TCU|transmission control)\\M' THEN 'TCM'
      WHEN title ~* '\\m(BCM|body control)\\M' THEN 'BCM'
      WHEN title ~* '\\m(ECU|ECM|PCM|engine control|engine computer)\\M' THEN 'ECM'
      WHEN title ~* '\\m(TIPM)\\M' THEN 'TIPM'
      WHEN title ~* '\\m(fuse box|junction box|ipdm|relay box)\\M' THEN 'Fuse Box'
      WHEN title ~* '\\m(ABS|anti.lock|brake pump)\\M' THEN 'ABS'
      WHEN title ~* '\\m(amplifier|bose|harman|JBL)\\M' THEN 'Amplifier'
      WHEN title ~* '\\m(radio|stereo|receiver)\\M' THEN 'Radio'
      WHEN title ~* '\\m(cluster|speedometer|gauge)\\M' THEN 'Cluster'
      WHEN title ~* '\\m(throttle body)\\M' THEN 'Throttle'
      ELSE 'Other'
    END as part_type
  FROM "YourSale"
  WHERE "soldDate" >= NOW() - INTERVAL '30 days'
    AND "salePrice"::numeric >= 50 AND title IS NOT NULL
),
grouped AS (
  SELECT make, part_type, COUNT(*) as sold_7d, ROUND(AVG(price),2) as avg_price,
    ROUND(SUM(price),2) as total_rev, MAX("soldDate") as last_sold,
    (array_agg(title ORDER BY price DESC))[1] as sample_title
  FROM recent_sales WHERE make != 'Other' AND part_type != 'Other'
  GROUP BY make, part_type
),
with_stock AS (
  SELECT g.*, COALESCE((
    SELECT SUM(COALESCE(l."quantityAvailable",1)) FROM "YourListing" l
    WHERE l."listingStatus" = 'Active' AND l.title ILIKE '%' || g.make || '%'
    AND l.title ~* (CASE g.part_type
      WHEN 'ECM' THEN '\\m(ECU|ECM|PCM)\\M' WHEN 'ABS' THEN '\\m(ABS|anti.lock)\\M'
      WHEN 'BCM' THEN '\\m(BCM|body control)\\M' WHEN 'TCM' THEN '\\m(TCM|TCU)\\M'
      WHEN 'TIPM' THEN '\\m(TIPM)\\M' WHEN 'Fuse Box' THEN '\\m(fuse box|junction|ipdm)\\M'
      WHEN 'Amplifier' THEN '\\m(amplifier|bose|harman)\\M' WHEN 'Radio' THEN '\\m(radio|stereo)\\M'
      WHEN 'Cluster' THEN '\\m(cluster|speedometer)\\M' WHEN 'Throttle' THEN '\\m(throttle)\\M'
      ELSE g.part_type END)
  ),0) as stock FROM grouped g
)
SELECT *, 50 as score,
  CASE WHEN stock = 0 THEN 'OUT OF STOCK' WHEN stock <= 2 AND sold_7d > stock THEN 'LOW STOCK' ELSE 'MONITOR' END as action
FROM with_stock WHERE sold_7d > stock OR stock = 0 OR avg_price >= 300
ORDER BY total_rev DESC LIMIT 100;
`;

router.get('/report', async (req, res) => {
  try {
    let rows;
    try {
      const result = await database.raw(RESTOCK_QUERY);
      rows = result.rows || [];
    } catch (primaryErr) {
      // Fallback if part_number_base() doesn't exist or query errors
      console.log('Restock primary query failed, using fallback:', primaryErr.message);
      const result = await database.raw(RESTOCK_FALLBACK);
      rows = result.rows || [];
    }

    const tiers = { green: [], yellow: [], orange: [] };
    for (const row of rows) {
      let score = parseInt(row.score) || 50;
      const item = {
        make: row.make,
        model: row.model || null,
        partType: row.part_type,
        basePn: row.base_pn || null,
        variantPns: row.variant_pns || [],
        yearRange: row.year_min && row.year_max
          ? (row.year_min === row.year_max ? row.year_min : row.year_min + '-' + row.year_max) : null,
        sold7d: parseInt(row.sold_7d) || 0,
        activeStock: parseInt(row.stock) || 0,
        avgPrice: parseFloat(row.avg_price) || 0,
        revenue: parseFloat(row.total_rev) || 0,
        lastSold: row.last_sold,
        action: row.action,
        sampleTitle: row.sample_title,
        score,
      };

      // $300+ floor
      if (item.avgPrice >= 300 && score < 75) { item.score = 75; score = 75; }

      if (score >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (score >= 50) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      period: 'Last 7 days',
      tiers,
      summary: {
        green: tiers.green.length,
        yellow: tiers.yellow.length,
        orange: tiers.orange.length,
        total: rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
