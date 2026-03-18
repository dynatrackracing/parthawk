'use strict';

const { database } = require('../database/database');

/**
 * COGSService - True cost of goods calculation
 * 
 * Spec Section 6: COGS includes parts cost, core fees, sales tax,
 * entry/gate fees, and mileage. All allocated proportionally by market value.
 * Puller sees ONE number. System calculates everything in background.
 * 
 * COGS ceiling: 35% of perceived market value
 */
class COGSService {

  /**
   * Calculate true COGS for a pull session
   * @param {Object} session
   * @param {string} session.yardId - Yard being visited
   * @param {Array} session.parts - [{ partType, marketValue, pullCost }]
   * @param {number} session.totalPaid - Amount paid at gate
   * @param {string} session.pullerId - Puller ID for mileage calc
   */
  static async calculateSession(session) {
    const { yardId, parts, totalPaid } = session;

    // Get yard cost profile
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    // Fixed overhead components
    const entryFee = parseFloat(yard.entry_fee) || 0;
    const taxRate = parseFloat(yard.tax_rate) || 0;
    const distanceMiles = parseFloat(yard.distance_from_base) || 0;

    // IRS standard mileage rate 2024: $0.67/mile
    const mileageRate = 0.67;
    const mileageCost = distanceMiles * 2 * mileageRate; // round trip

    // Sales tax on parts
    const taxOnParts = totalPaid * taxRate;

    // Total true cost of session
    const totalTrueCost = totalPaid + taxOnParts + entryFee + mileageCost;

    // Total market value of all parts
    const totalMarketValue = parts.reduce((sum, p) => sum + (p.marketValue || 0), 0);

    // Blended COGS rate
    const blendedCogsRate = totalMarketValue > 0 ? (totalTrueCost / totalMarketValue) * 100 : 0;

    // Allocate cost to each part proportionally by market value
    const allocatedParts = parts.map(part => {
      const valueShare = totalMarketValue > 0 ? part.marketValue / totalMarketValue : 0;
      const allocatedCost = totalTrueCost * valueShare;
      const cogsRate = part.marketValue > 0 ? (allocatedCost / part.marketValue) * 100 : 0;

      return {
        ...part,
        allocatedCost: Math.round(allocatedCost * 100) / 100,
        cogsRate: Math.round(cogsRate * 10) / 10,
        verdict: cogsRate <= 25 ? 'excellent' : cogsRate <= 35 ? 'acceptable' : 'over_limit',
      };
    });

    return {
      session: {
        totalPaid,
        taxOnParts: Math.round(taxOnParts * 100) / 100,
        entryFee,
        mileageCost: Math.round(mileageCost * 100) / 100,
        totalTrueCost: Math.round(totalTrueCost * 100) / 100,
        totalMarketValue,
        blendedCogsRate: Math.round(blendedCogsRate * 10) / 10,
        verdict: blendedCogsRate <= 25 ? 'excellent' : blendedCogsRate <= 35 ? 'acceptable' : 'over_limit',
        yardName: yard.name,
      },
      parts: allocatedParts,
    };
  }

  /**
   * Gate negotiation: what's the max you should pay?
   * Given planned parts and their market values, calculate max spend
   * to stay under the 35% COGS ceiling
   * 
   * @param {string} yardId
   * @param {Array} plannedParts - [{ partType, marketValue }]
   * @returns {Object} negotiation guidance
   */
  static async calculateGateMax(yardId, plannedParts) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const taxRate = parseFloat(yard.tax_rate) || 0;
    const distanceMiles = parseFloat(yard.distance_from_base) || 0;
    const mileageCost = distanceMiles * 2 * 0.67;

    const totalMarketValue = plannedParts.reduce((sum, p) => sum + (p.marketValue || 0), 0);

    // Fixed overhead (gate fee + mileage, before parts)
    const fixedOverhead = entryFee + mileageCost;

    // Max total cost to stay at 35% COGS
    const maxTotalCost = totalMarketValue * 0.35;

    // Max parts spend = max total cost - fixed overhead - tax
    // tax = parts_spend * taxRate, so:
    // max_parts + (max_parts * taxRate) + fixedOverhead = maxTotalCost
    // max_parts * (1 + taxRate) = maxTotalCost - fixedOverhead
    const maxPartSpend = (maxTotalCost - fixedOverhead) / (1 + taxRate);

    const status = maxPartSpend <= 0 ? 'leave' :
                   maxPartSpend < 50 ? 'tight' : 'go';

    return {
      yardName: yard.name,
      totalMarketValue: Math.round(totalMarketValue),
      fixedOverhead: Math.round(fixedOverhead * 100) / 100,
      entryFee,
      mileageCost: Math.round(mileageCost * 100) / 100,
      taxRate: (taxRate * 100).toFixed(2) + '%',
      maxPartSpend: Math.max(0, Math.round(maxPartSpend)),
      maxTotalCost: Math.round(maxTotalCost),
      message: maxPartSpend <= 0
        ? 'Overhead alone exceeds 35% COGS ceiling. Not worth the trip for this list.'
        : `Max parts spend to stay under 35% COGS: $${Math.max(0, Math.round(maxPartSpend))}`,
      status,
      breakdown: {
        ceiling: '35% of $' + Math.round(totalMarketValue) + ' = $' + Math.round(maxTotalCost),
        overhead: 'Gate $' + entryFee + ' + Mileage $' + Math.round(mileageCost) + ' = $' + Math.round(fixedOverhead),
        available_for_parts: '$' + Math.max(0, Math.round(maxPartSpend)) + ' (before ' + (taxRate * 100).toFixed(1) + '% tax)',
      }
    };
  }

  /**
   * Quick COGS warning levels
   */
  static getVerdictLabel(cogsRate) {
    if (cogsRate <= 25) return { label: 'Excellent', color: 'green' };
    if (cogsRate <= 35) return { label: 'Acceptable', color: 'yellow' };
    return { label: 'Over Limit', color: 'red' };
  }
}

module.exports = COGSService;
