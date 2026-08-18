'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH INGEST BRIDGE — Agent telemetry → existing eventBus
// Watches the bridge trigger file + JSONL inbox, normalizes events (canonical
// qdash.agent-event.v1 shape OR legacy {source,type,detail,ts} shape — see
// core/agentEvents.js), tags with origin: 'agent', and fires them through the
// engine pipeline. Also appends every canonical event to the new
// output/agent-events.log.json source-of-truth log and applies cost via
// core/costMeter.js.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const agentEvents = require('./agentEvents');
const costMeter    = require('./costMeter');

const QDIR        = path.join(os.homedir(), '.qdash');
const BRIDGE_DIR  = path.join(QDIR, 'bridge');
const INBOX_DIR   = path.join(QDIR, 'inbox');
const TRIGGER     = path.join(BRIDGE_DIR, 'trigger.json');
const PENDING     = path.join(BRIDGE_DIR, 'inbox-pending.jsonl');
const ERRORS_LOG  = path.join(__dirname, '..', 'output', 'ingest-errors.log');
const AGENT_EVENTS_LOG = path.join(__dirname, '..', 'output', 'agent-events.log.json');

const VALID_SOURCES = new Set(['claude-code', 'hermes', 'gemini-cli', 'manual']);
const VALID_TYPES   = new Set(['session_start', 'session_end', 'tool_call', 'skill_invoked', 'file_edit', 'command_run', 'memory_read']);

// Canonical eventType/metadata.kind → legacy-style discriminator, so the
// existing inferIntent/inferImpact heuristics (written against the old
// {source,type,detail} wire shape) keep working unchanged.
const LEGACY_KIND_BY_EVENTTYPE = {
  session_start: 'session_start',
  session_end: 'session_end',
  error: 'error',
};
const LEGACY_KIND_BY_TOOLCALL_KIND = {
  skill_invoked: 'skill_invoked',
  command_run: 'command_run',
  memory_read: 'memory_read',
};

// Echo suppression: paths an agent event just touched, so the filesystem
// watcher's own reaction to that write doesn't get double-counted as a
// separate "human" event. 5s TTL, normalized (lowercase, forward slashes).
const ECHO_TTL_MS = 5000;
let _touchedPaths = new Map(); // normalizedPath -> expiry (ms epoch)

let _eventBus = null;
let _saveTimer = null;
let _lastTriggerMtime = 0;

function ensureDirs() {
  for (const d of [QDIR, BRIDGE_DIR, INBOX_DIR, path.dirname(ERRORS_LOG)]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  if (!fs.existsSync(PENDING)) fs.writeFileSync(PENDING, '');
  if (!fs.existsSync(TRIGGER)) fs.writeFileSync(TRIGGER, JSON.stringify({ ts: Date.now() }));
}

function logError(msg, raw) {
  try {
    fs.appendFileSync(ERRORS_LOG, JSON.stringify({ ts: new Date().toISOString(), msg, raw }) + '\n');
  } catch {}
}

function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return 'not_an_object';
  if (!VALID_SOURCES.has(raw.source)) return `invalid_source:${raw.source}`;
  if (!VALID_TYPES.has(raw.type))     return `invalid_type:${raw.type}`;
  if (typeof raw.project !== 'string' || !raw.project.trim()) return 'missing_project';
  if (typeof raw.ts !== 'string' || isNaN(Date.parse(raw.ts))) return 'invalid_ts';
  if (raw.detail !== undefined && (typeof raw.detail !== 'object' || Array.isArray(raw.detail))) return 'invalid_detail';
  return null;
}

// ── Echo suppression ─────────────────────────────────────────────────────────

function normalizeEchoPath(p) {
  if (typeof p !== 'string' || !p) return null;
  return p.toLowerCase().replace(/\\/g, '/');
}

function markTouched(filesTouched) {
  if (!Array.isArray(filesTouched) || !filesTouched.length) return;
  const expiry = Date.now() + ECHO_TTL_MS;
  for (const f of filesTouched) {
    const norm = normalizeEchoPath(f);
    if (norm) _touchedPaths.set(norm, expiry);
  }
}

// isAgentEcho(path) -> boolean — true if an agent event touched this path
// within the last ECHO_TTL_MS milliseconds.
function isAgentEcho(filePath) {
  const norm = normalizeEchoPath(filePath);
  if (!norm) return false;
  const expiry = _touchedPaths.get(norm);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    _touchedPaths.delete(norm);
    return false;
  }
  return true;
}

// ── Canonical log (new source-of-truth) ──────────────────────────────────────

function appendCanonicalLog(canonical) {
  try {
    const dir = path.dirname(AGENT_EVENTS_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AGENT_EVENTS_LOG, JSON.stringify(canonical) + '\n');
  } catch (e) {
    logError('agent_log_append_failed', e.message);
  }
}

