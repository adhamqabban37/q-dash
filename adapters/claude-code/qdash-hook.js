#!/usr/bin/env node
'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH Claude Code Hook Adapter
//
// Reads a Claude Code hook JSON payload from stdin, maps it to the canonical
// Q DASH AgentEvent wire format (schema "qdash.agent-event.v1"), and POSTs it
// to QDASH_INGEST_URL (default http://localhost:4200/api/ingest). If the POST
// fails or times out, the event is appended as a JSONL line under
// ~/.qdash/inbox/ instead.
//
// Reliability contract (do not weaken):
//   - Hard 2s network timeout.
//   - ALWAYS process.exit(0) — a broken hook must never block Claude Code.
//   - Every fs/JSON operation is wrapped in try/catch.
//
// See README.md in this folder for the full AgentEvent schema and the
// per-hook-event mapping rules.
// ════════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const INGEST_URL = process.env.QDASH_INGEST_URL || 'http://localhost:4200/api/ingest';
const INBOX_DIR   = path.join(os.homedir(), '.qdash', 'inbox');
const STATE_DIR   = path.join(os.homedir(), '.qdash', 'state');
const TIMEOUT_MS  = 2000;
const AGENT_ID    = 'claude-code';
const AGENT_TYPE  = 'claude-code';
const SCHEMA      = 'qdash.agent-event.v1';
const MAX_TRANSCRIPT_READ_BYTES = 5 * 1024 * 1024; // 5 MB cap per Stop/SessionEnd read

// ── fs helpers ────────────────────────────────────────────────────────────

function ensureDir(d) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch {}
}

// ── project detection (kept as-is) ──────────────────────────────────────

function detectProject(cwd) {
  if (!cwd) return 'unknown';
  let dir = path.resolve(cwd);
  // Walk up to find .git
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return path.basename(dir);
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (j.name) return j.name;
      } catch {}
      return path.basename(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.basename(cwd);
}

// ── per-session state (~/.qdash/state/claude-<sessionId>.json) ───────────

function statePath(sessionId) {
  return path.join(STATE_DIR, `claude-${sessionId}.json`);
}

function loadState(sessionId) {
  try {
    const p = statePath(sessionId);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    // Broken state file must never crash or block — treat as absent.
    return null;
  }
}

function saveState(sessionId, state) {
  try {
    ensureDir(STATE_DIR);
    fs.writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {}
}

// ── canonical AgentEvent builder ──────────────────────────────────────────

function baseEvent(hookData, eventType) {
  const sessionId = hookData?.session_id || null;
  const cwd = hookData?.cwd || hookData?.working_dir || process.cwd();
  return {
    schema: SCHEMA,
    agentId: AGENT_ID,
    agentType: AGENT_TYPE,
    sessionId,
    timestamp: new Date().toISOString(),
    eventType,
    project: detectProject(cwd),
    filesTouched: [],
    tokensIn: null,
    tokensOut: null,
    model: null,
    estimatedCostUsd: null, // ALWAYS null from the adapter — engine computes cost
    durationMs: null,
    metadata: {},
  };
}

// ── SessionStart ───────────────────────────────────────────────────────────

function handleSessionStart(hookData, hookEvent) {
  const event = baseEvent(hookData, 'session_start');
  const sessionId = hookData?.session_id || null;

  event.metadata = { hookEvent };
  if (hookData?.source !== undefined) event.metadata.source = hookData.source;

  if (sessionId) {
    saveState(sessionId, {
      sessionId,
      startTs: event.timestamp,
      transcriptPath: hookData?.transcript_path || null,
      offset: 0,
      reportedIn: 0,
      reportedOut: 0,
      lastModel: null,
      project: event.project,
    });
  }

  return event;
}

// ── UserPromptSubmit ───────────────────────────────────────────────────────

function handleUserPromptSubmit(hookData, hookEvent) {
  const event = baseEvent(hookData, 'tool_call');
  event.metadata = { kind: 'prompt', hookEvent };
  return event;
}

// ── PostToolUse ────────────────────────────────────────────────────────────

function isToolResponseError(toolResponse) {
  if (toolResponse == null) return false;
  if (typeof toolResponse === 'string') return /^Error/i.test(toolResponse);
  if (typeof toolResponse === 'object') {
    if (toolResponse.is_error === true) return true;
    if (toolResponse.error) return true;
  }
  return false;
}

function extractErrorMessage(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  if (toolResponse && toolResponse.error) {
    return typeof toolResponse.error === 'string' ? toolResponse.error : JSON.stringify(toolResponse.error);
  }
  try { return JSON.stringify(toolResponse); } catch { return String(toolResponse); }
}

function handlePostToolUse(hookData, hookEvent) {
  const tool = hookData?.tool_name || 'unknown';
  const toolInput = hookData?.tool_input || {};
  const toolResponse = hookData?.tool_response;

  let event;

  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    event = baseEvent(hookData, 'file_change');
    const f = toolInput.file_path || toolInput.path || toolInput.notebook_path;
    event.filesTouched = [f].filter(Boolean);
    event.metadata = { kind: 'edit', tool };
  } else if (tool === 'Read') {
    const f = toolInput.file_path || toolInput.path;
    event = baseEvent(hookData, 'tool_call');
    event.filesTouched = [f].filter(Boolean);
    if (f && /SKILL\.md$/i.test(f)) {
      event.metadata = { kind: 'skill_invoked', skill: path.basename(path.dirname(f)), tool };
    } else {
      event.metadata = { kind: 'memory_read', tool };
    }
  } else if (tool === 'Bash') {
    event = baseEvent(hookData, 'tool_call');
    const cmd = toolInput.command != null ? String(toolInput.command) : '';
    event.metadata = { kind: 'command_run', tool, cmd: cmd.slice(0, 200) };
  } else {
    event = baseEvent(hookData, 'tool_call');
    event.metadata = { kind: 'tool', tool };
  }

  if (isToolResponseError(toolResponse)) {
    event.eventType = 'error';
    event.metadata.error = extractErrorMessage(toolResponse).slice(0, 300);
  }

  return event;
}

