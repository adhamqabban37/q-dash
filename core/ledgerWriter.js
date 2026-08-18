'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH LEDGER WRITER — AgentSession closures → output/ledger/<project-slug>.md
// Appends a compact "what happened here, where did it leave off" entry every
// time agentSessionBuilder closes a session, so a future agent session can
// read the ledger instead of re-deriving context from scratch.
//
// One markdown file per project (slug'd), newest sessions first, capped at
// the most recent 50 entries. A tiny sidecar JSON (<slug>.state.json) tracks
// cumulative totals + recent-file focus across ALL sessions ever logged for
// that project (not just the 50 kept in the .md), since re-deriving those
// sums from the capped markdown would be fragile.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LEDGER_DIR = path.join(__dirname, '..', 'output', 'ledger');

// ── Small helpers ────────────────────────────────────────────────────────────

function ensureLedgerDir() {
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

function slug(project) {
  if (typeof project !== 'string' || !project.trim()) return 'unknown';
  const s = project.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'unknown';
}

function ledgerPath(slugName) {
  return path.join(LEDGER_DIR, `${slugName}.md`);
}

function stateFilePath(slugName) {
  return path.join(LEDGER_DIR, `${slugName}.state.json`);
}

function basename(p) {
  if (typeof p !== 'string' || !p) return '';
  return p.replace(/\\/g, '/').split('/').pop();
}

function humanizeDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

// ── Git commit harvesting ────────────────────────────────────────────────────
// The "decisions inferred" signal: what commits landed in the same directory
// as the session's files, during the session's time window. Best-effort only
// — any failure (no git, no repo, timeout) folds into 'none detected'.

function harvestCommits(rollup) {
  const files = Array.isArray(rollup.filesChanged) ? rollup.filesChanged : [];
  if (!files.length) return 'none detected';
  const first = files[0];
  if (typeof first !== 'string' || !first) return 'none detected';

  const dir = path.dirname(first);
  try {
    const untilMs = new Date(rollup.endTime).getTime() + 2 * 60 * 1000;
    if (isNaN(untilMs)) return 'none detected';
    const until = new Date(untilMs).toISOString();
    // Path-scoped to the session's directory — in a monorepo (or a repo
    // rooted at the home dir) an unscoped log would list unrelated commits.
    const out = execSync(
      `git -C "${dir}" log --since="${rollup.startTime}" --until="${until}" --pretty=format:"%h %s" --no-merges -n 10 -- "${dir}"`,
      { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const lines = String(out).split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return 'none detected';
    return lines.map((l) => `  - ${l}`).join('\n');
  } catch (err) {
    return 'none detected';
  }
}

// ── Sidecar state (cumulative totals + recent-file focus) ──────────────────

function loadState(slugName) {
  const p = stateFilePath(slugName);
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (err) {
    console.error('[ledgerWriter] state read failed:', err.message);
  }
  return { sessions: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, recentSessionFiles: [] };
}

function saveState(slugName, state) {
  try {
    ensureLedgerDir();
    fs.writeFileSync(stateFilePath(slugName), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[ledgerWriter] state write failed:', err.message);
  }
}

function computeRecentFocus(recentSessionFiles) {
  if (!Array.isArray(recentSessionFiles) || !recentSessionFiles.length) return '—';
  const seen = new Set();
  for (const sessionFiles of recentSessionFiles) {
    if (!Array.isArray(sessionFiles)) continue;
    for (const f of sessionFiles) {
      const b = basename(f);
      if (b) seen.add(b);
      if (seen.size >= 8) break;
    }
    if (seen.size >= 8) break;
  }
  return seen.size ? [...seen].join(', ') : '—';
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function buildEntry(rollup) {
  const dur = humanizeDuration(rollup.durationMs);
  const tokensIn = rollup.tokensIn != null ? rollup.tokensIn : '—';
  const tokensOut = rollup.tokensOut != null ? rollup.tokensOut : '—';
  const estSuffix = rollup.tokensEstimated ? ' (~est)' : '';
  const cost = typeof rollup.estimatedCostUsd === 'number' ? rollup.estimatedCostUsd : '—';
  const models = Array.isArray(rollup.models) && rollup.models.length ? rollup.models.join(', ') : '—';

  const files = Array.isArray(rollup.filesChanged) ? rollup.filesChanged : [];
  const basenames = files.slice(0, 12).map(basename);
  const filesStr = basenames.join(', ') + (files.length > 12 ? '…' : '');

  const commits = harvestCommits(rollup);
  const commitsLine = commits === 'none detected'
    ? '- commits during session: none detected'
    : `- commits during session:\n${commits}`;

  return [
    `### ${rollup.endTime} — ${rollup.agentType} session (${dur})`,
    `- session: ${rollup.sessionId} | project: ${rollup.project} | events: ${rollup.eventCount} | errors: ${rollup.errorCount}`,
    `- tokens: ${tokensIn}/${tokensOut}${estSuffix} | cost: $${cost} | models: ${models}`,
    `- files changed (${files.length}): ${filesStr}`,
    commitsLine,
  ].join('\n');
}

function buildCurrentState(rollup, entryCount, state) {
  const cost = typeof rollup.estimatedCostUsd === 'number' ? rollup.estimatedCostUsd : 0;
  const cumCost = typeof state.costUsd === 'number' ? round6(state.costUsd) : 0;
  const recentFocus = computeRecentFocus(state.recentSessionFiles);
  const lastErrors = rollup.errorCount ? String(rollup.errorCount) : 'none';

  return [
    `- last session: ${rollup.endTime} by ${rollup.agentType} — ${rollup.eventCount} events, cost $${cost}`,
    `- sessions logged: ${entryCount}`,
    `- cumulative (logged sessions): tokens ${state.tokensIn || 0}/${state.tokensOut || 0}, cost $${cumCost}`,
    `- recent focus: ${recentFocus}`,
    `- last errors: ${lastErrors}`,
  ].join('\n');
}

function buildHeader(project) {
  return `# ${project} — context ledger\n_maintained by Q DASH; newest sessions first. Do not hand-edit — regenerated sections._\n`;
}

function parseExistingEntries(mdPath) {
  if (!fs.existsSync(mdPath)) return [];
  try {
    const content = fs.readFileSync(mdPath, 'utf8');
    const idx = content.indexOf('## Sessions');
    if (idx === -1) return [];
    const block = content.slice(idx + '## Sessions'.length);
    return block
      .split(/\n(?=### )/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('### '));
  } catch (err) {
    console.error('[ledgerWriter] parse failed:', err.message);
    return [];
  }
}

// ── Write path ───────────────────────────────────────────────────────────────

function writeLedger(project, rollup) {
  ensureLedgerDir();
  const slugName = slug(project);
  const mdPath = ledgerPath(slugName);

  const existingEntries = parseExistingEntries(mdPath);
  const newEntry = buildEntry(rollup);
  let entries = [newEntry, ...existingEntries];
  if (entries.length > 50) entries = entries.slice(0, 50);

  const state = loadState(slugName);
  state.sessions = (state.sessions || 0) + 1;
  state.tokensIn = (state.tokensIn || 0) + (typeof rollup.tokensIn === 'number' ? rollup.tokensIn : 0);
  state.tokensOut = (state.tokensOut || 0) + (typeof rollup.tokensOut === 'number' ? rollup.tokensOut : 0);
  state.costUsd = (state.costUsd || 0) + (typeof rollup.estimatedCostUsd === 'number' ? rollup.estimatedCostUsd : 0);
  const recentSessionFiles = Array.isArray(state.recentSessionFiles) ? state.recentSessionFiles : [];
  recentSessionFiles.unshift(Array.isArray(rollup.filesChanged) ? rollup.filesChanged : []);
  state.recentSessionFiles = recentSessionFiles.slice(0, 3);
  saveState(slugName, state);

  const currentState = buildCurrentState(rollup, entries.length, state);
  const out = `${buildHeader(project)}\n## Current state\n${currentState}\n\n## Sessions\n\n${entries.join('\n\n')}\n`;

  try {
    fs.writeFileSync(mdPath, out);
  } catch (err) {
    console.error('[ledgerWriter] write failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function onSessionClosed(rollup) {
  try {
    if (!rollup || !rollup.project) return; // no project → skip (per spec exception)
    if (!rollup.eventCount || rollup.eventCount < 1) return;
    writeLedger(rollup.project, rollup);
  } catch (err) {
    console.error('[ledgerWriter] onSessionClosed failed:', err.message);
  }
}

function init() {
  ensureLedgerDir();
  console.log('[ledgerWriter] ready');
}

module.exports = { init, onSessionClosed, LEDGER_DIR };
