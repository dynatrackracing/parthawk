'use strict';

const { database } = require('../database/database');
const { getCogsReference, DEFAULT_MARKET_VALUES } = require('../config/yard-cogs-reference');

/**
 * COGSService - True cost of goods calculation
 *
 * COGS = parts cost + gate fee + mileage. NO TAX.
 * Puller sees: target spend (30%), ceiling (35%), live blended %, per-part colors.
 */
class COGSService {

  static async getYardProfile(yardId) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const distanceMiles = parseFloat(yard.distance_from_base) || 0;
    const mileageCost = Math.round(distanceMiles * 2 * 0.67 * 100) / 100;
    const cogsRef = getCogsReference(yard.chain);

    return {
      id: yard.id,
      name: yard.name,
      chain: yard.chain,
      entryFee,
      distanceMiles,
      mileageCost,
      fixedOverhead: Math.round((entryFee + mileageCost) * 100) / 100,
      cogsReference: cogsRef,
      defaultMarketValues: DEFAULT_MARKET_VALUES,
    };
  }

  static async calculateGateMax(yardId, plannedParts) {
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const mileageCost = parseFloat(yard.distance_from_base || 0) * 2 * 0.67;
    const fixedOverhead = entryFee + mileageCost;

    const totalMarketValue = plannedParts.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const totalCogs = plannedParts.reduce((sum, p) => sum + (p.cogs || 0), 0);

    const targetTotal = totalMarketValue * 0.30;
    const targetPartSpend = targetTotal - fixedOverhead;
    const ceilingTotal = totalMarketValue * 0.35;
    const ceilingPartSpend = ceilingTotal - fixedOverhead;

    const currentTotal = totalCogs + fixedOverhead;
    const blendedCogs = totalMarketValue > 0 ? (currentTotal / totalMarketValue) * 100 : 0;

    let status;
    if (ceilingPartSpend <= 0) status = 'leave';
    else if (blendedCogs <= 25) status = 'excellent';
    else if (blendedCogs <= 35) status = 'acceptable';
    else status = 'leave';

    return {
      yardName: yard.name,
      totalMarketValue: Math.round(totalMarketValue),
      fixedOverhead: Math.round(fixedOverhead * 100) / 100,
      entryFee,
      mileageCost: Math.round(mileageCost * 100) / 100,
      maxPartSpend: Math.max(0, Math.round(targetPartSpend)),
      ceilingPartSpend: Math.max(0, Math.round(ceilingPartSpend)),
      currentCogs: Math.round(totalCogs),
      currentTotal: Math.round(currentTotal),
      blendedCogs: Math.round(blendedCogs * 10) / 10,
      status,
    };
  }

  static async calculateSession(session) {
    const { yardId, parts, totalPaid } = session;
    const yard = await database('yard').where('id', yardId).first();
    if (!yard) throw new Error('Yard not found');

    const entryFee = parseFloat(yard.entry_fee) || 0;
    const mileageCost = parseFloat(yard.distance_from_base || 0) * 2 * 0.67;
    const totalTrueCost = totalPaid + entryFee + mileageCost;
    const totalMarketValue = parts.reduce((sum, p) => sum + (p.marketValue || 0), 0);
    const blendedCogsRate = totalMarketValue > 0 ? (totalTrueCost / totalMarketValue) * 100 : 0;

    const allocatedParts = parts.map(part => {
      const share = totalMarketValue > 0 ? part.marketValue / totalMarketValue : 0;
      const allocated = totalTrueCost * share;
      const rate = part.marketValue > 0 ? (allocated / part.marketValue) * 100 : 0;
      return { ...part, allocatedCost: Math.round(allocated * 100) / 100, cogsRate: Math.round(rate * 10) / 10,
        verdict: rate <= 25 ? 'excellent' : rate <= 35 ? 'acceptable' : 'over_limit' };
    });

    return {
      session: { totalPaid, entryFee, mileageCost: Math.round(mileageCost * 100) / 100,
        totalTrueCost: Math.round(totalTrueCost * 100) / 100, totalMarketValue,
        blendedCogsRate: Math.round(blendedCogsRate * 10) / 10,
        verdict: blendedCogsRate <= 25 ? 'excellent' : blendedCogsRate <= 35 ? 'acceptable' : 'over_limit',
        yardName: yard.name },
      parts: allocatedParts,
    };
  }
}

module.exports = COGSService;
