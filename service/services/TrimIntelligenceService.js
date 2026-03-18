'use strict';

const { log } = require('../lib/logger');
const { database } = require('../database/database');

/**
 * TrimIntelligenceService
 *
 * On first encounter of a trim package, calls Claude API with web_search
 * to research what premium parts came standard vs optional.
 * Stores in trim_intelligence table permanently.
 * Never researches the same trim twice.
 */
class TrimIntelligenceService {
  constructor() {
    this.log = log.child({ class: 'TrimIntelligenceService' }, true);
  }

  /**
   * Get trim intelligence for a vehicle. If not cached, triggers research.
   * @returns {Object|null} expected_parts list with confidence
   */
  async getTrimIntelligence({ year, make, model, trim }) {
    if (!year || !make || !model || !trim) return null;

    // Check cache first — same trim never researched twice
    try {
      const cached = await database('trim_intelligence')
        .where({ year: parseInt(year), make, model, trim })
        .first();
      if (cached) {
        return {
          ...cached,
          expected_parts: typeof cached.expected_parts === 'string'
            ? JSON.parse(cached.expected_parts) : cached.expected_parts,
        };
      }
    } catch (e) {
      this.log.warn({ err: e.message }, 'trim_intelligence lookup failed');
    }

    // Not cached — research it
    return this.researchTrim({ year, make, model, trim });
  }

  /**
   * Research a trim package using Claude API with web_search.
   */
  async researchTrim({ year, make, model, trim }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.log.warn('ANTHROPIC_API_KEY not set — skipping trim research');
      return null;
    }

    this.log.info({ year, make, model, trim }, 'Researching trim intelligence');

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });

      const vehicleDesc = `${year} ${make} ${model} ${trim}`;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{
          role: 'user',
          content: `You are an automotive trim package expert researching the ${vehicleDesc}.

What premium electronic parts and modules come STANDARD (not optional) on this specific trim level vs the base trim?

Focus on parts that junkyard parts pullers care about:
- ECM/PCM differences (tuned for different engines/transmissions)
- BCM features (heated seats, memory, etc.)
- Amplifiers (Bose, Harman Kardon, Alpine, JBL, etc.)
- Navigation/infotainment systems
- Digital instrument clusters
- Adaptive cruise control modules
- Blind spot monitoring modules
- Parking assist modules
- Power liftgate modules
- Heated/cooled seat modules
- Panoramic sunroof controllers

Return a JSON object:
{
  "expected_parts": [
    {
      "part_type": "Amplifier",
      "description": "Bose 9-speaker premium audio amplifier",
      "standard_on_trim": true,
      "value_premium": "high",
      "notes": "Not available on base model"
    }
  ],
  "trim_notes": "Brief description of what makes this trim special for parts pulling"
}

Return ONLY the JSON. If you cannot find specific information, return {"expected_parts": [], "trim_notes": "Insufficient data"}.`
        }],
      });

      let resultText = '';
      for (const block of response.content) {
        if (block.type === 'text') resultText += block.text;
      }

      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.log.warn({ resultText }, 'Could not parse JSON from trim research');
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (err) {
        this.log.warn({ err: err.message }, 'Invalid JSON from trim research');
        return null;
      }

      // Store permanently — same trim never researched twice
      const record = {
        year: parseInt(year),
        make,
        model,
        trim,
        expected_parts: JSON.stringify(parsed.expected_parts || []),
        confidence: parsed.expected_parts?.length > 0 ? 'medium' : 'low',
        researched_at: new Date(),
        createdAt: new Date(),
      };

      try {
        await database('trim_intelligence').insert(record);
      } catch (err) {
        // Duplicate or table not exist — ignore
        this.log.warn({ err: err.message }, 'trim_intelligence insert failed');
      }

      this.log.info({ year, make, model, trim, partCount: parsed.expected_parts?.length },
        'Trim intelligence researched and stored');

      return {
        ...record,
        expected_parts: parsed.expected_parts || [],
        trim_notes: parsed.trim_notes,
      };
    } catch (err) {
      this.log.error({ err }, 'Trim intelligence research failed');
      return null;
    }
  }
}

module.exports = TrimIntelligenceService;
