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
      WHEN title ILIKE '%Pontiac%' THEN 'Pontiac'
      WHEN title ILIKE '%Saturn%' THEN 'Saturn'
      WHEN title ILIKE '%Mercury%' THEN 'Mercury'
      WHEN title ILIKE '%Scion%' THEN 'Scion'
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
      WHEN title ~* '\\m(steering|EPS|power steering)\\M' THEN 'Steering'
      WHEN title ~* '\\m(mirror|side view)\\M' THEN 'Mirror'
      ELSE 'Other'
    END as part_type,
    title,
    sku,
    "salePrice"::numeric as price,
    "soldDate"
  FROM "YourSale"
  WHERE "soldDate" >= NOW() - INTERVAL '30 days'
    AND title IS NOT NULL
    AND "salePrice"::numeric >= 50
),
grouped AS (
  SELECT
    make,
    part_type,
    COUNT(*) as sold_30d,
    COUNT(*) FILTER (WHERE "soldDate" >= NOW() - INTERVAL '7 days') as sold_7d,
    ROUND(AVG(price), 2) as avg_price,
    ROUND(SUM(price), 2) as total_rev,
    MAX("soldDate") as last_sold,
    MIN((regexp_matches(title, '\\m((?:19|20)\\d{2})\\M'))[1]) as year_min,
    MAX((regexp_matches(title, '\\m((?:19|20)\\d{2})\\M'))[1]) as year_max,
    (array_agg(DISTINCT title ORDER BY title))[1] as sample_title,
    (array_agg(DISTINCT sku ORDER BY sku))[1:3] as skus
  FROM recent_sales
  WHERE make != 'Other' AND part_type != 'Other'
  GROUP BY make, part_type
  HAVING COUNT(*) >= 1
),
with_stock AS (
  SELECT g.*,
    COALESCE((
      SELECT SUM(COALESCE(l."quantityAvailable", 1))
      FROM "YourListing" l
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
          WHEN 'Steering' THEN '\\m(steering|EPS|power steering)\\M'
          WHEN 'Mirror' THEN '\\m(mirror|side view)\\M'
          ELSE g.part_type
        END)
    ), 0) as stock
  FROM grouped g
)
SELECT *,
  -- Score: demand (35) + price (25) + stock urgency (25) + recency (15)
  LEAST(100, (
    CASE WHEN sold_30d >= 10 THEN 35 WHEN sold_30d >= 6 THEN 28 WHEN sold_30d >= 4 THEN 22 WHEN sold_30d >= 2 THEN 15 ELSE 8 END
    + CASE WHEN avg_price >= 300 THEN 25 WHEN avg_price >= 200 THEN 20 WHEN avg_price >= 150 THEN 15 WHEN avg_price >= 100 THEN 10 ELSE 5 END
    + CASE WHEN stock = 0 THEN 25 WHEN stock <= 2 AND sold_30d > stock THEN 18 WHEN sold_30d > stock THEN 12 ELSE 0 END
    + CASE WHEN last_sold >= NOW() - INTERVAL '3 days' THEN 15 WHEN last_sold >= NOW() - INTERVAL '7 days' THEN 12 WHEN last_sold >= NOW() - INTERVAL '14 days' THEN 8 ELSE 4 END
  )) as score,
  CASE
    WHEN stock = 0 AND avg_price >= 200 THEN 'RESTOCK NOW'
    WHEN stock = 0 THEN 'OUT OF STOCK'
    WHEN stock <= 2 AND sold_30d > stock THEN 'LOW STOCK'
    WHEN sold_30d > stock THEN 'SELLING FAST'
    ELSE 'MONITOR'
  END as action,
  EXTRACT(DAY FROM NOW() - last_sold)::int as days_since_sold
FROM with_stock
WHERE sold_30d > stock OR stock = 0 OR (avg_price >= 300 AND sold_30d >= 1)
ORDER BY score DESC, total_rev DESC
LIMIT 100;
`;

router.get('/report', async (req, res) => {
  try {
    const result = await database.raw(RESTOCK_QUERY);
    const rows = result.rows || [];

    const tiers = { green: [], yellow: [], orange: [] };
    for (const row of rows) {
      const score = parseInt(row.score) || 0;
      const item = {
        score,
        make: row.make,
        partType: row.part_type,
        yearRange: row.year_min && row.year_max
          ? (row.year_min === row.year_max ? row.year_min : row.year_min + '-' + row.year_max)
          : null,
        sold30d: parseInt(row.sold_30d) || 0,
        sold7d: parseInt(row.sold_7d) || 0,
        activeStock: parseInt(row.stock) || 0,
        avgPrice: parseFloat(row.avg_price) || 0,
        lastSold: row.last_sold,
        daysSinceSold: parseInt(row.days_since_sold) || 0,
        revenue: parseFloat(row.total_rev) || 0,
        action: row.action,
        sampleTitle: row.sample_title,
        skus: row.skus ? row.skus.filter(Boolean) : [],
      };

      // Floor: $300+ parts with any sales get minimum yellow
      if (item.avgPrice >= 300 && item.sold30d >= 1 && score < 75) item.score = 75;

      const s = item.score;
      if (s >= 75) { item.tier = 'green'; tiers.green.push(item); }
      else if (s >= 50) { item.tier = 'yellow'; tiers.yellow.push(item); }
      else { item.tier = 'orange'; tiers.orange.push(item); }
    }

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      period: 'Last 30 days',
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
