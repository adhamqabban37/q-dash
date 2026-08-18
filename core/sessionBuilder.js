'use strict';

const fs   = require('fs');
const path = require('path');

const SESSIONS_PATH  = path.join(__dirname, '..', 'output', 'sessions.json');
const SEMANTIC_PATH  = path.join(__dirname, '..', 'output', 'semantic-events.json');

const SESSION_GAP_MS = 15 * 60 * 1000;   // 15-minute inactivity → new session
const MAX_SESSIONS   = 500;               // rolling cap for sessions.json
const MAX_EVENTS_PER_SESSION = 200;       // cap events array in serialized output

// ── Activity type classifier ──────────────────────────────────────────────────

const CODE_EXTS    = new Set(['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.swift', '.cs']);
const CONFIG_EXTS  = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env']);
const RESEARCH_EXTS = new Set(['.md', '.mdx', '.txt', '.pdf', '.rst', '.adoc']);

function classifyActivity(events) {
  let code = 0, config = 0, research = 0, changed = 0, deleted = 0;
  const dirChanges = new Map();

  for (const e of events) {
    if (!e.path) continue;
    const ext = path.extname(e.path).toLowerCase();
    if (CODE_EXTS.has(ext))     code++;
    if (CONFIG_EXTS.has(ext))   config++;
    if (RESEARCH_EXTS.has(ext)) research++;
    if (e.type === 'file_changed') {
      changed++;
      const dir = path.dirname(e.path);
      dirChanges.set(dir, (dirChanges.get(dir) || 0) + 1);
    }
    if (e.type === 'file_deleted') deleted++;
  }

  const total   = events.length || 1;
  const signals = e => e.semantic?.signals || [];

  // Refactor: heavy edit concentration in same directories, >60% changes
  const maxDirChurn = Math.max(...[...dirChanges.values()], 0);
  if (maxDirChurn > 4 && changed / total > 0.60) return 'refactor';

  // Cleanup: mostly deletions
  if (deleted / total > 0.40) return 'cleanup';

  // Dominant extension wins
  if (code > config && code > research)     return 'coding';
  if (config > code && config > research)   return 'config';
  if (research > code)                       return 'research';
  return 'mixed';
}

// ── Session assembler ─────────────────────────────────────────────────────────

let _sessionCounter = 0;

function makeSessionId() {
  _sessionCounter++;
  const ts  = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `ses_${ts}_${String(_sessionCounter).padStart(4, '0')}`;
}

function mostCommon(map) {
  if (map.size === 0) return null;
  return [...map.entries()].reduce((best, cur) => cur[1] > best[1] ? cur : best)[0];
}

function assembleSession(events) {
  if (!events.length) return null;

  const projectCounts = new Map();
  const skillCounts   = new Map();
  const fileSet       = new Set();
  let hi = 0, med = 0, lo = 0;

  for (const e of events) {
    if (e.path) fileSet.add(e.path);

    const sem = e.semantic;
    if (sem) {
      if (sem.project) projectCounts.set(sem.project, (projectCounts.get(sem.project) || 0) + 1);
      if (sem.impact === 'high')   hi++;
      else if (sem.impact === 'medium') med++;
      else                              lo++;

      // Skill from path
      const skillMatch = (e.path || '').replace(/\\/g, '/').match(/\/gstack\/([^/]+)/);
      if (skillMatch) {
        const sk = skillMatch[1];
        skillCounts.set(sk, (skillCounts.get(sk) || 0) + 1);
      }
    }
  }

  const startMs = new Date(events[0].timestamp).getTime();
  const endMs   = new Date(events[events.length - 1].timestamp).getTime();

  return {
    sessionId:        makeSessionId(),
    startTime:        events[0].timestamp,
    endTime:          events[events.length - 1].timestamp,
    durationSeconds:  Math.round((endMs - startMs) / 1000),
    eventCount:       events.length,
    dominantProject:  mostCommon(projectCounts),
    dominantSkill:    mostCommon(skillCounts),
    activityType:     classifyActivity(events),
    filesChanged:     [...fileSet].slice(0, 50),
    impactSummary:    { high: hi, medium: med, low: lo },
    events:           events.slice(0, MAX_EVENTS_PER_SESSION),
  };
}

// ── Historical rebuild ────────────────────────────────────────────────────────

function readNDJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const out   = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch { return []; }
}

function buildFromLog() {
  const events   = readNDJSON(SEMANTIC_PATH);
  if (!events.length) return [];

  const sessions = [];
  let bucket     = [];

  for (const event of events) {
    if (!bucket.length) { bucket.push(event); continue; }

    const gap = new Date(event.timestamp) - new Date(bucket[bucket.length - 1].timestamp);
    if (gap > SESSION_GAP_MS) {
      const s = assembleSession(bucket);
      if (s) sessions.push(s);
      bucket = [event];
    } else {
      bucket.push(event);
    }
  }
  if (bucket.length) {
    const s = assembleSession(bucket);
    if (s) sessions.push(s);
  }

  return sessions;
}

// ── Live session tracking ─────────────────────────────────────────────────────

let _live          = null;   // { events: [], lastTs: Date }
let _allSessions   = [];     // completed sessions this run
let _saveTimer     = null;

function _maybeRotate(eventTs) {
  if (!_live) return;
  const gap = new Date(eventTs) - _live.lastTs;
  if (gap > SESSION_GAP_MS) {
    _closeSession();
  }
}

function _closeSession() {
  if (!_live || !_live.events.length) return;
  const session = assembleSession(_live.events);
  if (session) {
    _allSessions.push(session);
    if (_allSessions.length > MAX_SESSIONS) _allSessions = _allSessions.slice(-MAX_SESSIONS);
    _scheduleSave();
  }
  _live = null;
}

function _scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flush, 1500);
}

function _flush() {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      generated:     new Date().toISOString(),
      totalSessions: _allSessions.length,
      sessions:      _allSessions,
    }, null, 2));
  } catch (err) {
    console.error('[sessionBuilder] Save failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function recordEvent(enrichedEvent) {
  const ts = enrichedEvent.timestamp || new Date().toISOString();
  _maybeRotate(ts);

  if (!_live) {
    _live = { events: [], lastTs: new Date(ts) };
  }
  _live.events.push(enrichedEvent);
  _live.lastTs = new Date(ts);
}

function getLiveSession() {
  if (!_live || !_live.events.length) return null;
  return assembleSession(_live.events);
}

function getStats() {
  return {
    completedSessions: _allSessions.length,
    liveEvents:        _live ? _live.events.length : 0,
    liveActivityType:  _live && _live.events.length ? classifyActivity(_live.events) : null,
  };
}

function init() {
  // Rebuild historical sessions from semantic log
  const historical = buildFromLog();

  if (historical.length) {
    _allSessions = historical.slice(-MAX_SESSIONS);
    _flush();
    console.log(`[sessionBuilder] Rebuilt ${historical.length} sessions from history`);
  } else {
    if (!fs.existsSync(SESSIONS_PATH)) _flush();
    console.log('[sessionBuilder] Initialized (no history yet)');
  }
}

function flush() {
  _closeSession();
  _flush();
}

module.exports = { init, recordEvent, getLiveSession, buildFromLog, getStats, flush };
