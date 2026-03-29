'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const raw = (...args) => database.raw(...args);

class ReturnIntelligenceService {
  constructor() {
    this.log = log.child({ class: 'ReturnIntelligenceService' }, true);
  }

  // ─── Part type detection (mirrors partIntelligence.js categories) ───

  _detectPartType(title) {
    const upper = (title || '').toUpperCase();
    const rules = [
      ['ECM', /\bECM\b|\bPCM\b|ENGINE\s*CONTROL|ENGINE\s*COMPUTER|ENGINE\s*MODULE/],
      ['ABS', /\bABS\b|BRAKE\s*PUMP|BRAKE\s*MODULE|ANTI[\s-]*LOCK/],
      ['TCM', /\bTCM\b|\bTCU\b|TRANSMISSION\s*CONTROL|TRANSMISSION\s*MODULE/],
      ['BCM', /\bBCM\b|BODY\s*CONTROL/],
      ['TIPM', /\bTIPM\b|TOTALLY\s*INTEGRATED|\bFUSE\s*BOX\b|FUSE\s*RELAY|JUNCTION\s*BOX/],
      ['Radio', /\bRADIO\b|\bCD\s*PLAYER\b|\bRECEIVER\b|\bHEAD\s*UNIT\b|\bSTEREO\b|\bUCONNECT\b|\bSYNC\b/],
      ['Amplifier', /\bAMPLIFIER\b|\bAMP\s/],
      ['Cluster', /\bCLUSTER\b|\bSPEEDOMETER\b|\bINSTRUMENT\b/],
      ['Steering Module', /STEERING\s*MODULE|POWER\s*STEERING|\bEPS\s*MODULE\b/],
      ['HVAC Module', /\bHVAC\b|CLIMATE\s*CONTROL|A\/?C\s*CONTROL/],
      ['Camera', /\bCAMERA\b|BACKUP\s*CAM/],
      ['Airbag Module', /AIRBAG\s*MODULE|\bSRS\s*MODULE\b|\bRESTRAINT\b/],
      ['Blind Spot', /BLIND\s*SPOT/],
      ['Parking Sensor', /PARKING\s*SENSOR|PARK\s*ASSIST/],
      ['Liftgate Module', /LIFTGATE\s*MODULE|TAILGATE\s*MODULE/],
      ['Throttle Body', /THROTTLE\s*BODY/],
      ['Third Brake Light', /THIRD\s*BRAKE|3RD\s*BRAKE/],
      ['Transfer Case', /TRANSFER\s*CASE/],
      ['Mirror', /\bMIRROR\b/],
      ['Headlight', /HEADLIGHT|HEAD\s*LIGHT|HEADLAMP/],
      ['Tail Light', /TAIL\s*LIGHT|TAILLIGHT|TAIL\s*LAMP/],
      ['Door Lock', /DOOR\s*LOCK|\bLATCH\b/],
      ['Window Motor', /WINDOW\s*MOTOR|WINDOW\s*REG/],
      ['Blower Motor', /BLOWER\s*MOTOR/],
      ['Wiper Motor', /WIPER\s*MOTOR/],
      ['Sensor', /\bSENSOR\b/],
      ['Key Fob', /KEY\s*FOB|\bREMOTE\b|SMART\s*KEY/],
    ];
    for (const [type, pat] of rules) {
      if (pat.test(upper)) return type;
    }
    return 'Other';
  }

  _detectMake(title) {
    const upper = (title || '').toUpperCase();
    const makes = [
      ['FORD', /\bFORD\b/], ['DODGE', /\bDODGE\b/], ['CHRYSLER', /\bCHRYSLER\b/],
      ['JEEP', /\bJEEP\b/], ['RAM', /\bRAM\b/], ['TOYOTA', /\bTOYOTA\b/],
      ['HONDA', /\bHONDA\b/], ['NISSAN', /\bNISSAN\b/], ['HYUNDAI', /\bHYUNDAI\b/],
      ['KIA', /\bKIA\b/], ['VOLKSWAGEN', /\b(?:VOLKSWAGEN|VW)\b/], ['BMW', /\bBMW\b/],
      ['MERCEDES', /\bMERCEDES\b/], ['AUDI', /\bAUDI\b/], ['SUBARU', /\bSUBARU\b/],
      ['MAZDA', /\bMAZDA\b/], ['CHEVROLET', /\b(?:CHEVROLET|CHEVY)\b/], ['GMC', /\bGMC\b/],
      ['BUICK', /\bBUICK\b/], ['CADILLAC', /\bCADILLAC\b/], ['LINCOLN', /\bLINCOLN\b/],
      ['ACURA', /\bACURA\b/], ['LEXUS', /\bLEXUS\b/], ['INFINITI', /\bINFINITI\b/],
      ['MITSUBISHI', /\bMITSUBISHI\b/], ['VOLVO', /\bVOLVO\b/],
    ];
    for (const [make, pat] of makes) {
      if (pat.test(upper)) return make;
    }
    return 'Other';
  }

