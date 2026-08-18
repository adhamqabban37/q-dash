'use strict';

const fs   = require('fs');
const path = require('path');

const EVENTS_PATH   = path.join(__dirname, '..', 'output', 'events.log.json');
const SEMANTIC_PATH = path.join(__dirname, '..', 'output', 'semantic-events.json');

// ── In-memory timeline (lazy, invalidated when new events arrive) ─────────────
let _timeline  = null;   // merged + sorted array of all events
let _cursor    = 0;      // for step-by-step playback

// ── NDJSON reader ─────────────────────────────────────────────────────────────

function readNDJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const out   = [];
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

// ── Load & merge raw + semantic events into one timeline ─────────────────────

function load() {
  const rawEvents      = readNDJSON(EVENTS_PATH);
  const semanticEvents = readNDJSON(SEMANTIC_PATH);

  // Index semantic events by (path + timestamp) for O(1) join
  const semIndex = new Map();
  for (const s of semanticEvents) {
    semIndex.set(`${s.path}§${s.timestamp}`, s);
  }

  // Merge: semantic events carry the full raw payload + semantic layer
  // Prefer semantic record (richer) when available; fallback to raw
  const merged = new Map();
  for (const raw of rawEvents) {
    const key = `${raw.path}§${raw.timestamp}`;
    const sem = semIndex.get(key);
    merged.set(key, sem || raw);
  }
  // Also include any semantic events whose raw counterpart wasn't in the log
  for (const [key, sem] of semIndex) {
    if (!merged.has(key)) merged.set(key, sem);
  }

  _timeline = [...merged.values()].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  _cursor = 0;

  return _timeline.length;
}

function ensureLoaded() {
  if (_timeline === null) load();
}

// ── Public replay API ─────────────────────────────────────────────────────────

function replayAll(opts = {}) {
  ensureLoaded();
  const { limit = 0, offset = 0 } = opts;
  const base = offset ? _timeline.slice(offset) : _timeline;
  return limit > 0 ? base.slice(0, limit) : base;
}

function replayByTimeRange(start, end) {
  ensureLoaded();
  const from = new Date(start).getTime();
  const to   = new Date(end).getTime();
  return _timeline.filter(e => {
    const t = new Date(e.timestamp).getTime();
    return t >= from && t <= to;
  });
}

function replayByProject(projectName) {
  ensureLoaded();
  const lower = projectName.toLowerCase();
  return _timeline.filter(e =>
    e.semantic && e.semantic.project &&
    e.semantic.project.toLowerCase().includes(lower)
  );
}

function replayByEventType(type) {
  ensureLoaded();
  return _timeline.filter(e => e.type === type);
}

function replayByPath(fragment) {
  ensureLoaded();
  const lower = fragment.toLowerCase().replace(/\\/g, '/');
  return _timeline.filter(e =>
    e.path && e.path.toLowerCase().replace(/\\/g, '/').includes(lower)
  );
}

// Compose multiple filters
function replayWhere(predicates = []) {
  ensureLoaded();
  return _timeline.filter(e => predicates.every(fn => fn(e)));
}

// ── Cursor-based step playback ────────────────────────────────────────────────

function stepForward() {
  ensureLoaded();
  if (_cursor >= _timeline.length) return null;
  return _timeline[_cursor++] || null;
}

function stepBackward() {
  ensureLoaded();
  if (_cursor <= 0) return null;
  return _timeline[--_cursor] || null;
}

function resetCursor(position = 0) {
  _cursor = Math.max(0, Math.min(position, _timeline ? _timeline.length : 0));
}

function getCursorPosition() {
  return {
    position: _cursor,
    total:    _timeline ? _timeline.length : 0,
    percent:  _timeline && _timeline.length > 0
                ? Math.round((_cursor / _timeline.length) * 100)
                : 0,
  };
}

// ── Timeline summary ──────────────────────────────────────────────────────────

function getTimeline() {
  ensureLoaded();
  if (!_timeline.length) return { total: 0, start: null, end: null, byType: {} };

  const byType    = {};
  const byProject = {};
  for (const e of _timeline) {
    byType[e.type]   = (byType[e.type]   || 0) + 1;
    const proj = e.semantic?.project;
    if (proj) byProject[proj] = (byProject[proj] || 0) + 1;
  }

  return {
    total:     _timeline.length,
    start:     _timeline[0].timestamp,
    end:       _timeline[_timeline.length - 1].timestamp,
    byType,
    byProject,
    cursor:    getCursorPosition(),
  };
}

// Mark cache stale — called after new events land on disk
function invalidate() {
  _timeline = null;
}

module.exports = {
  load, invalidate,
  replayAll, replayByTimeRange, replayByProject, replayByEventType, replayByPath, replayWhere,
  stepForward, stepBackward, resetCursor, getCursorPosition,
  getTimeline,
};