// ── SubagentStop ───────────────────────────────────────────────────────────

function handleSubagentStop(hookData, hookEvent) {
  const event = baseEvent(hookData, 'tool_call');
  event.metadata = { kind: 'subagent', hookEvent };
  return event;
}

// ── transcript token accounting (Stop / SessionEnd) ───────────────────────

// Reads new, complete JSONL lines from transcriptPath starting at byte offset,
// capped at MAX_TRANSCRIPT_READ_BYTES. Sums usage across "assistant" messages.
// If the tail of the read chunk is a truncated (incomplete) line, that partial
// line is left unconsumed and the returned offset stops before it, so the next
// call re-reads it in full.
function parseTranscriptDelta(transcriptPath, offset) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return { ok: false, reason: 'stat-failed' };
  }

  const fileSize = stat.size;
  if (fileSize <= offset) {
    return { ok: true, newOffset: offset, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, model: null };
  }

  const bytesToRead = Math.min(fileSize - offset, MAX_TRANSCRIPT_READ_BYTES);
  let buf;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    buf = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buf, 0, bytesToRead, offset);
  } catch {
    return { ok: false, reason: 'read-failed', fileSize };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }

  // Find the last newline byte in the chunk (0x0A is unambiguous even inside
  // UTF-8 multi-byte sequences, since continuation bytes are always >= 0x80).
  const NL = 0x0A;
  let lastNL = -1;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (buf[i] === NL) { lastNL = i; break; }
  }

  if (lastNL === -1) {
    // No complete line available yet in this chunk — do not advance offset.
    return { ok: true, newOffset: offset, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, model: null };
  }

  const completeBuf = buf.slice(0, lastNL + 1);
  const newOffset = offset + completeBuf.length;

  let text;
  try {
    text = completeBuf.toString('utf8');
  } catch {
    return { ok: false, reason: 'decode-failed', fileSize };
  }

  const rawLines = text.split('\n').filter((l) => l.trim().length > 0);

  let tokensIn = 0, tokensOut = 0, cacheRead = 0, cacheWrite = 0, model = null;
  let parsedAny = false;

  for (const line of rawLines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    parsedAny = true;
    if (obj && obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (msg.model) model = msg.model;
      const usage = msg.usage;
      if (usage) {
        tokensIn   += Number(usage.input_tokens) || 0;
        tokensOut  += Number(usage.output_tokens) || 0;
        cacheRead  += Number(usage.cache_read_input_tokens) || 0;
        cacheWrite += Number(usage.cache_creation_input_tokens) || 0;
      }
    }
  }

  // If there were lines but none parsed as JSON, treat the transcript as
  // unparseable so the caller falls back to size-based estimation.
  if (rawLines.length > 0 && !parsedAny) {
    return { ok: false, reason: 'unparseable', fileSize };
  }

  return { ok: true, newOffset, tokensIn, tokensOut, cacheRead, cacheWrite, model };
}

// TODO: estimation fallback — real usage comes from transcript JSONL; revisit
// if Claude Code hooks ever expose usage directly (would remove the need for
// this byte-size heuristic entirely).
function estimateFromSizeDelta(transcriptPath, offset) {
  try {
    const stat = fs.statSync(transcriptPath);
    const fileSize = stat.size;
    if (fileSize <= offset) {
      return { newOffset: offset, tokensIn: 0, tokensOut: 0 };
    }
    const deltaBytes = fileSize - offset;
    const totalTokens = Math.round(deltaBytes / 4); // ~4 chars/token heuristic
    const tokensIn = Math.round(totalTokens * 0.8);
    const tokensOut = totalTokens - tokensIn;
    return { newOffset: fileSize, tokensIn, tokensOut };
  } catch {
    return null; // size unavailable — caller sets tokensIn/tokensOut to null
  }
}

