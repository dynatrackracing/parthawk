'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');
const { v4: uuidv4 } = require('uuid');
const { normalizePartNumber } = require('../lib/partNumberUtils');

class CacheService {
  constructor() {
    this.log = log.child({ class: 'CacheService' }, true);
  }

  /**
   * Claim a part from any puller tool or manual entry.
   *
   * Required: source
   * For tool claims: partType, vehicle info, yard info come from the tool
   * For manual by PN: partNumber required, rest optional
   * For manual by YMM: vehicle info + partType/partDescription required
   */
  async claim({ partType, partDescription, partNumber, itemId, vehicle, yard,
                estimatedValue, priceSource, claimedBy, source, sourceId, notes }) {

    const validSources = ['daily_feed', 'scout_alert', 'hawk_eye', 'flyway', 'manual'];
    if (!validSources.includes(source)) {
      throw new Error(`Invalid source: ${source}. Must be one of: ${validSources.join(', ')}`);
    }

    // Normalize PN using shared normalizer (strips dashes, spaces, Ford suffixes, etc.)
    const normPn = partNumber ? normalizePartNumber(partNumber) : null;
    const numItemId = itemId ? parseInt(itemId) || null : null;

    // Deduplicate: check if an active claim already exists
    if (normPn) {
      // Primary key: normalized part number
      const allClaimed = await database('the_cache')
        .where('status', 'claimed')
        .whereNotNull('part_number')
        .select('id', 'part_number');
      const existing = allClaimed.find(c => normalizePartNumber(c.part_number) === normPn);
      if (existing) {
        this.log.info({ id: existing.id, source }, 'Duplicate claim by PN — returning existing');
        const full = await database('the_cache').where('id', existing.id).first();
        return { ...full, alreadyExists: true };
      }
    } else if (numItemId) {
      // Fallback key: itemId (for parts with no PN like sunroof glass, mirrors)
      const existing = await database('the_cache')
        .where('status', 'claimed')
        .where('item_id', numItemId)
        .first();
      if (existing) {
        this.log.info({ id: existing.id, source }, 'Duplicate claim by itemId — returning existing');
        return { ...existing, alreadyExists: true };
      }
    }

    const id = uuidv4();
    const entry = {
      id,
      part_type: partType || null,
      part_description: partDescription || null,
      part_number: normPn,
      item_id: numItemId,
      vehicle_year: vehicle?.year || null,
      vehicle_make: vehicle?.make || null,
      vehicle_model: vehicle?.model || null,
      vehicle_trim: vehicle?.trim || null,
      vehicle_vin: vehicle?.vin || null,
      yard_name: yard?.name || null,
      row_number: yard?.row || null,
      estimated_value: estimatedValue || null,
      price_source: priceSource || null,
      claimed_by: claimedBy || 'ry',
      claimed_at: new Date(),
      source,
      source_id: sourceId || null,
      status: 'claimed',
      notes: notes || null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await database('the_cache').insert(entry);

    // Cross-system: mark scout alert as claimed
    if (source === 'scout_alert' && sourceId) {
      try {
        await database('scout_alerts')
          .where('id', sourceId)
          .update({ claimed: true, claimed_at: new Date() });
      } catch (e) {
        this.log.warn({ err: e.message }, 'Failed to mark scout alert as claimed');
      }
    }

    // Cross-system: log to pull_session for Daily Feed (preserve existing behavior)
    if (source === 'daily_feed' && sourceId) {
      try {
        await database('pull_session').insert({
          id: uuidv4(),
          yard_vehicle_id: sourceId,
          part_type: partType,
          part_description: partDescription,
          pulled_at: new Date(),
          puller: claimedBy || 'ry',
          created_at: new Date(),
        });
      } catch (e) {
        // pull_session table may not exist — non-fatal
        this.log.warn({ err: e.message }, 'pull_session insert failed (non-fatal)');
      }
    }

    this.log.info({ id, source, partType, partNumber: entry.part_number }, 'Part claimed to cache');
    return { id, ...entry };
  }

  /**
   * Update editable fields on a cache entry (partial update).
   * Re-normalizes partNumber on save.
   */
  async updateEntry(cacheId, updates) {
    const entry = await database('the_cache').where('id', cacheId).first();
    if (!entry) throw new Error('Cache entry not found');

    const patch = { updated_at: new Date() };
    if (updates.partNumber !== undefined) {
      patch.part_number = updates.partNumber ? normalizePartNumber(updates.partNumber) : null;
    }
    if (updates.partDescription !== undefined) patch.part_description = updates.partDescription || null;
    if (updates.partType !== undefined) patch.part_type = updates.partType || null;
    if (updates.make !== undefined) patch.vehicle_make = updates.make || null;
    if (updates.model !== undefined) patch.vehicle_model = updates.model || null;
    if (updates.year !== undefined) patch.vehicle_year = updates.year || null;
    if (updates.notes !== undefined) patch.notes = updates.notes || null;

    await database('the_cache').where('id', cacheId).update(patch);
    this.log.info({ cacheId, fields: Object.keys(patch) }, 'Cache entry updated');
    return { success: true, updated: patch };
  }

  /**
   * Return a claimed part back to alerts.
   * If source was scout_alert, re-activates the original alert.
   */
  async returnToAlerts(cacheId, reason) {
    const entry = await database('the_cache').where('id', cacheId).first();
    if (!entry) throw new Error('Cache entry not found');
    if (entry.status !== 'claimed') throw new Error(`Cannot return entry with status: ${entry.status}`);

    await database('the_cache').where('id', cacheId).update({
      status: 'returned',
      resolved_at: new Date(),
      resolved_by: 'manual_return',
      notes: reason ? `Returned: ${reason}` : 'Returned to alerts',
      updated_at: new Date(),
    });

    // Re-activate scout alert if applicable
    if (entry.source === 'scout_alert' && entry.source_id) {
      try {
        await database('scout_alerts')
          .where('id', entry.source_id)
          .update({ claimed: false, claimed_at: null });
      } catch (e) {
        this.log.warn({ err: e.message }, 'Failed to re-activate scout alert');
      }
    }

    this.log.info({ cacheId, reason }, 'Cache entry returned');
    return { success: true };
  }

  /**
   * Delete a claim (mistake / accident).
   * Does NOT re-activate scout alerts — use returnToAlerts for that.
   */
  async deleteClaim(cacheId) {
    const entry = await database('the_cache').where('id', cacheId).first();
    if (!entry) throw new Error('Cache entry not found');

    await database('the_cache').where('id', cacheId).update({
      status: 'deleted',
      resolved_at: new Date(),
      resolved_by: 'manual_delete',
      updated_at: new Date(),
    });

    this.log.info({ cacheId }, 'Cache entry deleted');
    return { success: true };
  }

  /**
   * Manually resolve a cache entry (mark as listed without auto-match).
   */
  async manualResolve(cacheId, ebayItemId) {
    await database('the_cache').where('id', cacheId).update({
      status: 'listed',
      resolved_at: new Date(),
      resolved_by: 'manual_resolve',
      ebay_item_id: ebayItemId || null,
      updated_at: new Date(),
    });
    return { success: true };
  }

  /**
   * Auto-resolve: match cache entries against new YourListing items.
   * Runs after every YourListing sync (4x/day).
   *
   * Match logic:
   * 1. If part_number exists → search YourListing for matching PN (SKU or title)
   * 2. If no PN → search by make + model + part_type in YourListing title
   * 3. Listing must have been CREATED AFTER the claim date
   */
  async resolveFromListings() {
    const claimed = await database('the_cache')
      .where('status', 'claimed')
      .select('*');

    if (!claimed.length) return { resolved: 0, checked: 0 };

    const listings = await database('YourListing')
      .where('listingStatus', 'Active')
      .whereNotNull('title')
      .select('ebayItemId', 'title', 'sku', 'startTime', 'createdAt');

    let resolved = 0;

    for (const entry of claimed) {
      const claimDate = new Date(entry.claimed_at);
      let matched = null;

      // Strategy 1: Match by part number
      if (entry.part_number) {
        const pnNorm = normalizePartNumber(entry.part_number);
        for (const listing of listings) {
          const listDate = new Date(listing.startTime || listing.createdAt);
          if (listDate < claimDate) continue;

          // Check SKU
          if (listing.sku) {
            const skuNorm = normalizePartNumber(listing.sku);
            if (skuNorm === pnNorm) { matched = listing; break; }
          }
          // Check title for part number
          if (listing.title && listing.title.toUpperCase().includes(entry.part_number)) {
            matched = listing;
            break;
          }
        }
      }

      // Strategy 2: Match by make + model + part_type in title
      if (!matched && entry.vehicle_make && entry.vehicle_model && entry.part_type) {
        const makeUp = entry.vehicle_make.toUpperCase();
        const modelUp = entry.vehicle_model.toUpperCase();
        const typeUp = entry.part_type.toUpperCase();

        for (const listing of listings) {
          const listDate = new Date(listing.startTime || listing.createdAt);
          if (listDate < claimDate) continue;

          const titleUp = (listing.title || '').toUpperCase();
          if (titleUp.includes(makeUp) && titleUp.includes(modelUp) && titleUp.includes(typeUp)) {
            matched = listing;
            break;
          }
        }
      }

      if (matched) {
        await database('the_cache').where('id', entry.id).update({
          status: 'listed',
          resolved_at: new Date(),
          resolved_by: 'auto_listing_match',
          ebay_item_id: matched.ebayItemId,
          updated_at: new Date(),
        });
        resolved++;
      }
    }

    this.log.info({ checked: claimed.length, resolved }, 'Cache auto-resolution complete');
    return { checked: claimed.length, resolved };
  }

  /**
   * Get active claims (parts claimed but not yet listed).
   */
  async getActiveClaims({ source, claimedBy, sortBy } = {}) {
    let query = database('the_cache').where('status', 'claimed');
    if (source) query = query.where('source', source);
    if (claimedBy) query = query.where('claimed_by', claimedBy);

    const sort = sortBy === 'value' ? 'estimated_value' : 'claimed_at';
    const dir = sortBy === 'value' ? 'desc' : 'desc';

    return query.orderBy(sort, dir);
  }

  /**
   * Get claimed keys for puller tool sync (attack list, scout alerts, etc.).
   * Three maps: PN-based (primary), itemId-based (fallback), alertId-based (scout alerts).
   */
  async getClaimedKeys() {
    const rows = await database('the_cache')
      .where('status', 'claimed')
      .select('id', 'part_number', 'item_id', 'source', 'source_id');

    const claimedPNs = {};      // normalizedPN → cacheId
    const claimedItemIds = {};   // itemId (string) → cacheId
    const claimedAlertIds = {};  // scout alert id (string) → cacheId
    for (const r of rows) {
      if (r.part_number) {
        const norm = normalizePartNumber(r.part_number);
        if (norm) claimedPNs[norm] = r.id;
      } else if (r.item_id) {
        claimedItemIds[String(r.item_id)] = r.id;
      }
      if (r.source === 'scout_alert' && r.source_id) {
        claimedAlertIds[r.source_id] = r.id;
      }
    }
    return { claimedPNs, claimedItemIds, claimedAlertIds };
  }

  /**
   * Get resolved entries (listed, returned, deleted).
   */
  async getHistory({ days = 30, limit = 100 } = {}) {
    const cutoff = new Date(Date.now() - days * 86400000);
    return database('the_cache')
      .whereNot('status', 'claimed')
      .where('resolved_at', '>=', cutoff)
      .orderBy('resolved_at', 'desc')
      .limit(limit);
  }

  /**
   * Dashboard stats.
   */
  async getStats() {
    const statusResult = await database.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'claimed') as active,
        COUNT(*) FILTER (WHERE status = 'listed') as listed,
        COUNT(*) FILTER (WHERE status = 'returned') as returned,
        COUNT(*) FILTER (WHERE status = 'deleted') as deleted,
        COUNT(*) FILTER (WHERE status = 'listed' AND resolved_at >= NOW() - INTERVAL '7 days') as listed_this_week,
        COUNT(*) FILTER (WHERE status = 'returned' AND resolved_at >= NOW() - INTERVAL '7 days') as returned_this_week,
        ROUND(AVG(
          CASE WHEN status = 'listed' AND resolved_at IS NOT NULL AND claimed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (resolved_at - claimed_at)) / 86400.0
          END
        )::numeric, 1) as avg_days_to_list,
        SUM(CASE WHEN status = 'claimed' THEN estimated_value ELSE 0 END)::numeric as claimed_value
      FROM the_cache
    `);

    const sourceCounts = await database('the_cache')
      .where('status', 'claimed')
      .select('source')
      .count('* as count')
      .groupBy('source');

    return {
      ...statusResult.rows[0],
      by_source: sourceCounts.reduce((acc, r) => { acc[r.source] = parseInt(r.count); return acc; }, {}),
    };
  }

  /**
   * Check if a part number or make+model+partType is already in the cache.
   * Used by Hawk Eye and Nest Protector stock checks.
   * Returns array of matching active cache entries.
   */
  async checkCacheStock({ partNumber, make, model, year, partType } = {}) {
    const results = [];

    // Strategy 1: Part number match
    if (partNumber) {
      const pnNorm = normalizePartNumber(partNumber);
      const pnMatches = await database('the_cache')
        .where('status', 'claimed')
        .where(function() {
          this.whereRaw('UPPER(part_number) = ?', [partNumber.toUpperCase()])
            .orWhereRaw('UPPER(part_number) LIKE ?', [`%${pnNorm}%`]);
        })
        .select('*');
      results.push(...pnMatches);
    }

    // Strategy 2: Vehicle + part type match (only if no PN or PN returned nothing)
    if (results.length === 0 && make && model && partType) {
      const vMatches = await database('the_cache')
        .where('status', 'claimed')
        .whereRaw('UPPER(vehicle_make) = ?', [make.toUpperCase()])
        .whereRaw('UPPER(vehicle_model) = ?', [model.toUpperCase()])
        .whereRaw('UPPER(part_type) = ?', [partType.toUpperCase()])
        .modify(function(qb) {
          if (year) qb.where('vehicle_year', year);
        })
        .select('*');
      results.push(...vMatches);
    }

    return results;
  }
}

module.exports = CacheService;