// ── Map canonical event → legacy engineEvent (feeds semantic/heatmap/session) ─

function legacyKindFromCanonical(canonical) {
  const byEventType = LEGACY_KIND_BY_EVENTTYPE[canonical.eventType];
  if (byEventType) return byEventType;
  if (canonical.eventType === 'file_change') return 'file_edit';
  if (canonical.eventType === 'tool_call') {
    const kind = canonical.metadata && canonical.metadata.kind;
    return LEGACY_KIND_BY_TOOLCALL_KIND[kind] || 'tool_call';
  }
  return canonical.eventType;
}

function mapToEngineEvent(canonical) {
  const ts       = canonical.timestamp;
  const project  = canonical.project;
  const source   = canonical.agentType; // claude-code | gemini | hermes | human
  const metadata = (canonical.metadata && typeof canonical.metadata === 'object') ? canonical.metadata : {};
  const legacyType = legacyKindFromCanonical(canonical);

  const file = (Array.isArray(canonical.filesTouched) && canonical.filesTouched[0])
    || metadata.file || metadata.cwd || null;
  const basePath = file || `agent://${source}/${project}`;

  // detail is tolerant: canonical-only fields live in metadata, but we mirror
  // the old detail.{tool,cmd,skill,cwd,file} shape for existing consumers.
  const detail = {
    tool:  metadata.tool  !== undefined ? metadata.tool  : null,
    cmd:   metadata.cmd   !== undefined ? metadata.cmd   : null,
    skill: metadata.skill !== undefined ? metadata.skill : null,
    cwd:   metadata.cwd   !== undefined ? metadata.cwd   : null,
    file,
    files: Array.isArray(canonical.filesTouched) ? canonical.filesTouched : [],
  };

  const engineEvent = {
    path: basePath,
    origin: 'agent',
    source,
    agentType: legacyType,
    agentProject: project,
    agentDetail: detail,
    timestamp: ts,
    semantic: {
      intent: inferIntent(legacyType, detail),
      category: 'agent',
      project,
      domain: source,
      impact: inferImpact(legacyType, detail),
      confidence: 0.9,
      signals: [source, legacyType],
      changeVerb: legacyType,
    },
  };

  return engineEvent;
}

function inferIntent(type, detail) {
  switch (type) {
    case 'session_start': return 'agent:start';
    case 'session_end':   return 'agent:end';
    case 'error':          return 'agent:error';
    case 'tool_call':     return `agent:tool:${detail.tool || 'unknown'}`;
    case 'skill_invoked': return `agent:skill:${detail.skill || 'unknown'}`;
    case 'file_edit':     return `agent:edit:${detail.tool || 'Edit'}`;
    case 'command_run':   return `agent:cmd:${(detail.cmd || '').slice(0, 30)}`;
    case 'memory_read':   return `agent:read-memory`;
    default:              return 'agent:unknown';
  }
}

function inferImpact(type, detail) {
  if (type === 'session_start' || type === 'session_end') return 'low';
  if (type === 'error') return 'high';
  if (type === 'file_edit' && detail.tool === 'Write') return 'high';
  if (type === 'skill_invoked') return 'high';
  if (type === 'command_run' && (detail.cmd || '').match(/git (push|reset|rebase)|rm -rf|npm publish/i)) return 'high';
  return 'medium';
}

// ── Line processing ───────────────────────────────────────────────────────────

function processLine(line) {
  if (!line.trim()) return false;
  let parsed;
  try { parsed = JSON.parse(line); } catch (e) { logError('json_parse', line); return false; }

  let canonical;

  if (agentEvents.isCanonical(parsed)) {
    const err = agentEvents.validate(parsed);
    if (err) { logError(err, line); return false; }
    canonical = agentEvents.normalize(parsed);
  } else {
    const legacyErr = validateEvent(parsed);
    const fromLegacy = agentEvents.fromLegacy(parsed);
    // Reject only when BOTH the legacy validator and the canonical converter fail.
    if (legacyErr && !fromLegacy) {
      logError(legacyErr, line);
      return false;
    }
    canonical = fromLegacy;
    if (!canonical) {
      // Legacy validation passed but conversion unexpectedly failed — reject
      // rather than emit an engine event with no canonical counterpart.
      logError('fromLegacy_failed_after_legacy_valid', line);
      return false;
    }
  }

  costMeter.applyCost(canonical);
  appendCanonicalLog(canonical);
  markTouched(canonical.filesTouched);

  const engineEvent = mapToEngineEvent(canonical);
  engineEvent.agent = canonical;

  if (_eventBus) {
    // Fire as a generic event so the catch-all in run.js routes it to all 4 layers
    _eventBus.fire('agent_event', engineEvent);
    // Also log it into the NDJSON feed for the UI
    _eventBus.fire('event', engineEvent);
  }
  return true;
}

