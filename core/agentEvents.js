'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH AGENT EVENTS — canonical agent-event schema helpers
// Loads core/agent-schema.json once at require time and exposes validate/
// normalize/fromLegacy helpers shared by the engine and the Next.js UI
// ingest route. Pure functions, no I/O beyond the one-time schema load.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, 'agent-schema.json');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

const SCHEMA_ID   = SCHEMA.schemaId;
const AGENT_TYPES = new Set(SCHEMA.agentTypes);
const EVENT_TYPES = new Set(SCHEMA.eventTypes);

const LEGACY_SOURCES = SCHEMA.legacySources || {};
const LEGACY_TYPES   = SCHEMA.legacyTypes || {};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isNumberOrNullish(v) {
  return v === null || v === undefined || typeof v === 'number';
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// validate(raw) -> string|null (error code, or null when valid)
function validate(raw) {
  if (!isPlainObject(raw)) return 'not_an_object';
  if (raw.schema !== SCHEMA_ID) return `invalid_schema:${raw.schema}`;
  if (!AGENT_TYPES.has(raw.agentType)) return `invalid_agentType:${raw.agentType}`;
  if (!EVENT_TYPES.has(raw.eventType)) return `invalid_eventType:${raw.eventType}`;
  if (typeof raw.timestamp !== 'string' || isNaN(Date.parse(raw.timestamp))) return 'invalid_timestamp';
  if (typeof raw.project !== 'string' || !raw.project.trim()) return 'invalid_project';
  if (raw.filesTouched !== undefined && !isStringArray(raw.filesTouched)) return 'invalid_filesTouched';
  if (!isNumberOrNullish(raw.tokensIn)) return 'invalid_tokensIn';
  if (!isNumberOrNullish(raw.tokensOut)) return 'invalid_tokensOut';
  if (!isNumberOrNullish(raw.durationMs)) return 'invalid_durationMs';
  if (!isNumberOrNullish(raw.estimatedCostUsd)) return 'invalid_estimatedCostUsd';
  if (raw.metadata !== undefined && !isPlainObject(raw.metadata)) return 'invalid_metadata';
  return null;
}

// normalize(raw) -> canonical event with every field present.
// NEVER coerces null/undefined token counts to 0 — they stay null so
// downstream cost estimation can distinguish "no data" from "zero usage".
function normalize(raw) {
  raw = raw || {};

  const numberOrNull = (v) => (typeof v === 'number' ? v : null);

  return {
    schema: SCHEMA_ID,
    agentId: (typeof raw.agentId === 'string' && raw.agentId) ? raw.agentId : raw.agentType,
    agentType: raw.agentType,
    sessionId: (typeof raw.sessionId === 'string' && raw.sessionId) ? raw.sessionId : null,
    timestamp: raw.timestamp,
    eventType: raw.eventType,
    project: raw.project,
    filesTouched: isStringArray(raw.filesTouched) ? raw.filesTouched : [],
    tokensIn: numberOrNull(raw.tokensIn),
    tokensOut: numberOrNull(raw.tokensOut),
    model: (typeof raw.model === 'string' && raw.model) ? raw.model : null,
    estimatedCostUsd: numberOrNull(raw.estimatedCostUsd),
    durationMs: numberOrNull(raw.durationMs),
    metadata: isPlainObject(raw.metadata) ? raw.metadata : {},
  };
}

// fromLegacy(legacyEvent) -> canonical event or null
// Converts the old wire shape {source, project, type, detail, ts} — see
// core/ingestBridge.js validateEvent/mapToEngineEvent for the exact old
// shape — into the new canonical agent-event schema.
function fromLegacy(legacyEvent) {
  if (!isPlainObject(legacyEvent)) return null;

  const agentType = LEGACY_SOURCES[legacyEvent.source];
  if (!agentType) return null;

  const typeMap = LEGACY_TYPES[legacyEvent.type];
  if (!typeMap) return null;

  const detail = isPlainObject(legacyEvent.detail) ? legacyEvent.detail : {};

  let filesTouched = [];
  if (Array.isArray(detail.files)) {
    filesTouched = detail.files.filter((x) => typeof x === 'string');
  } else if (typeof detail.file === 'string') {
    filesTouched = [detail.file];
  }

  const metadata = {
    tool: detail.tool !== undefined ? detail.tool : null,
    cmd: detail.cmd !== undefined ? detail.cmd : null,
    skill: detail.skill !== undefined ? detail.skill : null,
    cwd: detail.cwd !== undefined ? detail.cwd : null,
    kind: typeMap.kind !== undefined ? typeMap.kind : null,
    legacy: true,
  };

  return normalize({
    schema: SCHEMA_ID,
    agentId: agentType,
    agentType,
    sessionId: null,
    timestamp: legacyEvent.ts,
    eventType: typeMap.eventType,
    project: legacyEvent.project,
    filesTouched,
    tokensIn: null,
    tokensOut: null,
    model: null,
    estimatedCostUsd: null,
    durationMs: null,
    metadata,
  });
}

// isCanonical(raw) -> boolean
function isCanonical(raw) {
  return !!raw && raw.schema === SCHEMA_ID;
}

module.exports = {
  SCHEMA_ID,
  AGENT_TYPES,
  EVENT_TYPES,
  validate,
  normalize,
  fromLegacy,
  isCanonical,
};
