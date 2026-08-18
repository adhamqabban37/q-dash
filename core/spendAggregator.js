'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH SPEND AGGREGATOR — canonical AgentEvents → output/spend.json
// Buckets totals/byAgent/byProject/byDay/byWeek. Day/week bucketing uses
// core/time.js (America/Chicago policy) — timestamps are stored UTC, bucketed
// in the configured zone. See core/time.js header for the full policy note.
//
// Delta semantics: only 'session_end' events carry tokens/cost/duration.
// tokensIn/tokensOut/estimatedCostUsd on a session_end are already the DELTA
// since the previous session_end (per the agent-event schema), so they're
// summed directly. durationMs on a session_end is a RUNNING TOTAL for that
// session, so we track the last-seen durationMs per `${agentType}:${sessionId}`
// and only add the increase.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const time = require('./time');

const SPEND_PATH = path.join(__dirname, '..', 'output', 'spend.json');
const EVENTS_LOG  = path.join(__dirname, '..', 'output', 'agent-events.log.json');

let _totals   = _makeBucket();
let _byAgent  = new Map();
let _byProject = new Map();
let _byDay    = new Map(); // dayKey -> { ...bucket, byAgent: Map }
let _byWeek   = new Map();

let _lastDurationBySession = new Map(); // `${agentType}:${sessionId}` -> last-seen durationMs

let _saveTimer = null;

function _makeBucket() {
  return { events: 0, tokensIn: null, tokensOut: null, costUsd: null, durationMs: null, lastActive: null };
}

function _ensureBucket(map, key) {
  if (!map.has(key)) map.set(key, _makeBucket());
  return map.get(key);
}

function _ensureDayBucket(map, key) {
  if (!map.has(key)) {
    const b = _makeBucket();
    b.byAgent = new Map();
    map.set(key, b);
  }
  return map.get(key);
}

function _addNumber(bucket, field, value) {
  if (typeof value !== 'number' || isNaN(value)) return;
  bucket[field] = (bucket[field] == null ? 0 : bucket[field]) + value;
}

function _updateLastActive(bucket, ts) {
  if (!ts) return;
  const tsMs = Date.parse(ts);
  if (isNaN(tsMs)) return;
  if (!bucket.lastActive || tsMs > Date.parse(bucket.lastActive)) bucket.lastActive = ts;
}

// durationIncrement(event) -> number|null
// null means "no duration data on this event" (don't touch the durationMs
// field at all so it can stay null if never seen).
function _durationIncrement(event) {
  if (typeof event.durationMs !== 'number') return null;
  if (event.sessionId) {
    const key = `${event.agentType}:${event.sessionId}`;
    const prev = _lastDurationBySession.get(key) || 0;
    const inc = Math.max(0, event.durationMs - prev);
    _lastDurationBySession.set(key, event.durationMs);
    return inc;
  }
  // No sessionId to track a running total against — treat the value as-is.
  return event.durationMs;
}

function _bumpNumeric(bucket, event, durInc, isSessionEnd) {
  if (!isSessionEnd) return;
  _addNumber(bucket, 'tokensIn', event.tokensIn);
  _addNumber(bucket, 'tokensOut', event.tokensOut);
  _addNumber(bucket, 'costUsd', event.estimatedCostUsd);
  _addNumber(bucket, 'durationMs', durInc);
}

function recordEvent(event) {
  if (!event || typeof event !== 'object') return;

  const ts = event.timestamp;
  const isSessionEnd = event.eventType === 'session_end';
  const durInc = isSessionEnd ? _durationIncrement(event) : null;

  _totals.events++;
  _bumpNumeric(_totals, event, durInc, isSessionEnd);
  _updateLastActive(_totals, ts);

  const agentKey = event.agentId || event.agentType;
  if (agentKey) {
    const b = _ensureBucket(_byAgent, agentKey);
    b.events++;
    _bumpNumeric(b, event, durInc, isSessionEnd);
    _updateLastActive(b, ts);
  }

  if (event.project) {
    const b = _ensureBucket(_byProject, event.project);
    b.events++;
    _bumpNumeric(b, event, durInc, isSessionEnd);
    _updateLastActive(b, ts);
  }

  const dKey = time.dayKey(ts);
  if (dKey) {
    const b = _ensureDayBucket(_byDay, dKey);
    b.events++;
    _bumpNumeric(b, event, durInc, isSessionEnd);
    _updateLastActive(b, ts);
    if (agentKey) {
      const ab = _ensureBucket(b.byAgent, agentKey);
      ab.events++;
      _bumpNumeric(ab, event, durInc, isSessionEnd);
      _updateLastActive(ab, ts);
    }
  }

  const wKey = time.weekKey(ts);
  if (wKey) {
    const b = _ensureBucket(_byWeek, wKey);
    b.events++;
    _bumpNumeric(b, event, durInc, isSessionEnd);
    _updateLastActive(b, ts);
  }

  _scheduleSave();
}

function getStats() {
  return {
    totalEvents: _totals.events,
    agents: _byAgent.size,
    projects: _byProject.size,
    days: _byDay.size,
    weeks: _byWeek.size,
  };
}

// ── Serialization ─────────────────────────────────────────────────────────────

function _roundBucket(b) {
  const out = { events: b.events, tokensIn: b.tokensIn, tokensOut: b.tokensOut, durationMs: b.durationMs, lastActive: b.lastActive };
  out.costUsd = typeof b.costUsd === 'number' ? Math.round(b.costUsd * 1e6) / 1e6 : null;
  return out;
}

function _mapToObj(map, fn) {
  const out = {};
  for (const [k, v] of map) out[k] = fn(v);
  return out;
}

function _buildSnapshot() {
  return {
    generated: time.nowIso(),
    timezone: time.ZONE,
    totals: _roundBucket(_totals),
    byAgent: _mapToObj(_byAgent, _roundBucket),
    byProject: _mapToObj(_byProject, _roundBucket),
    byDay: _mapToObj(_byDay, (b) => ({ ..._roundBucket(b), byAgent: _mapToObj(b.byAgent, _roundBucket) })),
    byWeek: _mapToObj(_byWeek, _roundBucket),
  };
}

function _scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_flush, 1200);
}

function _ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _flush() {
  try {
    _ensureDir(SPEND_PATH);
    fs.writeFileSync(SPEND_PATH, JSON.stringify(_buildSnapshot(), null, 2));
  } catch (err) {
    console.error('[spendAggregator] Save failed:', err.message);
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
    console.log(`[spendAggregator] Rebuilt from ${historical.length} historical agent events`);
  } else {
    if (!fs.existsSync(SPEND_PATH)) _flush();
    console.log('[spendAggregator] Initialized (no history yet)');
  }
}

function flush() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _flush();
}

module.exports = { init, recordEvent, getStats, flush };
