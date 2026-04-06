'use strict';

const router = require('express-promise-router')();
const { database } = require('../database/database');

// POST /hidden/add — hide a part globally
router.post('/add', async (req, res) => {
  const { partNumberBase, partType, make, model, source, sourceDetail } = req.body;
  if (!partNumberBase) return res.status(400).json({ success: false, error: 'partNumberBase required' });
  try {
    const [row] = await database('hidden_parts').insert({
      part_number_base: partNumberBase.trim().toUpperCase(),
      part_type: partType || null,
      make: make || null,
      model: model || null,
      source: source || 'manual',
      source_detail: sourceDetail ? JSON.stringify(sourceDetail) : null,
    }).onConflict(database.raw("(part_number_base, COALESCE(make,''), COALESCE(model,''))")).ignore().returning('id');
    res.json({ success: true, id: row?.id || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /hidden/:id — unhide a part
router.delete('/:id', async (req, res) => {
  try {
    await database('hidden_parts').where('id', req.params.id).del();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /hidden/list — all hidden parts
router.get('/list', async (req, res) => {
  try {
    const items = await database('hidden_parts').orderBy('created_at', 'desc');
    res.json({ success: true, items, total: items.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /hidden/keys — lightweight set for frontend filtering
router.get('/keys', async (req, res) => {
  try {
    const rows = await database('hidden_parts').select('part_number_base', 'make', 'model');
    const keys = rows.map(r => `${r.part_number_base}|${(r.make || '').toUpperCase()}|${(r.model || '').toUpperCase()}`);
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
