'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH AGENT SESSION BUILDER — rolls canonical AgentEvents into AgentSessions
// Mirrors core/sessionBuilder.js's live/debounced-save pattern, but groups by
// the canonical schema's agentId/sessionId instead of a pure inactivity gap.
//
// Grouping:
//   - Events WITH sessionId  → keyed session `${agentType}:${sessionId}`.
//   - Events WITHOUT sessionId (human stream) → 15-minute-gap splitting per
//     agentType, with a synthesized sessionId `${agentType}_${startTsCompact}`.
//
// Closing:
//   - Keyed sessions close once an eventType 'session_end' has been seen AND
//     >15 minutes of silence follow (checked against the incoming event's own
//     timestamp so historical replay/seeding behaves the same as live mode).
//   - Gap-based (no sessionId) sessions close purely on the 15-minute gap.
// Timezone note: timestamps are stored/compared as UTC ISO; no zone bucketing
// happens in this module (see core/time.js for the America/Chicago policy
// used by spendAggregator/heatmapEngine/insightEngine).
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const SESSIONS_PATH = path.join(__dirname, '..', 'output', 'agent-sessions.json');
const EVENTS_LOG     = path.join(__dirname, '..', 'output', 'agent-events.log.json');

const SESSION_GAP_MS = 15 * 60 * 1000; // 15-minute inactivity → session boundary
const MAX_SESSIONS   = 500;             // rolling cap for completed sessions
const MAX_FILES      = 100;             // cap filesChanged per session

// legacyKind → readable prefix isn't needed here; agentSessionBuilder only
// cares about event shape, not intent classification.

let _live      = new Map(); // key -> session state
let _completed = [];        // completed rollups (newest last)
let _saveTimer = null;
let _onSessionClosed = null; // optional callback(rollup) fired when a session closes

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function compactTs(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(Date.now());
  return d.toISOString().replace(/[^0-9]/g, '').slice(0, 14);
}

function keyFor(event) {
  const hasSessionId = typeof event.sessionId === 'string' && event.sessionId.length > 0;
  if (hasSessionId) return { key: `${event.agentType}:${event.sessionId}`, hasSessionId };
  return { key: `gap:${event.agentType}`, hasSessionId };
}

function createState(event, hasSessionId, tsMs) {
  const sessionId = hasSessionId ? event.sessionId : `${event.agentType}_${compactTs(event.timestamp)}`;
  return {
    sessionId,
    agentId: event.agentId || event.agentType,
    agentType: event.agentType,
    hasSessionId,
    projectCounts: new Map(),
    startTime: event.timestamp,
    endTime: event.timestamp,
    lastEventTime: tsMs,
    durationMsMax: null,
    eventCount: 0,
    tokensIn: null,
    tokensOut: null,
    sawTokensIn: false,
    sawTokensOut: false,
    costSum: null,
    sawCost: false,
    filesSet: new Set(),
    errorCount: 0,
    modelsSet: new Set(),
    tokensEstimated: false,
    sawSessionEnd: false,
  };
}