  // ─── SECTION 1: Summary stats for header cards ───

  async getSummary() {
    const allTime = await database('return_transaction')
      .count('* as total')
      .sum('abs_gross as total_dollars')
      .avg('abs_gross as avg_dollars')
      .first();

    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const ltm = await database('return_transaction')
      .count('* as total')
      .sum('abs_gross as total_dollars')
      .where('transaction_date', '>=', yearAgo.toISOString().split('T')[0])
      .first();

    const d90 = new Date();
    d90.setDate(d90.getDate() - 90);
    const last90 = await database('return_transaction')
      .count('* as total')
      .sum('abs_gross as total_dollars')
      .where('transaction_date', '>=', d90.toISOString().split('T')[0])
      .first();

    // INAD summary
    const inadAll = await database('return_transaction')
      .select(
        database.raw('SUM(CASE WHEN has_inad_fee THEN 1 ELSE 0 END) as inad_count'),
        database.raw('SUM(ABS(inad_fee)) as total_inad_fees')
      )
      .first();

    return {
      all_time: {
        count: parseInt(allTime.total || 0),
        dollars: parseFloat(allTime.total_dollars || 0),
        avg: parseFloat(allTime.avg_dollars || 0),
      },
      last_12_months: {
        count: parseInt(ltm.total || 0),
        dollars: parseFloat(ltm.total_dollars || 0),
      },
      last_90_days: {
        count: parseInt(last90.total || 0),
        dollars: parseFloat(last90.total_dollars || 0),
      },
      inad: {
        count: parseInt(inadAll.inad_count || 0),
        fees: parseFloat(inadAll.total_inad_fees || 0),
      },
    };
  }

  // ─── SECTION 2: Return rate by part type (cross-ref with YourSale) ───

