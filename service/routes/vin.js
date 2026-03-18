'use strict';

const { log } = require('../lib/logger');
const router = require('express-promise-router')();
const { database } = require('../database/database');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Multer-free: read raw body as base64 from multipart form data
// Assumption: body-parser is configured with 50mb limit in index.js

/**
 * POST /vin/decode-photo
 * Accepts multipart form with 'photo' file field.
 * Uses Claude API to read VIN from photo, then NHTSA to decode.
 */
router.post('/decode-photo', async (req, res) => {
  try {
    // Read the file from the raw request body
    // Since we don't have multer, parse the multipart manually
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = Buffer.concat(chunks);
    if (body.length === 0) {
      return res.status(400).json({ error: 'No photo provided' });
    }

    // Extract image data from multipart form
    const imageBase64 = extractImageFromMultipart(body, req.headers['content-type']);
    if (!imageBase64) {
      return res.status(400).json({ error: 'Could not extract image from upload' });
    }

    // Step 1: Send to Claude API for VIN reading
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const claudeRes = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: 'Read the VIN from this photo. Return only the 17-character VIN string, nothing else. If you cannot read it clearly, return UNREADABLE.',
          },
        ],
      }],
    });

    let vin = '';
    for (const block of claudeRes.content) {
      if (block.type === 'text') vin += block.text.trim();
    }

    vin = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();

    if (vin === 'UNREADABLE' || vin.length !== 17) {
      return res.json({ success: true, vin: 'UNREADABLE' });
    }

    // Step 2: Check vin_cache first
    let decoded = null;
    let matchedVehicle = null;

    try {
      const cached = await database('vin_cache').where('vin', vin).first();
      if (cached) {
        decoded = {
          year: cached.year, make: cached.make, model: cached.model,
          engine: cached.engine, bodyStyle: cached.body_style,
        };
      }
    } catch (e) {
      // vin_cache table may not exist yet
    }

    // Step 3: If not cached, call NHTSA
    if (!decoded) {
      const nhtsaRes = await axios.get(
        `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${vin}?format=json`,
        { timeout: 10000 }
      );

      const results = nhtsaRes.data?.Results || [];
      const getValue = (varId) => {
        const item = results.find(r => r.VariableId === varId);
        return (item && item.Value && item.Value.trim()) || null;
      };

      decoded = {
        year: getValue(29) ? parseInt(getValue(29)) : null,
        make: getValue(26),
        model: getValue(28),
        engine: [getValue(13), getValue(71)].filter(Boolean).join(' ') || null, // displacement + cylinders
        bodyStyle: getValue(5),
      };

      // Cache the result
      try {
        await database('vin_cache').insert({
          vin,
          year: decoded.year,
          make: decoded.make,
          model: decoded.model,
          engine: decoded.engine,
          body_style: decoded.bodyStyle,
          raw_nhtsa: JSON.stringify(nhtsaRes.data?.Results || []),
          decoded_at: new Date(),
          createdAt: new Date(),
        });
      } catch (e) {
        // Ignore duplicate or table-not-exists errors
        log.warn({ err: e.message }, 'vin_cache insert failed');
      }
    }

    // Step 4: Try to match against yard vehicles
    if (decoded.year && decoded.make && decoded.model) {
      try {
        const match = await database('yard_vehicle')
          .where('active', true)
          .where('year', String(decoded.year))
          .whereRaw('UPPER(make) = ?', [decoded.make.toUpperCase()])
          .whereRaw('UPPER(model) LIKE ?', ['%' + decoded.model.toUpperCase() + '%'])
          .first();
        if (match) matchedVehicle = match.id;
      } catch (e) {
        // Ignore
      }
    }

    res.json({ success: true, vin, decoded, matchedVehicle });
  } catch (err) {
    log.error({ err }, 'VIN decode failed');
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Extract base64 image data from a multipart/form-data request body.
 * Simple parser — assumes single file field named 'photo'.
 */
function extractImageFromMultipart(body, contentType) {
  try {
    const boundaryMatch = (contentType || '').match(/boundary=(.+)/);
    if (!boundaryMatch) {
      // Not multipart — assume raw image bytes
      return body.toString('base64');
    }

    const boundary = boundaryMatch[1].trim();
    const bodyStr = body.toString('latin1');
    const parts = bodyStr.split('--' + boundary);

    for (const part of parts) {
      if (part.includes('filename=')) {
        // Find the blank line separating headers from body
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const fileData = part.substring(headerEnd + 4);
        // Remove trailing \r\n--
        const clean = fileData.replace(/\r\n$/, '');
        return Buffer.from(clean, 'latin1').toString('base64');
      }
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Failed to parse multipart');
  }
  return null;
}

module.exports = router;
