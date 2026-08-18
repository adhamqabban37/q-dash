'use strict';

// Timezone policy: timestamps are stored UTC; hour/weekday buckets below are
// computed in America/Chicago via core/time.js (hourOfDay/weekday), not the
// host machine's local zone or raw UTC.

const fs   = require('fs');
const path = require('path');
const time = require('./time');

const HEATMAP_PATH  = path.join(__dirname, '..', 'output', 'heatmap.json');
const SEMANTIC_PATH = path.join(__dirname, '..', 'output', 'semantic-events.json');

// ── In-memory accumulators (O(1) updates per event) ──────────────────────────

// fileCounts: path → { path, name, ext, count, lastSeen }
let fileCounts    = new Map();
// projectCounts: project → count
let projectCounts = new Map();
// skillCounts: skillName → count
let skillCounts   = new Map();
// dirCounts: dirPath → count
let dirCounts     = new Map();
// hourCounts: array[24] of integers
let hourCounts    = new Array(24).fill(0);
// weekdayCounts: array[7] of integers (0 = Sunday)
let weekdayCounts = new Array(7).fill(0);
// totalEvents tracked
let totalEvents   = 0;

let _saveTimer    = null;

// ── Per-event accumulation ───────────────────────────────────────────────────

function accumulate(enrichedEvent) {
  totalEvents++;

  const filePath = enrichedEvent.path;
  if (!filePath) return;

  const name     = path.basename(filePath);
  const ext      = path.extname(filePath).toLowerCase();
  const dirPath  = path.dirname(filePath).replace(/\\/g, '/');
  const ts       = enrichedEvent.timestamp;

  // File hit count
  const existing = fileCounts.get(filePath) || { path: filePath, name, ext, count: 0, lastSeen: ts };
  existing.count++;
  existing.lastSeen = ts || existing.lastSeen;
  fileCounts.set(filePath, existing);

  // Directory hit count
  dirCounts.set(dirPath, (dirCounts.get(dirPath) || 0) + 1);

  // Time-based: hour + weekday (bucketed in America/Chicago, see header note)
  if (ts) {
    const hour = time.hourOfDay(ts);
    const weekday = time.weekday(ts);
    if (hour !== null) hourCounts[hour]++;
    if (weekday !== null) weekdayCounts[weekday]++;
  }

  const sem = enrichedEvent.semantic;
  if (sem) {
    // Project counts
    if (sem.project) {
      projectCounts.set(sem.project, (projectCounts.get(sem.project) || 0) + 1);
    }

    // Skill counts — extract from gstack path
    const skillMatch = filePath.replace(/\\/g, '/').match(/\/gstack\/([^/]+)/);
    if (skillMatch) {
      const sk = skillMatch[1];
      skillCounts.set(sk, (skillCounts.get(sk) || 0) + 1);
    }
  }
}

// ── Serialization helpers ─────────────────────────────────────────────────────

function topN(map, n, keyLabel = 'name') {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, count]) => ({ [keyLabel]: k, count }));
}

function buildSnapshot() {
  const peakHour    = hourCounts.indexOf(Math.max(...hourCounts));
  const peakWeekday = weekdayCounts.indexOf(Math.max(...weekdayCounts));

  const hotFiles = [...fileCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const hotDirs = topN(dirCounts, 15, 'path');

  return {
    generated:         new Date().toISOString(),
    totalEvents,

    hotFiles,
    hotProjects:       topN(projectCounts, 10),
    hotSkills:         topN(skillCounts, 10),
    hotDirectories:    hotDirs,

    activityCurve:     hourCounts.map((count, hour) => ({ hour, count })),
    weekdayCurve:      weekdayCounts.map((count, day) => ({
      day, label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day], count,
    })),

    peakHour,
    peakWeekdayLabel:  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][peakWeekday],
    mostActiveProject: hotFiles.length ? (projectCounts.size > 0 ? topN(projectCounts, 1)[0]?.name : null) : null,
    mostEditedFile:    hotFiles[0]?.name || null,
    mostEditedPath:    hotFiles[0]?.path || null,

    uniqueFiles:    fileCounts.size,
    uniqueDirs:     dirCounts.size,
    uniqueProjects: projectCounts.size,
    uniqueSkills:   skillCounts.size,
  };
}

// ── Save (debounced) ─────────────────────────────────────────────────────────

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flush, 1200);
}

function flush() {
  try {
    fs.writeFileSync(HEATMAP_PATH, JSON.stringify(buildSnapshot(), null, 2));
  } catch (err) {
    console.error('[heatmapEngine] Save failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function recordEvent(enrichedEvent) {
  accumulate(enrichedEvent);
  scheduleSave();
}

function getHeatmap() {
  return buildSnapshot();
}

function getStats() {
  return {
    totalEvents,
    uniqueFiles:    fileCounts.size,
    uniqueProjects: projectCounts.size,
    uniqueSkills:   skillCounts.size,
    peakHour:       hourCounts.indexOf(Math.max(...hourCounts)),
  };
}

function readNDJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const out   = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out;
  } catch { return []; }
}

function init() {
  const events = readNDJSON(SEMANTIC_PATH);

  if (events.length) {
    for (const e of events) accumulate(e);
    flush();
    console.log(`[heatmapEngine] Seeded from ${events.length} events → ${fileCounts.size} files, ${projectCounts.size} projects`);
  } else {
    flush();  // write empty heatmap
    console.log('[heatmapEngine] Initialized (no historical events)');
  }
}

module.exports = { init, recordEvent, getHeatmap, getStats, flush };
