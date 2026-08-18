'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH TIME — timezone policy helpers
// Storage is always UTC ISO 8601. Human-facing bucketing (day/week/hour/weekday)
// happens in a configurable IANA zone (default America/Chicago, override with
// env QDASH_TZ). Uses Intl.DateTimeFormat only — no external libs. Every
// function returns null on invalid input rather than throwing.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_ZONE = 'America/Chicago';

const ZONE = (() => {
  const candidate = process.env.QDASH_TZ || DEFAULT_ZONE;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch (e) {
    return DEFAULT_ZONE;
  }
})();

function pad2(n) {
  return String(n).padStart(2, '0');
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

function parseInput(isoOrDate) {
  let d;
  if (isoOrDate instanceof Date) {
    d = isoOrDate;
  } else if (typeof isoOrDate === 'string' && isoOrDate.trim()) {
    d = new Date(isoOrDate);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return d;
}

// Returns the calendar Y/M/D/H/m/s of `isoOrDate` as observed in ZONE, or
// null when the input can't be parsed.
function getZonedParts(isoOrDate) {
  const d = parseInput(isoOrDate);
  if (!d) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = fmt.formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hour = parseInt(map.hour, 10);
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      day: parseInt(map.day, 10),
      hour: hour === 24 ? 0 : hour, // guard against rare ICU 24:00 edge case
      minute: parseInt(map.minute, 10),
      second: parseInt(map.second, 10),
    };
  } catch (e) {
    return null;
  }
}

// dayKey(isoOrDate) -> "YYYY-MM-DD" in ZONE
function dayKey(isoOrDate) {
  const p = getZonedParts(isoOrDate);
  if (!p) return null;
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

// weekKey(isoOrDate) -> "YYYY-Www" ISO-8601 week in ZONE
function weekKey(isoOrDate) {
  const p = getZonedParts(isoOrDate);
  if (!p) return null;

  // Standard ISO-8601 week algorithm, applied to the zoned Y/M/D treated as
  // a UTC calendar date (safe: week/weekday depend only on the calendar
  // date, not on time-of-day or the original instant's real UTC offset).
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const isoDayOfWeek = (date.getUTCDay() + 6) % 7 + 1; // Mon=1 .. Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - isoDayOfWeek); // Thursday of this ISO week
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${pad2(weekNum)}`;
}

// hourOfDay(isoOrDate) -> 0-23 in ZONE
function hourOfDay(isoOrDate) {
  const p = getZonedParts(isoOrDate);
  if (!p) return null;
  return p.hour;
}

// weekday(isoOrDate) -> 0-6 (0 = Sunday) in ZONE
function weekday(isoOrDate) {
  const p = getZonedParts(isoOrDate);
  if (!p) return null;
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return date.getUTCDay();
}

// nowIso() -> new Date().toISOString()
function nowIso() {
  return new Date().toISOString();
}

module.exports = { ZONE, dayKey, weekKey, hourOfDay, weekday, nowIso };
