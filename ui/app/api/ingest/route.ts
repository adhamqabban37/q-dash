import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

const QDIR       = path.join(os.homedir(), '.qdash');
const BRIDGE_DIR = path.join(QDIR, 'bridge');
const PENDING    = path.join(BRIDGE_DIR, 'inbox-pending.jsonl');
const TRIGGER    = path.join(BRIDGE_DIR, 'trigger.json');

const VALID_SOURCES = new Set(['claude-code', 'hermes', 'gemini-cli', 'manual']);
const VALID_TYPES   = new Set(['session_start', 'session_end', 'tool_call', 'skill_invoked', 'file_edit', 'command_run', 'memory_read']);

// Canonical qdash.agent-event.v1 schema — loaded once at module load, same
// path pattern the other routes use for OUTPUT (process.cwd()/../<dir>).
// The engine (core/agentEvents.js) owns full validate/normalize logic; this
// route only needs to recognize a canonical event well enough to accept it
// for the inbox — core/ingestBridge.js does the authoritative normalize.
const AGENT_SCHEMA_PATH = path.join(process.cwd(), '..', 'core', 'agent-schema.json');

let AGENT_SCHEMA: { schemaId: string; agentTypes: string[]; eventTypes: string[] } | null = null;
try {
  AGENT_SCHEMA = JSON.parse(fs.readFileSync(AGENT_SCHEMA_PATH, 'utf8'));
} catch {
  AGENT_SCHEMA = null;
}

function isCanonicalEvent(e: any): boolean {
  if (!AGENT_SCHEMA || !e || typeof e !== 'object') return false;
  if (e.schema !== AGENT_SCHEMA.schemaId) return false;
  if (!AGENT_SCHEMA.agentTypes.includes(e.agentType)) return false;
  if (!AGENT_SCHEMA.eventTypes.includes(e.eventType)) return false;
  if (typeof e.timestamp !== 'string' || isNaN(Date.parse(e.timestamp))) return false;
  if (typeof e.project !== 'string' || !e.project.trim()) return false;
  return true;
}

function ensureDirs() {
  for (const d of [QDIR, BRIDGE_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  if (!fs.existsSync(PENDING)) fs.writeFileSync(PENDING, '');
  if (!fs.existsSync(TRIGGER)) fs.writeFileSync(TRIGGER, JSON.stringify({ ts: Date.now() }));
}

function bumpTrigger() {
  try {
    fs.writeFileSync(TRIGGER, JSON.stringify({ ts: Date.now() }));
  } catch {}
}

function validateEvent(e: any): string | null {
  if (!e || typeof e !== 'object') return 'not_an_object';
  if (!VALID_SOURCES.has(e.source)) return `invalid_source:${e.source}`;
  if (!VALID_TYPES.has(e.type)) return `invalid_type:${e.type}`;
  if (typeof e.project !== 'string' || !e.project.trim()) return 'missing_project';
  if (typeof e.ts !== 'string' || isNaN(Date.parse(e.ts))) return 'invalid_ts';
  return null;
}

export async function POST(req: NextRequest) {
  ensureDirs();

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Accept single event or { events: [...] } batch
  const events: any[] = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
  if (events.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_events' }, { status: 400 });
  }

  const accepted: any[] = [];
  const rejected: any[] = [];
  const lines: string[] = [];

  for (const e of events) {
    // Accept either the new canonical schema or the legacy wire shape — the
    // engine (core/ingestBridge.js) normalizes both on drain.
    if (isCanonicalEvent(e)) {
      accepted.push(e);
      lines.push(JSON.stringify(e));
      continue;
    }
    const err = validateEvent(e);
    if (err) { rejected.push({ event: e, error: err }); continue; }
    accepted.push(e);
    lines.push(JSON.stringify(e));
  }

  if (lines.length > 0) {
    try {
      fs.appendFileSync(PENDING, lines.join('\n') + '\n');
      bumpTrigger();
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: 'write_failed', detail: err.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    accepted: accepted.length,
    rejected: rejected.length,
    errors: rejected.slice(0, 5),
  }, { status: rejected.length === events.length ? 400 : 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, status: 'ingest endpoint live', endpoint: 'POST /api/ingest' });
}
