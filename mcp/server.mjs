#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// QDASH MCP SERVER — stdio MCP server exposing Q DASH's agent-observability
// data (output/*.json + output/ledger/*.md) to any MCP client.
//
// Local-only, READ-ONLY. Never writes anything except its own stderr logging.
// Works even when the Q DASH engine (run.js) is down — it just serves the
// last snapshots written to output/, or a graceful "no data yet" message.
//
// IMPORTANT: never console.log to stdout — that corrupts the stdio JSON-RPC
// protocol framing. Use console.error for all diagnostic logging.
// ════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const OUTPUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'output');
const LEDGER_DIR = path.join(OUTPUT, 'ledger');

// ── Small helpers ────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Reads an NDJSON file (one JSON object per line) synchronously and returns
// the last `count` successfully-parsed lines. Malformed lines are skipped.
function readNdjsonTail(filePath, count) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const tail = lines.slice(-count);
    const out = [];
    for (const line of tail) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // skip malformed/partial line
      }
    }
    return out;
  } catch (err) {
    return [];
  }
}

function slugify(project) {
  if (typeof project !== 'string' || !project.trim()) return 'unknown';
  const s = project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'unknown';
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

function noDataResult(what) {
  return textResult(`No data yet for ${what} — is the Q DASH engine running? (node run.js)`);
}

function fmtRow(name, bucket) {
  const events = bucket && typeof bucket.events === 'number' ? bucket.events : 0;
  const tokensIn = bucket && bucket.tokensIn != null ? bucket.tokensIn : '—';
  const tokensOut = bucket && bucket.tokensOut != null ? bucket.tokensOut : '—';
  const costUsd = bucket && typeof bucket.costUsd === 'number' ? bucket.costUsd.toFixed(4) : '—';
  const lastActive = (bucket && bucket.lastActive) || '—';
  return `| ${name} | ${events} | ${tokensIn} | ${tokensOut} | ${costUsd} | ${lastActive} |`;
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'qdash', version: '1.0.0' });

