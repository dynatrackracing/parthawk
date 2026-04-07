'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 1000;

function makeSoldKey(partType, year, make, model) {
  return [partType, year, make, model].map(v => String(v || '').toUpperCase().trim()).join('|');
}

function invalidateCaches() {
  _cache = null;
  _cacheTime = 0;
  try { require('./AttackListService').invalidateInventoryCache(); } catch (e) {}
}

class BlockedCompsService {
  // ── COMP block (by Item.id) ──

  async block(itemId, { reason, blockedBy } = {}) {
    if (!itemId) throw new Error('itemId required');
    const idStr = String(itemId);

    let title = null, partNumber = null, category = null;
    try {
      const item = await database('Item').where('id', idStr).orWhere('ebayId', idStr).first();
      if (item) { title = item.title; partNumber = item.manufacturerPartNumber; category = item.categoryTitle; }
    } catch (e) {}

    await database('blocked_comps').insert({
      source_item_id: idStr, block_type: 'comp',
      source_title: title, source_part_number: partNumber, source_category: category,
      blocked_reason: reason || null, blocked_by: blockedBy || null, blocked_at: new Date(),
    }).onConflict(database.raw('(source_item_id) WHERE block_type = \'comp\' AND source_item_id IS NOT NULL')).ignore();

    invalidateCaches();
    await this.recomputeAffectedCache(idStr, partNumber);
    log.info({ itemId: idStr, partNumber, reason }, 'Comp blocked');
    return { source_item_id: idStr, block_type: 'comp' };
  }

  async unblock(itemId) {
    const idStr = String(itemId);
    const entry = await database('blocked_comps').where('source_item_id', idStr).where('block_type', 'comp').first();
    await database('blocked_comps').where('source_item_id', idStr).where('block_type', 'comp').del();
    invalidateCaches();
    if (entry && entry.source_part_number) await this.recomputeAffectedCache(idStr, entry.source_part_number);
    log.info({ itemId: idStr }, 'Comp unblocked');
    return { success: true };
  }

  // ── SOLD block (by partType + year + make + model) ──

  async blockSold({ partType, year, make, model, exampleTitle, examplePN, reason, blockedBy } = {}) {
    if (!partType || !year || !make || !model) throw new Error('partType, year, make, model all required');
    const pt = String(partType).toUpperCase().trim();
    const yr = parseInt(year);
    const mk = String(make).toUpperCase().trim();
    const md = String(model).toUpperCase().trim();

    await database('blocked_comps').insert({
      block_type: 'sold', part_type: pt, year: yr, make: mk, model: md,
      source_title: exampleTitle || null, source_part_number: examplePN || null,
      blocked_reason: reason || null, blocked_by: blockedBy || null, blocked_at: new Date(),
    }).onConflict(database.raw('(part_type, year, make, model) WHERE block_type = \'sold\' AND part_type IS NOT NULL')).ignore();

    invalidateCaches();
    log.info({ partType: pt, year: yr, make: mk, model: md, reason }, 'Sold block created');
    return { block_type: 'sold', part_type: pt, year: yr, make: mk, model: md };
  }

  async unblockSold({ partType, year, make, model }) {
    const pt = String(partType).toUpperCase().trim();
    const yr = parseInt(year);
    const mk = String(make).toUpperCase().trim();
    const md = String(model).toUpperCase().trim();
    await database('blocked_comps').where({ block_type: 'sold', part_type: pt, year: yr, make: mk, model: md }).del();
    invalidateCaches();
    log.info({ partType: pt, year: yr, make: mk, model: md }, 'Sold block removed');
    return { success: true };
  }

  // ── Unified unblock by row id ──

  async unblockById(rowId) {
    const entry = await database('blocked_comps').where('id', rowId).first();
    if (!entry) throw new Error('Not found');
    await database('blocked_comps').where('id', rowId).del();
    invalidateCaches();
    if (entry.block_type === 'comp' && entry.source_part_number) {
      await this.recomputeAffectedCache(entry.source_item_id, entry.source_part_number);
    }
    log.info({ rowId, blockType: entry.block_type }, 'Unblocked by id');
    return { success: true, block_type: entry.block_type };
  }

  // ── List ──

  async list({ search, limit = 100, offset = 0, type } = {}) {
    let query = database('blocked_comps').orderBy('blocked_at', 'desc');
    let countQuery = database('blocked_comps');

    if (type) {
      query = query.where('block_type', type);
      countQuery = countQuery.where('block_type', type);
    }
    if (search && search.trim()) {
      const s = '%' + search.trim() + '%';
      const where = function() {
        this.where('source_title', 'ilike', s)
          .orWhere('source_part_number', 'ilike', s)
          .orWhere('blocked_reason', 'ilike', s)
          .orWhere('part_type', 'ilike', s)
          .orWhere('make', 'ilike', s)
          .orWhere('model', 'ilike', s)
          .orWhereRaw("year::text ILIKE ?", [s]);
      };
      query = query.where(where);
      countQuery = countQuery.where(where);
    }

    const [{ count }] = await countQuery.count('* as count');
    const rows = await query.limit(limit).offset(offset);
    return { rows, total: parseInt(count) };
  }

  // ── Blocked set (cached) ──

  async getBlockedSet() {
    if (_cache && (Date.now() - _cacheTime) < CACHE_TTL) return _cache;
    try {
      const rows = await database('blocked_comps').select('source_item_id', 'block_type', 'part_type', 'year', 'make', 'model');
      const compIds = new Set();
      const soldKeys = new Set();
      for (const r of rows) {
        if (r.block_type === 'comp' && r.source_item_id) compIds.add(String(r.source_item_id));
        if (r.block_type === 'sold' && r.part_type) soldKeys.add(makeSoldKey(r.part_type, r.year, r.make, r.model));
      }
      _cache = { compIds, soldKeys };
      _cacheTime = Date.now();
    } catch (e) {
      _cache = { compIds: new Set(), soldKeys: new Set() };
      _cacheTime = Date.now();
    }
    return _cache;
  }

  makeSoldKey(partType, year, make, model) { return makeSoldKey(partType, year, make, model); }

  // ── Cache invalidation ──

  async recomputeAffectedCache(itemId, partNumber) {
    if (!partNumber) return;
    try {
      const { normalizePartNumber } = require('../lib/partNumberUtils');
      const norm = normalizePartNumber(partNumber);
      if (!norm) return;
      const deleted = await database('market_demand_cache').where('part_number_base', norm.toUpperCase()).del();
      if (deleted > 0) log.info({ partNumber: norm, deleted }, 'Invalidated market_demand_cache for blocked comp');
    } catch (e) {}
  }
}

module.exports = new BlockedCompsService();
