'use strict';

/**
 * dateHelpers.js — Single source of truth for all DarkHawk date math.
 *
 * DOCTRINE (2026-04-08):
 * - date_added = LKQ's published set date. Canon for display, filter, sort, score.
 * - createdAt = when our scraper inserted the row. Forensic only.
 * - All "today" / "X days ago" math runs in America/New_York.
 * - Browser never does TZ math — server ships pre-computed fields.
 */

const ET_TZ = 'America/New_York';

/**
 * Get today's date string in ET: "YYYY-MM-DD"
 */
function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ET_TZ });
}

/**
 * Convert a date to YYYY-MM-DD in ET.
 * Handles the DATE type quirk: Postgres DATE "2026-04-08" arrives as a JS Date
 * set to UTC midnight, which drifts backward when converted to ET. We detect
 * date-only strings and parse them as-is (no TZ conversion).
 */
function toDateStringET(d) {
  if (!d) return null;
  const s = String(d);
  // If it's already a YYYY-MM-DD string (DATE column), use it directly — no TZ shift
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // If it's a Date object that looks like midnight UTC (from DATE column), extract date part
  if (d instanceof Date) {
    const iso = d.toISOString();
    if (iso.endsWith('T00:00:00.000Z')) return iso.substring(0, 10);
    // Full timestamp — convert to ET
    return d.toLocaleDateString('en-CA', { timeZone: ET_TZ });
  }
  // Timestamp string — parse and convert to ET
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('en-CA', { timeZone: ET_TZ });
}

/**
 * Get the LKQ set date for a vehicle. Falls back to createdAt with a warning.
 * @returns {string|null} YYYY-MM-DD (date_added is used as-is, createdAt converted to ET)
 */
function getSetDateET(vehicle) {
  if (vehicle.date_added) return toDateStringET(vehicle.date_added);
  if (vehicle.createdAt) return toDateStringET(vehicle.createdAt);
  return null;
}

/**
 * Days between LKQ set date and today in ET. 0 = set today.
 * Returns null if no date available.
 */
function daysSinceSetET(vehicle) {
  const setStr = getSetDateET(vehicle);
  if (!setStr) return null;
  const tStr = todayET();
  const setDay = new Date(setStr + 'T00:00:00');
  const todayDay = new Date(tStr + 'T00:00:00');
  return Math.max(0, Math.floor((todayDay - setDay) / 86400000));
}

/**
 * Human-readable label: "Set today", "Set 1d ago", "Set 3d ago", etc.
 */
function setDateLabel(vehicle) {
  const days = daysSinceSetET(vehicle);
  if (days === null) return '';
  if (days === 0) return 'Set today';
  if (days === 1) return 'Set 1d ago';
  return 'Set ' + days + 'd ago';
}

/**
 * Returns true if vehicle was set within windowDays from today ET.
 * windowDays=0 → today only. windowDays=3 → 0-3 days ago.
 */
function withinSetWindowET(vehicle, windowDays) {
  const days = daysSinceSetET(vehicle);
  return days !== null && days >= 0 && days <= windowDays;
}

/**
 * Hours since a yard's most recent scrape (uses createdAt — the one valid forensic use).
 */
async function hoursSinceLastScrape(db, yardId) {
  const r = await db('yard_vehicle')
    .where('yard_id', yardId)
    .where('active', true)
    .max('createdAt as latest')
    .first();
  if (!r || !r.latest) return Infinity;
  return (Date.now() - new Date(r.latest).getTime()) / 3600000;
}

module.exports = {
  ET_TZ,
  todayET,
  toDateStringET,
  getSetDateET,
  daysSinceSetET,
  setDateLabel,
  withinSetWindowET,
  hoursSinceLastScrape,
};
