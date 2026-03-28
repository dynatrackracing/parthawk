'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

// Part type detection matching AttackListService pattern
const TYPE_PATTERNS = [
  { re: /\b(TCM|TCU|TRANSMISSION\s*CONTROL)\b/i, type: 'TCM' },
  { re: /\b(BCM|BODY\s*CONTROL)\b/i, type: 'BCM' },
  { re: /\b(ECM|ECU|PCM|ENGINE\s*CONTROL|ENGINE\s*COMPUTER)\b/i, type: 'ECM' },
  { re: /\b(ABS|ANTI.?LOCK|BRAKE\s*MODULE)\b/i, type: 'ABS' },
  { re: /\b(TIPM|FUSE\s*BOX|JUNCTION|IPDM)\b/i, type: 'TIPM' },
  { re: /\b(AMP|AMPLIFIER|BOSE|HARMAN|JBL)\b/i, type: 'AMP' },
  { re: /\b(CLUSTER|SPEEDOMETER|INSTRUMENT)\b/i, type: 'CLUSTER' },
  { re: /\b(RADIO|HEAD\s*UNIT|INFOTAINMENT|STEREO)\b/i, type: 'RADIO' },
  { re: /\b(THROTTLE\s*BODY)\b/i, type: 'THROTTLE' },
  { re: /\b(STEERING|EPS)\b/i, type: 'STEERING' },
  { re: /\b(MIRROR)\b/i, type: 'MIRROR' },
  { re: /\b(WINDOW.*(MOTOR|REGULATOR))\b/i, type: 'REGULATOR' },
  { re: /\b(ALTERNATOR)\b/i, type: 'ALTERNATOR' },
  { re: /\b(STARTER)\b/i, type: 'STARTER' },
  { re: /\b(CAMERA|BACKUP\s*CAM)\b/i, type: 'CAMERA' },
  { re: /\b(BLOWER\s*MOTOR)\b/i, type: 'BLOWER' },
  { re: /\b(HVAC|CLIMATE|HEATER)\s*(CONTROL|MODULE)?\b/i, type: 'HVAC' },
];

