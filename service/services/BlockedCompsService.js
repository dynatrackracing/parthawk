'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

let _blockedSetCache = null;
let _blockedSetTime = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

class BlockedCompsService {
  /**
   * Block an Item from all comp/match pools.
   */
  async block(itemId, { reason, blockedBy } = {}) {
    if (!itemId) throw new Error('itemId required');
    const idStr = String(itemId);

    // Snapshot item data
    let title = null, partNumber = null, category = null;
    try {
      const item = await database('Item').where('id', idStr).orWhere('ebayId', idStr).first();
      if (item) {
        title = item.title;
        partNumber = item.manufacturerPartNumber;
        category = item.categoryTitle;
      }
    } catch (e) { /* Item table may not have this id */ }

    const [row] = await database('blocked_comps').insert({
      source_item_id: idStr,
      source_title: title,
      source_part_number: partNumber,
      source_category: category,
      blocked_reason: reason || null,
      blocked_by: blockedBy || null,
      blocked_at: new Date(),
    }).onConflict('source_item_id').ignore().returning('*');

    // Invalidate caches — both blockedSet and inventory index
    _blockedSetCache = null;
    try { require('./AttackListService').invalidateInventoryCache(); } catch (e) {}
    await this.recomputeAffectedCache(idStr, partNumber);

    log.info({ itemId: idStr, partNumber, reason }, 'Comp blocked');
    return row || { source_item_id: idStr };
  }

  /**
   * Unblock (restore) a previously blocked comp.
   */
  async unblock(itemId) {
    const idStr = String(itemId);
    const entry = await database('blocked_comps').where('source_item_id', idStr).first();
    const pn = entry ? entry.source_part_number : null;

    await database('blocked_comps').where('source_item_id', idStr).del();
    _blockedSetCache = null;
    try { require('./AttackListService').invalidateInventoryCache(); } catch (e) {}

    // Invalidate cache so it recomputes with the restored item
    if (pn) await this.recomputeAffectedCache(idStr, pn);

    log.info({ itemId: idStr }, 'Comp unblocked');
    return { success: true };
  }

  /**
   * List blocked comps with optional search and pagination.
   */
  async list({ search, limit = 100, offset = 0 } = {}) {
    let query = database('blocked_comps').orderBy('blocked_at', 'desc');
    let countQuery = database('blocked_comps');

    if (search && search.trim()) {
      const s = '%' + search.trim() + '%';
      const where = function() {
        this.where('source_title', 'ilike', s)
          .orWhere('source_part_number', 'ilike', s)
          .orWhere('blocked_reason', 'ilike', s);
      };
      query = query.where(where);
      countQuery = countQuery.where(where);
    }

    const [{ count }] = await countQuery.count('* as count');
    const rows = await query.limit(limit).offset(offset);
    return { rows, total: parseInt(count) };
  }

  /**
   * Get the full set of blocked source_item_id values.
   * Cached in-memory for 60 seconds.
   */
  async getBlockedSet() {
    if (_blockedSetCache && (Date.now() - _blockedSetTime) < CACHE_TTL) {
      return _blockedSetCache;
    }
    try {
      const rows = await database('blocked_comps').select('source_item_id');
      _blockedSetCache = new Set(rows.map(r => String(r.source_item_id)));
      _blockedSetTime = Date.now();
    } catch (e) {
      // Table may not exist yet
      _blockedSetCache = new Set();
      _blockedSetTime = Date.now();
    }
    return _blockedSetCache;
  }

  /**
   * Invalidate market_demand_cache rows for a blocked/unblocked item's PN.
   */
  async recomputeAffectedCache(itemId, partNumber) {
    if (!partNumber) return;
    try {
      const { normalizePartNumber } = require('../lib/partNumberUtils');
      const norm = normalizePartNumber(partNumber);
      if (!norm) return;
      const deleted = await database('market_demand_cache')
        .where('part_number_base', norm.toUpperCase())
        .del();
      if (deleted > 0) {
        log.info({ partNumber: norm, deleted }, 'Invalidated market_demand_cache for blocked comp');
      }
    } catch (e) {
      log.debug({ err: e.message }, 'recomputeAffectedCache failed (non-fatal)');
    }
  }
}

module.exports = new BlockedCompsService();