// 1. qdash_context ─────────────────────────────────────────────────────────
server.registerTool(
  'qdash_context',
  {
    title: 'Q DASH project context (ledger)',
    description:
      'Call at the start of a session to load what previous agent sessions did in this project. ' +
      'Reads the project\'s Q DASH context ledger (output/ledger/<slug>.md) and returns the current ' +
      'cumulative state plus the 10 most recently logged session entries (what changed, tokens/cost, ' +
      'commits detected). If no ledger exists for the given project name, returns the list of ' +
      'available ledger project names so you can retry with the correct one.',
    inputSchema: {
      project: z.string().describe('Project name to look up, e.g. "q-dash-core-engine" or "xxx5.0". Will be slugified.'),
    },
  },
  async ({ project }) => {
    try {
      if (!fs.existsSync(LEDGER_DIR)) {
        return textResult(
          'No ledgers yet — the ledger writer has not produced any project ledgers yet. Is the Q DASH engine running?'
        );
      }
      const slugName = slugify(project);
      const mdPath = path.join(LEDGER_DIR, `${slugName}.md`);
      if (!fs.existsSync(mdPath)) {
        let available = [];
        try {
          available = fs
            .readdirSync(LEDGER_DIR)
            .filter((f) => f.endsWith('.md'))
            .map((f) => f.replace(/\.md$/, ''));
        } catch {
          available = [];
        }
        return textResult(
          `No ledger found for project "${project}" (slug "${slugName}").\n` +
            (available.length
              ? `Available ledgers: ${available.join(', ')}`
              : 'No ledgers exist yet — is the Q DASH engine running?')
        );
      }

      const content = fs.readFileSync(mdPath, 'utf8');
      const currentIdx = content.indexOf('## Current state');
      const sessionsIdx = content.indexOf('## Sessions');

      let currentState = '';
      if (currentIdx !== -1) {
        const end = sessionsIdx !== -1 ? sessionsIdx : content.length;
        currentState = content.slice(currentIdx, end).trim();
      }

      let sessionsText = '';
      if (sessionsIdx !== -1) {
        const block = content.slice(sessionsIdx + '## Sessions'.length);
        const entries = block
          .split(/\n(?=### )/)
          .map((s) => s.trim())
          .filter((s) => s.startsWith('### '));
        sessionsText = '## Sessions\n\n' + entries.slice(0, 10).join('\n\n');
      }

      let out = [currentState, sessionsText].filter(Boolean).join('\n\n').trim();
      if (!out) out = content.trim();
      if (out.length > 6000) out = out.slice(0, 6000) + '\n\n…(truncated)';
      return textResult(out);
    } catch (err) {
      return errorResult(`qdash_context failed: ${err.message}`);
    }
  }
);

// 2. qdash_search ────────────────────────────────────────────────────────────
server.registerTool(
  'qdash_search',
  {
    title: 'Q DASH file index search',
    description:
      'Search the Q DASH file index — every file scanned across brain, gstack, skills, and Desktop ' +
      'projects. Call this to find where something lives on disk, check whether a skill/file/project ' +
      'exists, or discover related files before reading them. Case-insensitive; space-separated words ' +
      'in the query are ANDed as tokens against name, path, tags, and type.',
    inputSchema: {
      query: z.string().describe('Search text — matched against file name, path, tags, and type.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results to return (default 20, max 50).'),
    },
  },
  async ({ query, limit }) => {
    try {
      const idx = readJsonFile(path.join(OUTPUT, 'index.json'));
      if (!idx || !Array.isArray(idx.files)) return noDataResult('the file index');

      const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (!tokens.length) return textResult('Empty query — provide at least one search term.');

      const max = Math.min(Math.max(limit || 20, 1), 50);
      const matches = [];
      for (const f of idx.files) {
        const hay = [f.name, f.path, f.type, f.category, ...(Array.isArray(f.tags) ? f.tags : [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (tokens.every((t) => hay.includes(t))) matches.push(f);
      }

      if (!matches.length) {
        return textResult(`No matches for "${query}" (searched ${idx.files.length} indexed files).`);
      }

      const shown = matches.slice(0, max);
      const lines = shown.map((f) => `${f.path} | ${f.type || '?'}/${f.category || '?'} | ${f.modified || '?'}`);
      const header = `${matches.length} match(es) for "${query}" (showing ${shown.length}):\n`;
      return textResult(header + lines.join('\n'));
    } catch (err) {
      return errorResult(`qdash_search failed: ${err.message}`);
    }
  }
);

// 3. qdash_spend ─────────────────────────────────────────────────────────────
server.registerTool(
  'qdash_spend',
  {
    title: 'Q DASH spend / token usage report',
    description:
      'Call to check token usage and estimated cost across agents, projects, or days. Use period ' +
      '"today" or "week" for recent activity, or "all" (default) for lifetime totals with a ' +
      'breakdown table by agent, project, or day.',
    inputSchema: {
      period: z.enum(['today', 'week', 'all']).optional().describe('Time window. Default "all".'),
      groupBy: z.enum(['agent', 'project', 'day']).optional().describe('Breakdown dimension. Default "agent".'),
    },
  },
  async ({ period, groupBy }) => {
    try {
      const spend = readJsonFile(path.join(OUTPUT, 'spend.json'));
      if (!spend) return noDataResult('spend/usage');

      const p = period || 'all';
      const g = groupBy || 'agent';
      const tz = spend.timezone || 'unknown';
      const header = `| name | events | tokensIn | tokensOut | costUsd | lastActive |\n|---|---|---|---|---|---|`;
      let rows = [];
      let title;

      if (p === 'today') {
        const days = Object.keys(spend.byDay || {}).sort();
        const latest = days[days.length - 1];
        if (!latest) return textResult(`No spend data recorded yet today (timezone ${tz}).`);
        const bucket = spend.byDay[latest];
        title = `Spend — today (${latest}, tz ${tz})`;
        if (g === 'agent' && bucket.byAgent) {
          rows = Object.entries(bucket.byAgent).map(([name, b]) => fmtRow(name, b));
        } else {
          rows = [fmtRow(latest, bucket)];
        }
      } else if (p === 'week') {
        const weeks = Object.keys(spend.byWeek || {}).sort();
        const latest = weeks[weeks.length - 1];
        if (!latest) return textResult(`No spend data recorded yet this week (timezone ${tz}).`);
        const bucket = spend.byWeek[latest];
        title = `Spend — this week (${latest}, tz ${tz})`;
        rows = [fmtRow(latest, bucket)];
      } else {
        title = `Spend — all time (tz ${tz})`;
        const source = g === 'agent' ? spend.byAgent : g === 'project' ? spend.byProject : spend.byDay;
        rows = Object.entries(source || {}).map(([name, b]) => fmtRow(name, b));
        rows.unshift(fmtRow('TOTAL', spend.totals));
      }

      return textResult(`${title}\n\n${header}\n${rows.join('\n')}`);
    } catch (err) {
      return errorResult(`qdash_spend failed: ${err.message}`);
    }
  }
);

// 4. qdash_active ────────────────────────────────────────────────────────────
server.registerTool(
  'qdash_active',
  {
    title: 'Q DASH live activity',
    description:
      'Call to see which agent sessions are live right now (in-progress, not yet closed) and the ' +
      'most recent raw events across all agents and humans. Use to check whether another agent or ' +
      'human is currently working, on what project, and what they just did.',
    inputSchema: {},
  },
  async () => {
    try {
      const sessions = readJsonFile(path.join(OUTPUT, 'agent-sessions.json'));
      const liveList = sessions && Array.isArray(sessions.live) ? sessions.live : null;
      if (liveList === null) return noDataResult('agent sessions');

      let out = '';
      if (!liveList.length) {
        out += 'No agents currently active.\n\n';
      } else {
        out += `${liveList.length} live session(s):\n\n`;
        out += liveList
          .map((s) => {
            const cost = typeof s.estimatedCostUsd === 'number' ? `$${s.estimatedCostUsd.toFixed(4)}` : '—';
            const tokens = `${s.tokensIn ?? '—'}/${s.tokensOut ?? '—'}`;
            const filesCount = Array.isArray(s.filesChanged) ? s.filesChanged.length : 0;
            return `- ${s.agentId} (${s.agentType}) on ${s.project}: cost ${cost}, tokens ${tokens}, duration ${s.durationMs}ms, ${filesCount} files changed, started ${s.startTime}`;
          })
          .join('\n');
      }

      const events = readNdjsonTail(path.join(OUTPUT, 'agent-events.log.json'), 10);
      out += '\n\nLast 10 events:\n';
      if (!events.length) {
        out += '(no events log yet)';
      } else {
        out += events
          .map((e) => `- ${e.timestamp} | ${e.agentId} | ${e.eventType} | ${(e.metadata && e.metadata.kind) || '—'} | ${e.project}`)
          .join('\n');
      }

      return textResult(out.trim());
    } catch (err) {
      return errorResult(`qdash_active failed: ${err.message}`);
    }
  }
);

// ── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[qdash-mcp] server started (OUTPUT=${OUTPUT})`);
}

main().catch((err) => {
  console.error('[qdash-mcp] fatal error:', err);
  process.exit(1);
});