function drainPending() {
  if (!fs.existsSync(PENDING)) return;
  try {
    const content = fs.readFileSync(PENDING, 'utf8');
    const lines = content.split('\n');
    const kept = [];
    let processed = 0;
    for (const line of lines) {
      if (line.trim() && processLine(line)) processed++;
      else if (line.trim()) kept.push(line); // keep invalid lines
    }
    // Rewrite pending with only the lines we couldn't process
    if (kept.length) fs.writeFileSync(PENDING, kept.join('\n') + '\n');
    else fs.writeFileSync(PENDING, '');
    if (processed > 0) console.log(`[ingestBridge] processed ${processed} agent events`);
  } catch (e) {
    logError('drain_failed', e.message);
  }
}

function watchBridge() {
  // Poll the trigger file's mtime (chokidar would be ideal but we already have one watcher)
  setInterval(() => {
    try {
      const stat = fs.statSync(TRIGGER);
      if (stat.mtimeMs !== _lastTriggerMtime) {
        _lastTriggerMtime = stat.mtimeMs;
        drainPending();
      }
    } catch {}
  }, 400);
}

const _inboxInFlight = new Set(); // filenames queued/being drained right now

function watchInbox() {
  // Watch the inbox folder for new .jsonl files (fallback ingestion).
  // Two guards against double-processing:
  //   1. Processed files are renamed to *.done (NOT *.jsonl) — the old
  //      `.processed-<ts>.jsonl` suffix still matched the .jsonl filter, so
  //      the watcher re-drained its own rename in an infinite loop.
  //   2. fs.watch fires multiple events per new file on Windows (rename +
  //      change) — _inboxInFlight collapses them into one drain.
  try {
    fs.watch(INBOX_DIR, { persistent: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      if (_inboxInFlight.has(filename)) return;
      _inboxInFlight.add(filename);
      const filePath = path.join(INBOX_DIR, filename);
      // Wait a moment for writes to settle
      setTimeout(() => {
        try {
          if (!fs.existsSync(filePath)) return;
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          for (const line of lines) processLine(line);
          // Rename OUT of the .jsonl namespace so the watcher never re-drains it
          const processed = path.join(INBOX_DIR, `${filename}.${Date.now()}.done`);
          try { fs.renameSync(filePath, processed); } catch {}
          console.log(`[ingestBridge] drained inbox file: ${filename}`);
        } catch (e) {
          logError('inbox_drain_failed', e.message);
        } finally {
          _inboxInFlight.delete(filename);
        }
      }, 500);
    });
  } catch (e) {
    logError('inbox_watch_failed', e.message);
  }
}

// Drain inbox .jsonl files that were written while the engine was down —
// fs.watch only fires for files created AFTER the watcher starts.
function drainExistingInbox() {
  try {
    const files = fs.readdirSync(INBOX_DIR).filter((f) => f.endsWith('.jsonl'));
    for (const filename of files) {
      const filePath = path.join(INBOX_DIR, filename);
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        for (const line of lines) processLine(line);
        try { fs.renameSync(filePath, path.join(INBOX_DIR, `${filename}.${Date.now()}.done`)); } catch {}
      } catch (e) {
        logError('inbox_boot_drain_failed', e.message);
      }
    }
    if (files.length) console.log(`[ingestBridge] boot-drained ${files.length} inbox file(s)`);
  } catch (e) {
    logError('inbox_boot_scan_failed', e.message);
  }
}

function init({ eventBus }) {
  _eventBus = eventBus;
  costMeter.init();
  ensureDirs();
  // Drain any pending events left from a previous session
  drainPending();
  drainExistingInbox();
  // Start watching
  watchBridge();
  watchInbox();
  console.log(`[ingestBridge] watching bridge: ${BRIDGE_DIR}`);
  console.log(`[ingestBridge] watching inbox:  ${INBOX_DIR}`);
}

// initForTest(): wires _eventBus + costMeter only — no real ~/.qdash dirs
// touched, no drainPending() (which would hoover up whatever is actually
// sitting in the live bridge inbox), no watchers started. Exists solely so
// unit tests can call processLine() against a stub bus in isolation.
function initForTest({ eventBus }) {
  _eventBus = eventBus;
  costMeter.init();
}

module.exports = {
  init, initForTest, processLine, validateEvent, ensureDirs,
  isAgentEcho, appendCanonicalLog,
  INBOX_DIR, BRIDGE_DIR, PENDING, TRIGGER, AGENT_EVENTS_LOG,
};