function detectType(title) {
  if (!title) return 'OTHER';
  for (const { re, type } of TYPE_PATTERNS) { if (re.test(title)) return type; }
  return 'OTHER';
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

class LifecycleService {
  constructor() {
    this.log = log.child({ class: 'LifecycleService' }, true);
  }

  // ── 4a: Lifecycle Analytics ──

  async getLifecycleMetrics({ daysBack = 365 } = {}) {
    const cutoff = new Date(Date.now() - daysBack * 86400000);

    // Get all sales with listing startTime for time-to-sell
    const sales = await database('YourSale')
      .leftJoin('YourListing', 'YourSale.ebayItemId', 'YourListing.ebayItemId')
      .where('YourSale.soldDate', '>=', cutoff)
      .select(
        'YourSale.title', 'YourSale.salePrice', 'YourSale.soldDate',
        'YourSale.ebayItemId', 'YourListing.startTime', 'YourListing.currentPrice'
      );

    // Get returns for return rate
    let returnMap = new Map();
    try {
      const returns = await database('return_intake')
        .select('ebay_item_id', 'condition_grade');
      for (const r of returns) returnMap.set(r.ebay_item_id, r);
    } catch (e) {}

    // Get stale actions for price decay
    let staleMap = new Map();
    try {
      const actions = await database('stale_inventory_action')
        .where('executed', true)
        .select('ebay_item_id', 'old_price', 'new_price');
      for (const a of actions) staleMap.set(a.ebay_item_id, a);
    } catch (e) {}

    // Group by part type
    const typeMap = {};
    for (const sale of sales) {
      const pt = detectType(sale.title);
      if (pt === 'OTHER') continue;

      if (!typeMap[pt]) {
        typeMap[pt] = { salesCount: 0, totalRevenue: 0, prices: [], daysToSell: [], decays: [], returnCount: 0 };
      }
      const t = typeMap[pt];
      const price = parseFloat(sale.salePrice) || 0;
      t.salesCount++;
      t.totalRevenue += price;
      t.prices.push(price);

      // Time to sell
      if (sale.startTime && sale.soldDate) {
        const days = Math.floor((new Date(sale.soldDate) - new Date(sale.startTime)) / 86400000);
        if (days >= 0 && days < 1000) t.daysToSell.push(days);
      }

      // Price decay
      const stale = staleMap.get(sale.ebayItemId);
      if (stale) {
        const oldP = parseFloat(stale.old_price) || 0;
        if (oldP > 0) t.decays.push(((oldP - price) / oldP) * 100);
      }

      // Return
      if (returnMap.has(sale.ebayItemId)) t.returnCount++;
    }

    // Build result
    const partTypes = Object.entries(typeMap).map(([pt, t]) => {
      const sorted = t.daysToSell.slice().sort((a, b) => a - b);
      const median = sorted.length > 0
        ? (sorted.length % 2 === 0 ? (sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2 : sorted[Math.floor(sorted.length/2)])
        : null;

      return {
        partType: pt,
        salesCount: t.salesCount,
        totalRevenue: Math.round(t.totalRevenue),
        avgPrice: t.salesCount > 0 ? Math.round(t.totalRevenue / t.salesCount) : 0,
        avgDaysToSell: sorted.length > 0 ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
        medianDaysToSell: median !== null ? Math.round(median) : null,
        avgDecayPercent: t.decays.length > 0 ? Math.round(t.decays.reduce((a, b) => a + b, 0) / t.decays.length * 10) / 10 : 0,
        returnRate: t.salesCount > 0 ? Math.round((t.returnCount / t.salesCount) * 1000) / 10 : 0,
        returnCount: t.returnCount,
        velocity: median !== null ? (median < 14 ? 'fast' : median > 90 ? 'slow' : 'normal') : 'unknown',
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = partTypes.reduce((s, p) => s + p.totalRevenue, 0);
    const totalSales = partTypes.reduce((s, p) => s + p.salesCount, 0);
    const allDays = Object.values(typeMap).flatMap(t => t.daysToSell);
    const avgDaysAll = allDays.length > 0 ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : null;

    return {
      partTypes,
      totals: { totalRevenue, totalSales, avgDaysToSell: avgDaysAll, periodDays: daysBack },
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 4b: Seasonal Intelligence ──

  async getSeasonalPatterns({ yearsBack = 2 } = {}) {
    const cutoff = new Date(Date.now() - yearsBack * 365 * 86400000);

    // Monthly aggregation
    const monthlyRows = await database.raw(`
      SELECT EXTRACT(MONTH FROM "soldDate")::int as month,
             COUNT(*) as sales,
             SUM("salePrice"::numeric) as revenue,
             AVG("salePrice"::numeric) as avg_price,
             COUNT(DISTINCT EXTRACT(YEAR FROM "soldDate")) as year_count
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(MONTH FROM "soldDate")
      ORDER BY month
    `, [cutoff]);

    const avgSalesAll = monthlyRows.rows.length > 0
      ? monthlyRows.rows.reduce((s, r) => s + parseInt(r.sales), 0) / monthlyRows.rows.length
      : 1;

    // Ensure all 12 months present
    const monthMap = {};
    for (let i = 1; i <= 12; i++) monthMap[i] = { month: i, name: MONTH_NAMES[i-1], avgSales: 0, avgRevenue: 0, avgPrice: 0, vsAverage: '0%' };
    for (const r of monthlyRows.rows) {
      const yc = parseInt(r.year_count) || 1;
      const avg = Math.round(parseInt(r.sales) / yc);
      const pct = Math.round(((avg - avgSalesAll / (monthlyRows.rows.length > 0 ? 1 : 1)) / (avgSalesAll / (monthlyRows.rows.length > 0 ? 1 : 1))) * 100);
      monthMap[r.month] = {
        month: r.month, name: MONTH_NAMES[r.month - 1],
        avgSales: avg,
        avgRevenue: Math.round(parseFloat(r.revenue) / yc),
        avgPrice: Math.round(parseFloat(r.avg_price)),
        vsAverage: (pct >= 0 ? '+' : '') + pct + '%',
      };
    }
    const monthly = Object.values(monthMap);

    // Part type seasonal peaks (top 10 part types)
    const ptSeasonalRows = await database.raw(`
      SELECT title, EXTRACT(MONTH FROM "soldDate")::int as month, COUNT(*) as cnt
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY title, EXTRACT(MONTH FROM "soldDate")
    `, [cutoff]);

    // Group by detected part type + month
    const ptMonths = {};
    for (const r of ptSeasonalRows.rows) {
      const pt = detectType(r.title);
      if (pt === 'OTHER') continue;
      if (!ptMonths[pt]) ptMonths[pt] = {};
      ptMonths[pt][r.month] = (ptMonths[pt][r.month] || 0) + parseInt(r.cnt);
    }

    const partTypeSeasons = Object.entries(ptMonths)
      .map(([pt, months]) => {
        const entries = Object.entries(months).map(([m, c]) => ({ month: parseInt(m), count: c }));
        if (entries.length < 2) return null;
        const avg = entries.reduce((s, e) => s + e.count, 0) / entries.length;
        const peak = entries.reduce((a, b) => b.count > a.count ? b : a);
        const slow = entries.reduce((a, b) => b.count < a.count ? b : a);
        return {
          partType: pt,
          peakMonth: MONTH_NAMES[peak.month - 1],
          peakVsAvg: avg > 0 ? '+' + Math.round(((peak.count - avg) / avg) * 100) + '%' : '—',
          slowMonth: MONTH_NAMES[slow.month - 1],
          slowVsAvg: avg > 0 ? Math.round(((slow.count - avg) / avg) * 100) + '%' : '—',
          totalSales: entries.reduce((s, e) => s + e.count, 0),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 10);

    // Day of week
    const dowRows = await database.raw(`
      SELECT EXTRACT(DOW FROM "soldDate")::int as dow, COUNT(*) as sales,
             COUNT(DISTINCT DATE_TRUNC('week', "soldDate")) as week_count
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(DOW FROM "soldDate") ORDER BY dow
    `, [cutoff]);

    const dayMap = {};
    for (let i = 0; i < 7; i++) dayMap[i] = { day: i, name: DAY_NAMES[i], avgSales: 0 };
    for (const r of dowRows.rows) {
      const wc = parseInt(r.week_count) || 1;
      dayMap[r.dow] = { day: r.dow, name: DAY_NAMES[r.dow], avgSales: Math.round(parseInt(r.sales) / wc * 10) / 10 };
    }
    const dayOfWeek = Object.values(dayMap);

    // Quarterly trends
    const qRows = await database.raw(`
      SELECT EXTRACT(YEAR FROM "soldDate")::int as yr,
             EXTRACT(QUARTER FROM "soldDate")::int as qtr,
             COUNT(*) as sales,
             SUM("salePrice"::numeric) as revenue
      FROM "YourSale" WHERE "soldDate" >= ? AND "soldDate" IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM "soldDate"), EXTRACT(QUARTER FROM "soldDate")
      ORDER BY yr, qtr
    `, [cutoff]);

    const quarterly = qRows.rows.map((r, i) => {
      const prev = i > 0 ? qRows.rows[i - 1] : null;
      const prevYear = qRows.rows.find(x => x.yr === r.yr - 1 && x.qtr === r.qtr);
      return {
        quarter: `Q${r.qtr} ${r.yr}`,
        sales: parseInt(r.sales),
        revenue: Math.round(parseFloat(r.revenue)),
        vsLastQuarter: prev ? ((parseInt(r.sales) - parseInt(prev.sales)) >= 0 ? '+' : '') + Math.round(((parseInt(r.sales) - parseInt(prev.sales)) / parseInt(prev.sales)) * 100) + '%' : '—',
        vsLastYear: prevYear ? ((parseInt(r.sales) - parseInt(prevYear.sales)) >= 0 ? '+' : '') + Math.round(((parseInt(r.sales) - parseInt(prevYear.sales)) / parseInt(prevYear.sales)) * 100) + '%' : '—',
      };
    });

    return { monthly, partTypeSeasons, dayOfWeek, quarterly, generatedAt: new Date().toISOString() };
  }
}

module.exports = LifecycleService;