  async getReturnRateByPartType({ months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Returns grouped by part_type (pre-computed in DB)
    const returns = await database('return_transaction')
      .select('part_type')
      .count('* as return_count')
      .sum('abs_gross as return_dollars')
      .avg('abs_gross as avg_return')
      .where('transaction_date', '>=', cutoffStr)
      .groupBy('part_type')
      .orderBy('return_count', 'desc');

    // Sales from YourSale — we detect part type in JS since YourSale has no part_type column
    const allSales = await database('YourSale')
      .select('title', raw('COUNT(*) as cnt'), raw('SUM(CAST("soldFor" AS decimal)) as dollars'))
      .where('saleDate', '>=', cutoffStr)
      .groupBy('title');

    const salesByType = {};
    for (const row of allSales) {
      const ptype = this._detectPartType(row.title);
      if (!salesByType[ptype]) salesByType[ptype] = { sale_count: 0, sale_dollars: 0 };
      salesByType[ptype].sale_count += parseInt(row.cnt);
      salesByType[ptype].sale_dollars += parseFloat(row.dollars || 0);
    }

    return returns.map(r => {
      const sales = salesByType[r.part_type] || { sale_count: 0, sale_dollars: 0 };
      const returnCount = parseInt(r.return_count);
      const returnRate = sales.sale_count > 0
        ? parseFloat((returnCount / sales.sale_count * 100).toFixed(1))
        : null;
      return {
        part_type: r.part_type,
        return_count: returnCount,
        return_dollars: parseFloat(r.return_dollars || 0),
        avg_return: parseFloat(r.avg_return || 0),
        sale_count: sales.sale_count,
        sale_dollars: sales.sale_dollars,
        return_rate_pct: returnRate,
      };
    });
  }

  // ─── SECTION 3: Problem parts (keyword/title grouping, 3+ returns) ───

  async getProblemParts({ minReturns = 3, months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const results = await database('return_transaction')
      .select(raw(`LEFT(item_title, 80) as title_key`))
      .min('item_title as sample_title')
      .count('* as return_count')
      .sum('abs_gross as return_dollars')
      .avg('abs_gross as avg_return')
      .min('transaction_date as first_return')
      .max('transaction_date as last_return')
      .where('transaction_date', '>=', cutoffStr)
      .groupBy(raw(`LEFT(item_title, 80)`))
      .having(raw('COUNT(*) >= ?', [minReturns]))
      .orderBy('return_count', 'desc')
      .limit(30);

    return results.map(r => ({
      title: r.sample_title,
      return_count: parseInt(r.return_count),
      return_dollars: parseFloat(r.return_dollars || 0),
      avg_return: parseFloat(r.avg_return || 0),
      first_return: r.first_return,
      last_return: r.last_return,
      part_type: this._detectPartType(r.sample_title),
      make: this._detectMake(r.sample_title),
    }));
  }

  // ─── SECTION 4: Repeat returners ───

  async getRepeatReturners({ minReturns = 3, months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const results = await database('return_transaction')
      .select('buyer_username')
      .count('* as return_count')
      .sum('abs_gross as total_refunded')
      .avg('abs_gross as avg_return')
      .min('transaction_date as first_return')
      .max('transaction_date as last_return')
      .where('transaction_date', '>=', cutoffStr)
      .whereNotNull('buyer_username')
      .groupBy('buyer_username')
      .having(raw('COUNT(*) >= ?', [minReturns]))
      .orderBy('return_count', 'desc')
      .limit(30);

    const enriched = [];
    for (const row of results) {
      const topTypes = await database('return_transaction')
        .select('part_type')
        .count('* as cnt')
        .where('buyer_username', row.buyer_username)
        .where('transaction_date', '>=', cutoffStr)
        .groupBy('part_type')
        .orderBy('cnt', 'desc')
        .limit(3);

      enriched.push({
        buyer_username: row.buyer_username,
        return_count: parseInt(row.return_count),
        total_refunded: parseFloat(row.total_refunded || 0),
        avg_return: parseFloat(row.avg_return || 0),
        first_return: row.first_return,
        last_return: row.last_return,
        top_part_types: topTypes.map(t => t.part_type),
      });
    }

    return enriched;
  }

  // ─── SECTION 5: Make-level return heat map ───

  async getReturnsByMake({ months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const returns = await database('return_transaction')
      .select('make')
      .count('* as return_count')
      .sum('abs_gross as return_dollars')
      .avg('abs_gross as avg_return')
      .where('transaction_date', '>=', cutoffStr)
      .where('make', '!=', 'Other')
      .groupBy('make')
      .orderBy('return_count', 'desc');

    // Cross-ref with YourSale
    const allSales = await database('YourSale')
      .select('title', raw('COUNT(*) as cnt'), raw('SUM(CAST("soldFor" AS decimal)) as dollars'))
      .where('saleDate', '>=', cutoffStr)
      .groupBy('title');

    const salesByMake = {};
    for (const row of allSales) {
      const make = this._detectMake(row.title);
      if (!salesByMake[make]) salesByMake[make] = { cnt: 0, dollars: 0 };
      salesByMake[make].cnt += parseInt(row.cnt);
      salesByMake[make].dollars += parseFloat(row.dollars || 0);
    }

    return returns.map(r => {
      const s = salesByMake[r.make] || { cnt: 0, dollars: 0 };
      return {
        make: r.make,
        return_count: parseInt(r.return_count),
        return_dollars: parseFloat(r.return_dollars || 0),
        avg_return: parseFloat(r.avg_return || 0),
        sale_count: s.cnt,
        sale_dollars: s.dollars,
        return_rate_pct: s.cnt > 0 ? parseFloat((parseInt(r.return_count) / s.cnt * 100).toFixed(1)) : null,
      };
    });
  }

  // ─── SECTION 6: Monthly/seasonal trend with rip-off season flags ───

  async getMonthlyTrend({ months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const monthly = await database('return_transaction')
      .select(raw(`TO_CHAR(transaction_date, 'YYYY-MM') as month`))
      .count('* as return_count')
      .sum('abs_gross as return_dollars')
      .avg('abs_gross as avg_return')
      .where('transaction_date', '>=', cutoffStr)
      .groupBy(raw(`TO_CHAR(transaction_date, 'YYYY-MM')`))
      .orderBy('month', 'asc');

    const seasonalAvg = await database('return_transaction')
      .select(raw(`EXTRACT(MONTH FROM transaction_date)::int as month_num`))
      .count('* as total_returns')
      .sum('abs_gross as total_dollars')
      .where('transaction_date', '>=', cutoffStr)
      .groupBy(raw(`EXTRACT(MONTH FROM transaction_date)`))
      .orderBy('month_num', 'asc');

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const yearsSpanned = Math.max(1, months / 12);

    const seasonal = seasonalAvg.map(s => {
      const mNum = parseInt(s.month_num);
      return {
        month: monthNames[mNum - 1],
        month_num: mNum,
        avg_monthly_returns: parseFloat((parseInt(s.total_returns) / yearsSpanned).toFixed(1)),
        avg_monthly_dollars: parseFloat((parseFloat(s.total_dollars) / yearsSpanned).toFixed(2)),
        is_rip_off_season: mNum >= 11 || mNum <= 2,
      };
    });

    return {
      monthly: monthly.map(m => ({
        month: m.month,
        return_count: parseInt(m.return_count),
        return_dollars: parseFloat(m.return_dollars || 0),
        avg_return: parseFloat(m.avg_return || 0),
      })),
      seasonal,
    };
  }

  // ─── SECTION 7: INAD fee tracker ───

  async getINADStats({ months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const overall = await database('return_transaction')
      .select(
        database.raw('COUNT(*) as total_returns'),
        database.raw('SUM(CASE WHEN has_inad_fee THEN 1 ELSE 0 END) as inad_count'),
        database.raw('SUM(ABS(inad_fee)) as total_inad_fees')
      )
      .where('transaction_date', '>=', cutoffStr)
      .first();

    const quarterly = await database('return_transaction')
      .select(
        database.raw(`TO_CHAR(transaction_date, 'YYYY-"Q"Q') as quarter`),
        database.raw('COUNT(*) as total_returns'),
        database.raw('SUM(CASE WHEN has_inad_fee THEN 1 ELSE 0 END) as inad_count'),
        database.raw('SUM(ABS(inad_fee)) as inad_fees')
      )
      .where('transaction_date', '>=', cutoffStr)
      .groupBy(database.raw(`TO_CHAR(transaction_date, 'YYYY-"Q"Q')`))
      .orderBy('quarter', 'asc');

    const byPartType = await database('return_transaction')
      .select(
        'part_type',
        database.raw('COUNT(*) as inad_count'),
        database.raw('SUM(ABS(inad_fee)) as inad_fees')
      )
      .where('transaction_date', '>=', cutoffStr)
      .where('has_inad_fee', true)
      .groupBy('part_type')
      .orderBy('inad_count', 'desc')
      .limit(10);

    return {
      total_returns: parseInt(overall.total_returns || 0),
      inad_count: parseInt(overall.inad_count || 0),
      inad_rate_pct: parseInt(overall.total_returns) > 0
        ? parseFloat((parseInt(overall.inad_count) / parseInt(overall.total_returns) * 100).toFixed(1))
        : 0,
      total_inad_fees: parseFloat(overall.total_inad_fees || 0),
      quarterly: quarterly.map(q => ({
        quarter: q.quarter,
        total_returns: parseInt(q.total_returns),
        inad_count: parseInt(q.inad_count),
        inad_rate_pct: parseInt(q.total_returns) > 0
          ? parseFloat((parseInt(q.inad_count) / parseInt(q.total_returns) * 100).toFixed(1))
          : 0,
        inad_fees: parseFloat(q.inad_fees || 0),
      })),
      by_part_type: byPartType.map(p => ({
        part_type: p.part_type,
        inad_count: parseInt(p.inad_count),
        inad_fees: parseFloat(p.inad_fees || 0),
      })),
    };
  }

  // ─── SECTION 8: High-value + high-frequency alerts ───

  async getHighValueHighFrequency({ minReturns = 3, minAvgPrice = 200, months = 36 } = {}) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const results = await database('return_transaction')
      .select('part_type', 'make')
      .count('* as return_count')
      .sum('abs_gross as return_dollars')
      .avg('abs_gross as avg_return')
      .where('transaction_date', '>=', cutoffStr)
      .where('part_type', '!=', 'Other')
      .groupBy('part_type', 'make')
      .having(raw('COUNT(*) >= ?', [minReturns]))
      .having(raw('AVG(abs_gross) >= ?', [minAvgPrice]))
      .orderBy('return_dollars', 'desc')
      .limit(20);

    return results.map(r => ({
      part_type: r.part_type,
      make: r.make,
      return_count: parseInt(r.return_count),
      return_dollars: parseFloat(r.return_dollars || 0),
      avg_return: parseFloat(r.avg_return || 0),
    }));
  }
}

module.exports = ReturnIntelligenceService;
