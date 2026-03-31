'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

/**
 * LearningsService — aggregates actionable patterns from dead inventory,
 * returns, and stale price reduction outcomes.
 */
class LearningsService {
  constructor() {
    this.log = log.child({ class: 'LearningsService' }, true);
  }

  async getLearnings() {
    const [deadPatterns, returnPatterns, staleOutcomes] = await Promise.all([
      this.getDeadPatterns(),
      this.getReturnPatterns(),
      this.getStaleOutcomes(),
    ]);

    return {
      deadPatterns,
      returnPatterns,
      staleOutcomes,
      generatedAt: new Date().toISOString(),
    };
  }

  async getDeadPatterns() {
    try {
      const rows = await database('dead_inventory')
        .select('part_number_base')
        .select(database.raw('COUNT(*) as death_count'))
        .select(database.raw('array_agg(DISTINCT failure_reason) as reasons'))
        .select(database.raw('MAX("createdAt") as last_death'))
        .groupBy('part_number_base')
        .havingRaw('COUNT(*) >= 2')
        .orderByRaw('COUNT(*) DESC')
        .limit(50);

      // Enrich with part name from Item table + vehicle from Auto/AIC
      const enriched = [];
      for (const r of rows) {
        let partName = null;
        let yearStart = null;
        let yearEnd = null;
        let make = null;
        let model = null;

        try {
          // 1. Look up Item by manufacturerPartNumber (case-insensitive)
          const item = await database('Item')
            .whereRaw('LOWER("manufacturerPartNumber") = ?', [r.part_number_base.toLowerCase()])
            .select('id', 'title')
            .first();

          if (item) {
            partName = item.title;

            // 2. Get vehicle fitment via AutoItemCompatibility → Auto
            const autos = await database('AutoItemCompatibility as aic')
              .join('Auto as a', 'a.id', 'aic.autoId')
              .where('aic.itemId', item.id)
              .select('a.year', 'a.make', 'a.model')
              .orderBy('a.year', 'asc');

            if (autos.length > 0) {
              yearStart = autos[0].year;
              yearEnd = autos[autos.length - 1].year;
              // Use the most common make/model across matches
              const makeModelCounts = {};
              for (const a of autos) {
                const key = `${a.make}|${a.model}`;
                makeModelCounts[key] = (makeModelCounts[key] || 0) + 1;
              }
              const topMakeModel = Object.entries(makeModelCounts)
                .sort((a, b) => b[1] - a[1])[0][0];
              [make, model] = topMakeModel.split('|');
            }
          }

          // Fallback: try dead_inventory's own description/vehicle_application fields
          if (!partName) {
            const diRow = await database('dead_inventory')
              .where('part_number_base', r.part_number_base)
              .whereNotNull('description')
              .select('description', 'vehicle_application')
              .first();
            if (diRow) {
              partName = diRow.description || null;
              if (!make && diRow.vehicle_application) {
                const m = diRow.vehicle_application.match(/\b((?:19|20)\d{2})\s+(\w+)\s+(\w[\w\s-]*)/i);
                if (m) {
                  yearStart = parseInt(m[1]);
                  yearEnd = yearStart;
                  make = m[2];
                  model = m[3].trim();
                }
              }
            }
          }
        } catch (e) {
          // enrichment failed, continue with nulls
        }

        enriched.push({
          partNumberBase: r.part_number_base,
          deathCount: parseInt(r.death_count),
          reasons: (r.reasons || []).filter(Boolean),
          lastDeath: r.last_death,
          partName,
          yearStart,
          yearEnd,
          make,
          model,
        });
      }
      return enriched;
    } catch (e) {
      return [];
    }
  }

  async getReturnPatterns() {
    try {
      const byGrade = await database('return_intake')
        .select('condition_grade')
        .count('* as count')
        .groupBy('condition_grade')
        .orderByRaw('COUNT(*) DESC');

      const repeatOffenders = await database('return_intake')
        .select('title', 'part_number')
        .count('* as return_count')
        .groupBy('title', 'part_number')
        .havingRaw('COUNT(*) >= 2')
        .orderByRaw('COUNT(*) DESC')
        .limit(20);

      const totalReturns = byGrade.reduce((sum, r) => sum + parseInt(r.count), 0);

      return {
        totalReturns,
        byGrade: byGrade.map(r => ({ grade: r.condition_grade, count: parseInt(r.count) })),
        repeatOffenders: repeatOffenders.map(r => ({
          title: r.title,
          partNumber: r.part_number,
          returnCount: parseInt(r.return_count),
        })),
      };
    } catch (e) {
      return { totalReturns: 0, byGrade: [], repeatOffenders: [] };
    }
  }

  async getStaleOutcomes() {
    try {
      const actions = await database('stale_inventory_action')
        .where('executed', true)
        .where('action_type', 'price_reduction')
        .select('ebay_item_id', 'old_price', 'new_price', 'executed_at');

      if (actions.length === 0) {
        return { totalActions: 0, successRate: 0, avgReductionPercent: 0, avgDaysToSellAfterReduction: null };
      }

      let successes = 0;
      let totalReductionPct = 0;
      let totalDaysToSell = 0;
      let sellCount = 0;

      for (const action of actions) {
        const oldPrice = parseFloat(action.old_price) || 0;
        const newPrice = parseFloat(action.new_price) || 0;
        if (oldPrice > 0) {
          totalReductionPct += ((oldPrice - newPrice) / oldPrice) * 100;
        }

        // Check if a YourSale record exists after the reduction
        try {
          const sale = await database('YourSale')
            .where('ebayItemId', action.ebay_item_id)
            .where('soldDate', '>', action.executed_at)
            .first();
          if (sale) {
            successes++;
            const daysToSell = Math.floor((new Date(sale.soldDate) - new Date(action.executed_at)) / 86400000);
            totalDaysToSell += daysToSell;
            sellCount++;
          }
        } catch (e) { /* skip */ }
      }

      return {
        totalActions: actions.length,
        successRate: actions.length > 0 ? Math.round((successes / actions.length) * 100) : 0,
        avgReductionPercent: actions.length > 0 ? Math.round(totalReductionPct / actions.length) : 0,
        avgDaysToSellAfterReduction: sellCount > 0 ? Math.round(totalDaysToSell / sellCount) : null,
      };
    } catch (e) {
      return { totalActions: 0, successRate: 0, avgReductionPercent: 0, avgDaysToSellAfterReduction: null };
    }
  }
}

module.exports = LearningsService;
