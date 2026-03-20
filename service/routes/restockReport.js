'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

const RESTOCK_QUERY = `
WITH sales_grouped AS (
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
    SUBSTRING(title FROM '(?:Toyota|Honda|Ford|Dodge|Chrysler|Jeep|Ram|Chevy|Chevrolet|GMC|Nissan|Hyundai|Kia|Mazda|BMW|Mercedes|Volkswagen|Audi|Lexus|Acura|Infiniti|Volvo|Mitsubishi|Buick|Cadillac|Lincoln|Subaru)\\s+(\\w+)') as model,
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
    "salePrice"::numeric as price,
    "soldDate"
  FROM "YourSale"
  WHERE "soldDate" >= NOW() - INTERVAL '180 days'
),
aggregated AS (
  SELECT
    make,
    model,
    part_type,
    COUNT(*) as sold_180d,
    COUNT(*) FILTER (WHERE "soldDate" >= NOW() - INTERVAL '90 days') as sold_90d,
    ROUND(
      SUM(price * CASE
        WHEN "soldDate" >= NOW() - INTERVAL '30 days' THEN 1.0
        WHEN "soldDate" >= NOW() - INTERVAL '90 days' THEN 0.75
        ELSE 0.5
      END) / NULLIF(SUM(CASE
        WHEN "soldDate" >= NOW() - INTERVAL '30 days' THEN 1.0
        WHEN "soldDate" >= NOW() - INTERVAL '90 days' THEN 0.75
        ELSE 0.5
      END), 0), 2
    ) as avg_price,
    MAX("soldDate") as last_sold,
    ROUND(SUM(price), 2) as total_rev
  FROM sales_grouped
  WHERE make != 'Other' AND part_type != 'Other' AND model IS NOT NULL AND LENGTH(model) >= 2
  GROUP BY make, model, part_type
),
with_stock AS (
  SELECT a.*,
    COALESCE((
      SELECT COUNT(*) FROM "YourListing" l
      WHERE l."listingStatus" = 'Active'
        AND l.title ILIKE '%' || a.make || '%'
        AND l.title ILIKE '%' || a.model || '%'
        AND l.title ~* (CASE a.part_type
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
          ELSE a.part_type
        END)
    ), 0) as stock
  FROM aggregated a
)
SELECT *,
  LEAST(100, (
    CASE WHEN sold_180d >= 12 THEN 35 WHEN sold_180d >= 8 THEN 30 WHEN sold_180d >= 5 THEN 24 WHEN sold_180d >= 3 THEN 18 WHEN sold_180d >= 2 THEN 12 ELSE 0 END
    + CASE WHEN avg_price >= 400 THEN 25 WHEN avg_price >= 300 THEN 22 WHEN avg_price >= 250 THEN 19 WHEN avg_price >= 200 THEN 16 WHEN avg_price >= 150 THEN 12 WHEN avg_price >= 100 THEN 8 ELSE 4 END
    + CASE WHEN stock = 0 THEN 25 WHEN stock = 1 AND sold_90d >= 3 THEN 18 WHEN stock <= 2 AND sold_90d >= 4 THEN 12 ELSE 0 END
    + CASE WHEN last_sold >= NOW() - INTERVAL '7 days' THEN 15 WHEN last_sold >= NOW() - INTERVAL '14 days' THEN 12 WHEN last_sold >= NOW() - INTERVAL '30 days' THEN 8 ELSE 4 END
  )) as score,
  EXTRACT(DAY FROM NOW() - last_sold)::int as days_since_sold
FROM with_stock
WHERE sold_180d >= 2 AND avg_price >= 80 AND (stock = 0 OR stock <= 2)
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
        model: row.model,
        vehicle: row.make + ' ' + row.model,
        partType: row.part_type,
        sold180d: parseInt(row.sold_180d) || 0,
        sold90d: parseInt(row.sold_90d) || 0,
        activeStock: parseInt(row.stock) || 0,
        avgPrice: parseFloat(row.avg_price) || 0,
        lastSold: row.last_sold,
        daysSinceSold: parseInt(row.days_since_sold) || 0,
        revenue180d: parseFloat(row.total_rev) || 0,
      };

      if (score >= 80) { item.tier = 'green'; item.action = 'RESTOCK NOW'; tiers.green.push(item); }
      else if (score >= 60) { item.tier = 'yellow'; item.action = 'STRONG BUY'; tiers.yellow.push(item); }
      else if (score >= 40) { item.tier = 'orange'; item.action = 'CONSIDER'; tiers.orange.push(item); }
    }

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      tiers,
      summary: {
        green: tiers.green.length,
        yellow: tiers.yellow.length,
        orange: tiers.orange.length,
        total: tiers.green.length + tiers.yellow.length + tiers.orange.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
