'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

const RESTOCK_QUERY = `
WITH recent_sales AS (
  SELECT
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
      ELSE 'Other'
    END as make,
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
    title,
    sku,
    "salePrice"::numeric as price,
    "soldDate",
    -- Extract year range from title
    (regexp_matches(title, '\\m((?:19|20)\\d{2})\\M', 'g'))[1] as title_year
  FROM "YourSale"
  WHERE "soldDate" >= NOW() - INTERVAL '7 days'
    AND title IS NOT NULL
),
grouped AS (
  SELECT
    make,
    part_type,
    COUNT(*) as sold_7d,
    ROUND(AVG(price), 2) as avg_price,
    MAX("soldDate") as last_sold,
    ROUND(SUM(price), 2) as total_rev,
    MIN(title_year) as year_min,
    MAX(title_year) as year_max,
    (array_agg(DISTINCT sku))[1:3] as skus,
    (array_agg(DISTINCT title))[1] as sample_title
  FROM recent_sales
  WHERE make != 'Other' AND part_type != 'Other'
  GROUP BY make, part_type
),
with_stock AS (
  SELECT g.*,
    COALESCE((
      SELECT SUM(l."quantityAvailable") FROM "YourListing" l
      WHERE l."listingStatus" = 'Active'
        AND l.title ILIKE '%' || g.make || '%'
        AND l.title ~* (CASE g.part_type
          WHEN 'ECM' THEN '\\m(ECU|ECM|PCM|engine control)\\M'
          WHEN 'ABS' THEN '\\m(ABS|anti.lock|brake pump)\\M'
          WHEN 'BCM' THEN '\\m(BCM|body control)\\M'
          WHEN 'TCM' THEN '\\m(TCM|TCU|transmission)\\M'
          WHEN 'TIPM' THEN '\\m(TIPM)\\M'
          WHEN 'Fuse Box' THEN '\\m(fuse box|fuse relay|junction|ipdm)\\M'
          WHEN 'Amplifier' THEN '\\m(amplifier|bose|harman|JBL)\\M'
          WHEN 'Radio' THEN '\\m(radio|stereo|receiver)\\M'
          WHEN 'Cluster' THEN '\\m(cluster|speedometer|gauge)\\M'
          WHEN 'Throttle' THEN '\\m(throttle body)\\M'
          ELSE g.part_type
        END)
    ), 0) as stock
  FROM grouped g
)
SELECT *,
  CASE
    WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW'
    WHEN stock = 0 THEN 'OUT OF STOCK'
    WHEN stock <= 1 AND sold_7d >= 2 THEN 'LOW STOCK'
    ELSE 'MONITOR'
  END as action
FROM with_stock
WHERE stock <= 1
ORDER BY avg_price DESC, sold_7d DESC
LIMIT 100;
`;

router.get('/report', async (req, res) => {
  try {
    const result = await database.raw(RESTOCK_QUERY);
    const rows = result.rows || [];

    const tiers = { green: [], yellow: [], orange: [] };
    for (const row of rows) {
      const item = {
        make: row.make,
        partType: row.part_type,
        yearRange: row.year_min && row.year_max ? (row.year_min === row.year_max ? row.year_min : row.year_min + '-' + row.year_max) : null,
        sold7d: parseInt(row.sold_7d) || 0,
        activeStock: parseInt(row.stock) || 0,
        avgPrice: parseFloat(row.avg_price) || 0,
        lastSold: row.last_sold,
        revenue: parseFloat(row.total_rev) || 0,
        action: row.action,
        sampleTitle: row.sample_title,
        skus: row.skus ? row.skus.filter(Boolean) : [],
      };

      if (row.action === 'RESTOCK NOW') { item.tier = 'green'; tiers.green.push(item); }
      else if (row.action === 'OUT OF STOCK') { item.tier = 'yellow'; tiers.yellow.push(item); }
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