function handleSessionEnd(hookData, hookEvent) {
  const sessionId = hookData?.session_id || null;
  const event = baseEvent(hookData, 'session_end');
  event.metadata = { hookEvent };

  let state = sessionId ? loadState(sessionId) : null;
  if (!state) {
    // No prior SessionStart state (missing/lost state file). Build a
    // best-effort ephemeral state so token accounting can still proceed —
    // duration will be ~0 and only reflects from-now-on transcript growth.
    state = {
      sessionId,
      startTs: event.timestamp,
      transcriptPath: hookData?.transcript_path || null,
      offset: 0,
      reportedIn: 0,
      reportedOut: 0,
      lastModel: null,
      project: event.project,
    };
  }

  const transcriptPath = state.transcriptPath || hookData?.transcript_path || null;
  let tokensIn = null, tokensOut = null;
  let model = state.lastModel || null;
  let cacheRead = 0, cacheWrite = 0;
  let newOffset = state.offset || 0;
  let estimated = false;

  // Without a sessionId the offset can never be persisted, so parsing the
  // transcript would re-report the same tokens on every Stop. Skip accounting.
  if (transcriptPath && sessionId) {
    const delta = parseTranscriptDelta(transcriptPath, state.offset || 0);
    if (delta && delta.ok) {
      tokensIn = delta.tokensIn;
      tokensOut = delta.tokensOut;
      cacheRead = delta.cacheRead;
      cacheWrite = delta.cacheWrite;
      if (delta.model) model = delta.model;
      newOffset = delta.newOffset;
    } else {
      const est = estimateFromSizeDelta(transcriptPath, state.offset || 0);
      if (est) {
        tokensIn = est.tokensIn;
        tokensOut = est.tokensOut;
        newOffset = est.newOffset;
        estimated = true;
      } else {
        tokensIn = null;
        tokensOut = null;
      }
    }
  }

  event.tokensIn = tokensIn;
  event.tokensOut = tokensOut;
  event.model = model;
  event.durationMs = Date.now() - Date.parse(state.startTs || event.timestamp);
  event.metadata.cacheReadTokens = cacheRead;
  event.metadata.cacheWriteTokens = cacheWrite;
  if (estimated) event.metadata.tokensEstimated = true;

  if (sessionId) {
    state.offset = newOffset;
    state.reportedIn = (state.reportedIn || 0) + (tokensIn || 0);
    state.reportedOut = (state.reportedOut || 0) + (tokensOut || 0);
    state.lastModel = model;
    saveState(sessionId, state);
  }

  return event;
}

// ── dispatcher ─────────────────────────────────────────────────────────────

function mapHookToEvent(hookData) {
  const hookEvent = hookData?.hook_event_name;

  switch (hookEvent) {
    case 'SessionStart':
      return handleSessionStart(hookData, hookEvent);
    case 'UserPromptSubmit':
      return handleUserPromptSubmit(hookData, hookEvent);
    case 'PreToolUse':
      return null; // only PostToolUse emits, to avoid double counting
    case 'PostToolUse':
      return handlePostToolUse(hookData, hookEvent);
    case 'Stop':
    case 'SessionEnd':
      return handleSessionEnd(hookData, hookEvent);
    case 'SubagentStop':
      return handleSubagentStop(hookData, hookEvent);
    case 'Notification':
    default:
      return null; // unknown/uninteresting hook events emit nothing
  }
}

// ── transport (kept as-is) ─────────────────────────────────────────────────

function postJSON(payload) {
  return new Promise((resolve) => {
    try {
      const body = Buffer.from(JSON.stringify(payload));
      const url  = new URL(INGEST_URL);
      const req  = http.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
        timeout: TIMEOUT_MS,
      }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });
      req.on('timeout', () => { try { req.destroy(); } catch {} resolve(false); });
      req.on('error',   () => resolve(false));
      req.write(body);
      req.end();
    } catch { resolve(false); }
  });
}

function fallbackToInbox(event) {
  try {
    ensureDir(INBOX_DIR);
    const file = path.join(INBOX_DIR, `claude-${Date.now()}.jsonl`);
    fs.writeFileSync(file, JSON.stringify(event) + '\n');
    return true;
  } catch { return false; }
}

// ── entrypoint ───────────────────────────────────────────────────────────

async function main() {
  let raw = '';
  try {
    raw = await new Promise((resolve) => {
      let buf = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => { buf += c; if (buf.length > 100000) { buf = buf.slice(0, 100000); } });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', () => resolve(''));
      setTimeout(() => resolve(buf), 500);
    });
  } catch {}

  if (!raw.trim()) process.exit(0);

  let hookData;
  try { hookData = JSON.parse(raw); } catch { process.exit(0); }

  let event;
  try {
    event = mapHookToEvent(hookData);
  } catch {
    // A mapping bug must never crash the hook or block Claude Code.
    process.exit(0);
  }
  if (!event) process.exit(0);

  // Fire and forget — don't await beyond the network timeout window.
  const ok = await postJSON(event);
  if (!ok) fallbackToInbox(event);
  // Always exit 0 immediately.
  process.exit(0);
}

main();
