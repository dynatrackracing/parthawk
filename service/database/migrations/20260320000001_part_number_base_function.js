'use strict';

module.exports = {
  async up(knex) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION part_number_base(pn TEXT) RETURNS TEXT AS $$
      BEGIN
        IF pn IS NULL OR LENGTH(TRIM(pn)) < 4 THEN RETURN pn; END IF;
        -- Ford dashed: AL3T-15604-BD → AL3T-15604
        IF pn ~ '^[A-Z0-9]+-[A-Z0-9]+-[A-Z]{1,2}$' THEN
          RETURN REGEXP_REPLACE(pn, '-[A-Z]{1,2}$', '');
        END IF;
        -- Honda dashed: 39980-TS8-A0 → 39980-TS8
        IF pn ~ '^\\d{5}-[A-Z0-9]{2,5}-[A-Z0-9]{1,3}$' THEN
          RETURN REGEXP_REPLACE(pn, '-[A-Z0-9]{1,3}$', '');
        END IF;
        -- Chrysler: 56044691AA → 56044691
        IF pn ~ '^\\d{7,}[A-Z]{2}$' THEN
          RETURN REGEXP_REPLACE(pn, '[A-Z]{2}$', '');
        END IF;
        -- VW spaced: 06A 906 032 LP → 06A 906 032
        IF pn ~ '^[A-Z0-9]{2,3} \\d{3} \\d{3} [A-Z]{1,2}$' THEN
          RETURN REGEXP_REPLACE(pn, ' [A-Z]{1,2}$', '');
        END IF;
        -- Generic: strip trailing 2 alpha after 6+ chars
        IF pn ~ '^.{6,}[A-Z]{2}$' THEN
          RETURN REGEXP_REPLACE(pn, '[A-Z]{2}$', '');
        END IF;
        RETURN pn;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);
  },
  async down(knex) {
    await knex.raw('DROP FUNCTION IF EXISTS part_number_base(TEXT)');
  }
};