function mostFrequent(map) {
  if (!map || map.size === 0) return null;
  return [...map.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function toRollup(state, live) {
  return {
    sessionId: state.sessionId,
    agentId: state.agentId,
    agentType: state.agentType,
    project: mostFrequent(state.projectCounts),
    startTime: state.startTime,
    endTime: state.endTime,
    durationMs: state.durationMsMax != null
      ? state.durationMsMax
      : (new Date(state.endTime).getTime() - new Date(state.startTime).getTime()) || 0,
    eventCount: state.eventCount,
    tokensIn: state.sawTokensIn ? state.tokensIn : null,
    tokensOut: state.sawTokensOut ? state.tokensOut : null,
    estimatedCostUsd: state.sawCost ? round6(state.costSum) : null,
    filesChanged: [...state.filesSet].slice(0, MAX_FILES),
    errorCount: state.errorCount,
    models: [...state.modelsSet],
    tokensEstimated: state.tokensEstimated,
    live: !!live,
  };
}

function _pushCompleted(state) {
  _completed.push(toRollup(state, false));
  if (_completed.length > MAX_SESSIONS) _completed = _completed.slice(-MAX_SESSIONS);
  if (_onSessionClosed) { try { _onSessionClosed(toRollup(state, false)); } catch {} }
}

// Close any live session that's gone stale relative to `nowMs` (the incoming
// event's own timestamp during replay, or Date.now() during live operation).
function _closeStale(nowMs) {
  for (const [key, state] of _live) {
    const idleMs = nowMs - state.lastEventTime;
    if (idleMs <= SESSION_GAP_MS) continue;
    if (state.hasSessionId) {
      if (state.sawSessionEnd) {
        _pushCompleted(state);
        _live.delete(key);
      }
      // keyed sessions without a session_end stay open indefinitely — an
      // agent may simply be idle mid-session.
    } else {
      _pushCompleted(state);
      _live.delete(key);
    }
  }
}

function _applyEvent(state, event, tsMs) {
  state.eventCount++;
  state.lastEventTime = tsMs;
  state.endTime = event.timestamp;

  if (event.project) {
    state.projectCounts.set(event.project, (state.projectCounts.get(event.project) || 0) + 1);
  }

  if (Array.isArray(event.filesTouched)) {
    for (const f of event.filesTouched) {
      if (state.filesSet.size >= MAX_FILES) break;
      if (typeof f === 'string') state.filesSet.add(f);
    }
  }

  if (typeof event.tokensIn === 'number') {
    state.tokensIn = (state.tokensIn == null ? 0 : state.tokensIn) + event.tokensIn;
    state.sawTokensIn = true;
  }
  if (typeof event.tokensOut === 'number') {
    state.tokensOut = (state.tokensOut == null ? 0 : state.tokensOut) + event.tokensOut;
    state.sawTokensOut = true;
  }
  if (typeof event.estimatedCostUsd === 'number') {
    state.costSum = (state.costSum == null ? 0 : state.costSum) + event.estimatedCostUsd;
    state.sawCost = true;
  }
  if (typeof event.durationMs === 'number') {
    state.durationMsMax = state.durationMsMax == null
      ? event.durationMs
      : Math.max(state.durationMsMax, event.durationMs);
  }
  if (event.eventType === 'error') state.errorCount++;
  if (event.eventType === 'session_end') state.sawSessionEnd = true;
  if (event.model) state.modelsSet.add(event.model);
  if (event.metadata && event.metadata.tokensEstimated) state.tokensEstimated = true;
}

// ── Public API ────────────────────────────────────────────────────────────────

function recordEvent(event) {
  if (!event || typeof event !== 'object') return;
  const tsMs = Date.parse(event.timestamp);
  if (isNaN(tsMs)) return;

  _closeStale(tsMs);

  const { key, hasSessionId } = keyFor(event);
  let state = _live.get(key);
  if (!state) {
    state = createState(event, hasSessionId, tsMs);
    _live.set(key, state);
  }

  _applyEvent(state, event, tsMs);
  _scheduleSave();
}

function getLiveSessions() {
  return [..._live.values()].map((s) => toRollup(s, true));
}

function getStats() {
  return {
    completedSessions: _completed.length,
    liveSessions: _live.size,
  };
}

function setOnSessionClosed(cb) {
  _onSessionClosed = typeof cb === 'function' ? cb : null;
}

function _scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flush, 1500);
}

function _flush() {
  try {
    ensureDir(SESSIONS_PATH);
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      generated: new Date().toISOString(),
      totalSessions: _completed.length,
      sessions: _completed,
      live: getLiveSessions(),
    }, null, 2));
  } catch (err) {
    console.error('[agentSessionBuilder] Save failed:', err.message);
  }
}

function readNDJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const out = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch { return []; }
}

function init() {
  const historical = readNDJSON(EVENTS_LOG);
  if (historical.length) {
    for (const event of historical) recordEvent(event);
    _flush();
    console.log(`[agentSessionBuilder] Rebuilt from ${historical.length} historical agent events → ${_completed.length} completed, ${_live.size} live`);
  } else {
    if (!fs.existsSync(SESSIONS_PATH)) _flush();
    console.log('[agentSessionBuilder] Initialized (no history yet)');
  }
}

function flush() {
  // Per spec: flush() closes nothing — it just persists current state,
  // including any still-open live sessions under the "live" array.
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _flush();
}

module.exports = { init, recordEvent, getLiveSessions, getStats, flush, setOnSessionClosed };
