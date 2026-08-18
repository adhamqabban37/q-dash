'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH SKILL TRACKER — Registry, invocation tracking, dormant detection
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const SKILL_ROOTS = [
  path.join(process.env.USERPROFILE || '', '.claude', 'skills'),
  path.join(process.env.USERPROFILE || '', 'brain', 'agents', 'skills'),
];

const REGISTRY_PATH = path.join(__dirname, '..', 'output', 'skill-registry.json');
const STATS_PATH    = path.join(__dirname, '..', 'output', 'skill-stats.json');

let _registry = new Map();   // skillName → { name, description, path, source }
let _stats = new Map();      // skillName → { invocations: [{ts, project, source}], lastUsed, projects: Set }
let _saveTimer = null;
let _insightEngine = null;

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function resolveJunctions(root) {
  // Follow NTFS junctions / symlinks
  const out = new Set();
  try {
    if (!fs.existsSync(root)) return out;
    const real = fs.realpathSync(root);
    out.add(real);
    // Also walk one level deep to pick up skill subdirs that might be junctioned
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      try {
        const full = path.join(root, entry.name);
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          out.add(fs.realpathSync(full));
        }
      } catch {}
    }
  } catch {}
  return out;
}

function parseFrontmatter(content) {
  const fm = {};
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return fm;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith('[') && v.endsWith(']')) {
      try { v = JSON.parse(v.replace(/'/g, '"')); } catch { v = v.slice(1, -1).split(',').map(s => s.trim()); }
    }
    fm[kv[1]] = v;
  }
  return fm;
}

function scanRegistry() {
  const reg = new Map();
  for (const root of SKILL_ROOTS) {
    const resolved = resolveJunctions(root);
    for (const realRoot of resolved) {
      try {
        if (!fs.existsSync(realRoot)) continue;
        for (const entry of fs.readdirSync(realRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const skillDir = path.join(realRoot, entry.name);
          const skillFile = path.join(skillDir, 'SKILL.md');
          if (!fs.existsSync(skillFile)) continue;
          try {
            const content = fs.readFileSync(skillFile, 'utf8');
            const fm = parseFrontmatter(content);
            const name = fm.name || entry.name;
            const description = fm.description || '';
            reg.set(name, {
              name,
              description: String(description).slice(0, 200),
              path: skillFile,
              source: root.includes('.claude') ? 'claude' : (root.includes('brain') ? 'brain' : 'unknown'),
              lastSeen: new Date().toISOString(),
            });
          } catch {}
        }
      } catch {}
    }
  }
  return reg;
}

function refreshRegistry() {
  _registry = scanRegistry();
  try {
    ensureDir(path.dirname(REGISTRY_PATH));
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify({
      generated: new Date().toISOString(),
      count: _registry.size,
      skills: [..._registry.values()],
    }, null, 2));
  } catch {}
  detectDormant();
}

function recordInvocation(skillName, project, source) {
  if (!skillName) return;
  if (!_stats.has(skillName)) {
    _stats.set(skillName, { invocations: [], lastUsed: null, projects: new Set() });
  }
  const s = _stats.get(skillName);
  s.invocations.push({ ts: new Date().toISOString(), project, source });
  if (s.invocations.length > 500) s.invocations = s.invocations.slice(-500);
  s.lastUsed = s.invocations[s.invocations.length - 1].ts;
  s.projects.add(project);
  scheduleSave();
}

function detectDormant() {
  if (!_insightEngine) return;
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const dormant = [];
  for (const [name, entry] of _registry) {
    const stat = _stats.get(name);
    const invocations = stat?.invocations?.length || 0;
    const lastUsed = stat?.lastUsed;
    const lastSeenTs = new Date(entry.lastSeen).getTime();
    const isOld = (now - lastSeenTs) > SEVEN_DAYS;
    if (invocations === 0 && isOld) {
      dormant.push({ name, daysSinceLastSeen: Math.floor((now - lastSeenTs) / (24 * 60 * 60 * 1000)) });
    }
  }
  if (dormant.length > 0) {
    // Emit insight
    const insight = {
      id: `dormant_skills_${Date.now()}`,
      type: 'anomaly',
      category: 'skill',
      message: `${dormant.length} dormant skill${dormant.length === 1 ? '' : 's'}: ${dormant.slice(0, 5).map(d => d.name).join(', ')}`,
      confidence: 0.85,
      supportingEvents: dormant.slice(0, 5).map(d => d.name),
      timestamp: new Date().toISOString(),
      meta: { dormant, kind: 'dormant_skills' },
    };
    if (typeof _insightEngine.recordInsight === 'function') {
      _insightEngine.recordInsight(insight);
    }
  }
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flush, 1500);
}

function flush() {
  try {
    ensureDir(path.dirname(STATS_PATH));
    const out = {};
    for (const [name, s] of _stats) {
      out[name] = {
        invocationCount: s.invocations.length,
        lastUsed: s.lastUsed,
        projects: [...s.projects],
        recent: s.invocations.slice(-20),
      };
    }
    fs.writeFileSync(STATS_PATH, JSON.stringify({
      generated: new Date().toISOString(),
      skills: out,
    }, null, 2));
  } catch (e) {
    console.error('[skillTracker] flush failed:', e.message);
  }
}

function getRegistry() { return [..._registry.values()]; }
function getStats()    { return [..._stats.entries()].map(([name, s]) => ({ name, ...s, projects: [...s.projects] })); }

function init({ insightEngine }) {
  _insightEngine = insightEngine;
  // Load previous stats
  if (fs.existsSync(STATS_PATH)) {
    try {
      const d = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
      for (const [name, s] of Object.entries(d.skills || {})) {
        _stats.set(name, {
          invocations: s.recent || [],
          lastUsed: s.lastUsed,
          projects: new Set(s.projects || []),
        });
      }
    } catch {}
  }
  refreshRegistry();
  // Re-scan registry every 5 minutes
  setInterval(refreshRegistry, 5 * 60 * 1000);
  console.log(`[skillTracker] loaded ${_registry.size} skills from registry`);
}

module.exports = { init, refreshRegistry, recordInvocation, getRegistry, getStats, flush };
