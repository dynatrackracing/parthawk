'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

/**
 * ReturnIntakeService — Auto-relist returned parts
 *
 * Return intake logs: part, puller, yard, vehicle, condition.
 * Grade A: relist at full price.
 * Grade B: relist at discount with condition noted.
 * Grade C: flag for review (likely scrap).
 * Auto-queue — no manual step needed for A and B.
 */
class ReturnIntakeService {
  constructor() {
    this.log = log.child({ class: 'ReturnIntakeService' }, true);
  }

  /**
   * Log a returned part and auto-queue relist.
   */
  async intakeReturn({
    ebayItemId, title, partNumber, sku,
    pullerName, yardName, vehicleInfo,
    conditionGrade, conditionNotes, originalPrice,
  }) {
    this.log.info({ ebayItemId, conditionGrade }, 'Processing return intake');

    const grade = (conditionGrade || 'B').toUpperCase();
    let relistPrice = parseFloat(originalPrice) || 0;
    let relistStatus = 'pending';

    if (grade === 'A') {
      // Grade A: relist at full price
      relistPrice = parseFloat(originalPrice) || 0;
      relistStatus = 'pending';
    } else if (grade === 'B') {
      // Grade B: relist at 20% discount with condition noted
      relistPrice = Math.round((parseFloat(originalPrice) || 0) * 0.80 * 100) / 100;
      relistStatus = 'pending';
    } else {
      // Grade C: flag for review, do not auto-relist
      relistPrice = 0;
      relistStatus = 'review';
    }

    const record = {
      ebay_item_id: ebayItemId || null,
      title,
      part_number: partNumber || null,
      sku: sku || null,
      puller_name: pullerName || null,
      yard_name: yardName || null,
      vehicle_info: vehicleInfo || null,
      condition_grade: grade,
      condition_notes: conditionNotes || null,
      original_price: parseFloat(originalPrice) || null,
      relist_price: relistPrice,
      relist_status: relistStatus,
      returned_at: new Date(),
      createdAt: new Date(),
    };

    try {
      const inserted = await database('return_intake').insert(record).returning('*');
      this.log.info({ id: inserted[0]?.id, grade, relistPrice }, 'Return intake logged');
      return { success: true, record: inserted[0] || record };
    } catch (err) {
      this.log.error({ err }, 'return_intake insert failed');
      return { success: false, error: err.message };
    }
  }

  /**
   * Get all pending relists (auto-queued returns awaiting relist).
   */
  async getPendingRelists() {
    try {
      return await database('return_intake')
        .where('relist_status', 'pending')
        .orderBy('returned_at', 'desc');
    } catch (e) { return []; }
  }

  /**
   * Mark a return as relisted (after listing is created on eBay).
   */
  async markRelisted(id, newEbayItemId) {
    try {
      await database('return_intake').where('id', id).update({
        relist_status: 'relisted',
        relist_ebay_item_id: newEbayItemId || null,
        relisted_at: new Date(),
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark a return as scrapped (not worth relisting).
   */
  async markScrapped(id) {
    try {
      await database('return_intake').where('id', id).update({
        relist_status: 'scrapped',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = ReturnIntakeService;
