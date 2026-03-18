'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

// Part types eligible for automated research
const RESEARCH_PART_TYPES = [
  'ECM', 'PCM', 'BCM', 'TIPM', 'fuse box', 'TCM', 'ABS module', 'amplifier'
];

// Minimum vehicle year for research triggers
const MIN_RESEARCH_YEAR = 2014;

// Once this many pullers confirm, field data wins — stop researching
const CONFIRMED_THRESHOLD = 3;

// Pre-populated tip for window regulator motors
const WINDOW_REG_TIP = 'Window regulator motors can be tested in the yard with the battery from an impact gun.';

class PartLocationService {
  constructor() {
    this.log = log.child({ class: 'PartLocationService' }, true);
  }

  /**
   * Look up part location. If eligible and no record exists, trigger research.
   * Returns the location record or null.
   */
  async getLocation({ partType, year, make, model, trim, bodyStyle }) {
    // Check for existing record
    const existing = await this.findRecord({ partType, year, make, model, trim, bodyStyle });
    if (existing) return existing;

    // Check trigger conditions before spending API tokens
    if (!this.shouldResearch({ partType, year })) {
      return null;
    }

    // No record and triggers met — research it
    try {
      const researched = await this.researchLocation({ partType, year, make, model, trim, bodyStyle });
      return researched;
    } catch (err) {
      this.log.error({ err, partType, year, make, model }, 'Research failed');
      return null;
    }
  }

  /**
   * Find an existing part_location record for this combination.
   * Matches on year range (year_start <= year <= year_end).
   */
  async findRecord({ partType, year, make, model, trim, bodyStyle }) {
    const normalizedType = partType.toUpperCase().trim();
    const normalizedMake = (make || '').trim();
    const normalizedModel = (model || '').trim();

    let query = database('part_location')
      .whereRaw('UPPER(part_type) = ?', [normalizedType])
      .whereRaw('UPPER(make) = ?', [normalizedMake.toUpperCase()])
      .whereRaw('UPPER(model) = ?', [normalizedModel.toUpperCase()])
      .where('year_start', '<=', year)
      .where('year_end', '>=', year);

    if (trim) {
      query = query.where(function() {
        this.whereRaw('UPPER(trim) = ?', [trim.toUpperCase()])
          .orWhereNull('trim');
      });
    }

    if (bodyStyle) {
      query = query.where(function() {
        this.whereRaw('UPPER(body_style) = ?', [bodyStyle.toUpperCase()])
          .orWhereNull('body_style');
      });
    }

    // Prefer most specific match (with trim/body_style over without)
    const records = await query.orderByRaw(
      'CASE WHEN trim IS NOT NULL THEN 0 ELSE 1 END, CASE WHEN body_style IS NOT NULL THEN 0 ELSE 1 END'
    );

    if (records.length === 0) return null;

    const record = records[0];

    // Attach window regulator tip if applicable
    if (normalizedType.includes('WINDOW') && normalizedType.includes('REGULATOR')) {
      record.hazards = record.hazards
        ? `${record.hazards}\n${WINDOW_REG_TIP}`
        : WINDOW_REG_TIP;
    }

    return record;
  }

  /**
   * Check all trigger conditions for research.
   */
  shouldResearch({ partType, year }) {
    const yearNum = parseInt(year) || 0;
    if (yearNum < MIN_RESEARCH_YEAR) return false;

    const normalizedType = (partType || '').toUpperCase().trim();
    const eligible = RESEARCH_PART_TYPES.some(t =>
      normalizedType.includes(t.toUpperCase())
    );
    if (!eligible) return false;

    return true;
  }

  /**
   * Call Claude API with web_search tool to research part location.
   */
  async researchLocation({ partType, year, make, model, trim, bodyStyle }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.log.warn('ANTHROPIC_API_KEY not set — skipping research');
      return null;
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const vehicleDesc = [year, make, model, trim, bodyStyle].filter(Boolean).join(' ');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{
        role: 'user',
        content: `You are an automotive parts location expert. Find the exact location and removal procedure for the ${partType} on a ${vehicleDesc}.

Search priority:
1. OEM service manual diagrams and procedures
2. NHTSA Technical Service Bulletins (TSBs)
3. Automotive repair forums (JustAnswer, 2CarPros, model-specific forums)

Return a JSON object with these exact fields:
{
  "location_text": "Where on the vehicle this part is located (be specific: behind glove box, under hood driver side, etc.)",
  "removal_steps": ["Step 1...", "Step 2...", "Step 3..."],
  "tools": "Tools needed (e.g., 10mm socket, T20 Torx, trim removal tool)",
  "hazards": "Any safety warnings or things that can go wrong",
  "avg_pull_minutes": estimated_minutes_as_integer
}

Return ONLY the JSON object, no other text.`
      }],
    });

    // Extract text from response (may have tool use blocks mixed in)
    let resultText = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        resultText += block.text;
      }
    }

    // Parse JSON from response
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.log.warn({ resultText }, 'Could not parse JSON from research response');
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      this.log.warn({ err: err.message, resultText }, 'Invalid JSON from research');
      return null;
    }

    // Store in database
    const record = {
      part_type: partType,
      year_start: parseInt(year),
      year_end: parseInt(year),
      make,
      model,
      trim: trim || null,
      body_style: bodyStyle || null,
      location_text: parsed.location_text || null,
      removal_steps: JSON.stringify(parsed.removal_steps || []),
      tools: parsed.tools || null,
      hazards: parsed.hazards || null,
      avg_pull_minutes: parseInt(parsed.avg_pull_minutes) || null,
      confirmed_count: 0,
      confidence: 'researched',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted = await database('part_location').insert(record).returning('*');
    this.log.info({ partType, year, make, model }, 'Part location researched and stored');

    return inserted[0] || record;
  }

  /**
   * Record field confirmation from a puller.
   * Increments confirmed_count. At threshold, promotes to high_confidence.
   */
  async confirmLocation(id, { locationText, removalSteps, tools, hazards, avgPullMinutes }) {
    const record = await database('part_location').where('id', id).first();
    if (!record) return null;

    const newCount = (record.confirmed_count || 0) + 1;
    const updates = {
      confirmed_count: newCount,
      updatedAt: new Date(),
    };

    // Promote confidence based on count
    if (newCount >= CONFIRMED_THRESHOLD) {
      updates.confidence = 'high_confidence';
    } else if (record.confidence === 'researched') {
      updates.confidence = 'field_confirmed';
    }

    // If puller provided updated data, merge it in
    // Never overwrite high_confidence with researched data, but field data always applies
    if (locationText) updates.location_text = locationText;
    if (removalSteps) updates.removal_steps = JSON.stringify(removalSteps);
    if (tools) updates.tools = tools;
    if (hazards) updates.hazards = hazards;
    if (avgPullMinutes) updates.avg_pull_minutes = avgPullMinutes;

    await database('part_location').where('id', id).update(updates);

    return { ...record, ...updates };
  }

  /**
   * Flag a location as wrong. Resets to researched with count 0.
   */
  async flagWrong(id) {
    const record = await database('part_location').where('id', id).first();
    if (!record) return null;

    await database('part_location').where('id', id).update({
      confidence: 'researched',
      confirmed_count: 0,
      updatedAt: new Date(),
    });

    return { ...record, confidence: 'researched', confirmed_count: 0 };
  }
}

module.exports = PartLocationService;
