'use strict';

const { database } = require('../database/database');

/**
 * COGSService - True cost of goods calculation
 *
 * COGS = parts cost + gate fee + mileage. NO TAX - that's accounting, not pulling.
 * Puller sees TWO numbers: max parts spend (target) and 35% ceiling (absolute max).
 * Green under 25%, yellow 25-35%, red over 35%.
 */
class COGSService {

  /**
   * Calculate true COGS for a pull session (post-pull recording)
   */
  static async calculateSession(session) {
    const { yardId, parts, totalPaid } = session;
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const distanceMiles = parseFloat(yard.distance_from_base) || 0;
    const mileageCost = distanceMiles * 2 * 0.67; // IRS rate, round trip

    // Total true cost = parts + gate + mileage (NO TAX)
    const totalTrueCost = totalPaid + entryFee + mileageCost;
    const totalMarketValue = parts.reduce((sum, p) => sum + (p.marketValue || 0), 0);
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
   *
   * Returns TWO numbers:
   *   maxPartSpend - the TARGET (25% COGS ideal)
   *   ceilingPartSpend - the WALL (35% COGS absolute max)
   *
   * Formula: maxPartSpend = (totalMarketValue * targetRate) - gateFee - mileage
   * No tax in the calculation.
   */
  static async calculateGateMax(yardId, plannedParts) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const distanceMiles = parseFloat(yard.distance_from_base) || 0;
    const mileageCost = distanceMiles * 2 * 0.67;
    const fixedOverhead = entryFee + mileageCost;

    const totalMarketValue = plannedParts.reduce((sum, p) => sum + (p.marketValue || 0), 0);

    // Target: 25% COGS (ideal)
    const targetTotal = totalMarketValue * 0.25;
    const targetPartSpend = targetTotal - fixedOverhead;

    // Ceiling: 35% COGS (absolute max)
    const ceilingTotal = totalMarketValue * 0.35;
    const ceilingPartSpend = ceilingTotal - fixedOverhead;

    // Blended COGS % if they pay the target amount
    const blendedCogs = totalMarketValue > 0
      ? ((Math.max(0, targetPartSpend) + fixedOverhead) / totalMarketValue) * 100
      : 0;

    // Status based on whether target is achievable
    let status;
    if (ceilingPartSpend <= 0) status = 'leave';
    else if (targetPartSpend <= 0) status = 'acceptable'; // can pull but tight
    else status = 'excellent';

    return {
      yardName: yard.name,
      totalMarketValue: Math.round(totalMarketValue),
      fixedOverhead: Math.round(fixedOverhead * 100) / 100,
      entryFee,
      mileageCost: Math.round(mileageCost * 100) / 100,
      maxPartSpend: Math.max(0, Math.round(targetPartSpend)),
      ceilingPartSpend: Math.max(0, Math.round(ceilingPartSpend)),
      maxTotalCost: Math.round(ceilingTotal),
      blendedCogs: Math.round(blendedCogs * 10) / 10,
      status,
      message: ceilingPartSpend <= 0
        ? 'Overhead alone exceeds 35% ceiling. Not worth the trip for this list.'
        : targetPartSpend <= 0
          ? `Tight - overhead takes most of the budget. Max absolute: $${Math.round(ceilingPartSpend)}`
          : `Target: $${Math.round(targetPartSpend)} (25% COGS). Ceiling: $${Math.round(ceilingPartSpend)} (35%)`,
    };
  }

  static getVerdictLabel(cogsRate) {
    if (cogsRate <= 25) return { label: 'Excellent', color: 'green' };
    if (cogsRate <= 35) return { label: 'Acceptable', color: 'yellow' };
    return { label: 'Over Limit', color: 'red' };
  }
}

module.exports = COGSService;
