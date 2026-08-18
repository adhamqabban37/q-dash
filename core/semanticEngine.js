'use strict';

const fs   = require('fs');
const path = require('path');

const SEMANTIC_LOG = path.join(__dirname, '..', 'output', 'semantic-events.json');

// ── Known project registry ────────────────────────────────────────────────────
// Each entry: { pattern, name, domain }
// Pattern matched against the normalized (forward-slash) file path.
// DO NOT add an entry without a concrete path signal — no hallucination.

const KNOWN_PROJECTS = [
  { pattern: /\/xxx5\.0\//i,              name: 'xenlix-ai',    domain: 'ai-platform'   },
  { pattern: /\/xenlix\//i,               name: 'xenlix-ai',    domain: 'ai-platform'   },
  { pattern: /xenlix/i,                   name: 'xenlix-ai',    domain: 'ai-platform'   },
  { pattern: /\/Agentic[- ]dash\//i,      name: 'q-dash',       domain: 'cognitive-os'  },
  { pattern: /\/agentic.?dash\//i,        name: 'q-dash',       domain: 'cognitive-os'  },
  { pattern: /\/focusflow/i,              name: 'focusflow',    domain: 'productivity'  },
  { pattern: /\/stilltime/i,              name: 'stilltime',    domain: 'wellness'      },
  { pattern: /\/truthbyte/i,             name: 'truthbyte',    domain: 'data'          },
  { pattern: /\/TruthBite/i,             name: 'truthbite',    domain: 'data-platform' },
  { pattern: /\/TruthBiteApp/i,          name: 'truthbite-app',domain: 'data-platform' },
  { pattern: /\/graphify/i,              name: 'graphify',     domain: 'dev-tool'      },
  { pattern: /\/TestApp/i,               name: 'testapp',      domain: 'test'          },
  { pattern: /\/next-js-saas/i,          name: 'saas-starter', domain: 'saas'          },
  { pattern: /\/saas-starter/i,          name: 'saas-starter', domain: 'saas'          },
  { pattern: /\/awesome-claude-skills/i, name: 'claude-skills',domain: 'skills-lib'    },
  { pattern: /\/obsidian-skills/i,       name: 'ob-skills',    domain: 'skills-lib'    },
  { pattern: /\/Ai-insurance/i,          name: 'agency-os',    domain: 'insurance'     },
];

// Desktop child-folder exclusions (not a project name)
const DESKTOP_NON_PROJECTS = new Set([
  'node_modules', 'System Volume Information', '$RECYCLE.BIN',
  'desktop.ini', 'AppData', '.', '..',
]);

// ── Impact signal sets ────────────────────────────────────────────────────────

const HIGH_IMPACT_NAMES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'index.js', 'index.ts', 'index.jsx', 'index.tsx',
  'app.js', 'app.ts', 'App.tsx', 'App.jsx',
  'server.js', 'server.ts', 'main.js', 'main.ts',
  'ARCHITECTURE.md', 'ARCHITECTURE', 'DESIGN.md',
  'README.md', 'README',
  '.env', '.env.production',
  'capacitor.config.ts', 'capacitor.config.json',
  'AndroidManifest.xml', 'build.gradle',
]);

const HIGH_IMPACT_PATTERNS = [
  /^index\.(js|ts|jsx|tsx|mjs)$/i,
  /^app\.(js|ts|jsx|tsx)$/i,
  /^server\.(js|ts)$/i,
  /^main\.(js|ts|jsx|tsx)$/i,
  /^router\.(js|ts)$/i,
  /ARCHITECTURE/i,
  /DESIGN\.md$/i,
];

const LOW_IMPACT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.ttf', '.woff', '.woff2', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.log', '.tmp', '.bak', '.swp', '.DS_Store',
]);

// ── Semantic signal groups ────────────────────────────────────────────────────

const SIG = {
  api:     ['api', 'endpoint', 'route', 'router', 'gateway', 'middleware', 'handler', 'webhook'],
  arch:    ['index', 'main', 'app', 'server', 'core', 'engine', 'bootstrap', 'entry', 'init'],
  design:  ['readme', 'architecture', 'design', 'spec', 'schema', 'diagram', 'plan', 'doc'],
  skill:   ['skill', 'plugin', 'hook', 'command', 'slash', 'tool', 'agent'],
  config:  ['config', 'settings', 'setup', 'env', 'dotenv', '.env', 'rc', 'options'],
  data:    ['model', 'schema', 'migration', 'seed', 'db', 'database', 'store', 'cache'],
  test:    ['test', 'spec', '__tests__', 'e2e', 'jest', 'vitest', 'cypress'],
  build:   ['build', 'dist', 'bundle', 'webpack', 'vite', 'rollup', 'compile'],
  auth:    ['auth', 'login', 'session', 'token', 'jwt', 'oauth', 'permission'],
};

function detectSignals(name, filePath) {
  const lower     = (name + '/' + filePath).toLowerCase().replace(/\\/g, '/');
  const found     = [];
  for (const [group, words] of Object.entries(SIG)) {
    if (words.some(w => lower.includes(w))) found.push(group);
  }
  return found;
}

// ── Project detection (evidence-only) ────────────────────────────────────────

function detectProject(filePath) {
  const norm = filePath.replace(/\\/g, '/');

  // 1. Known project patterns (most specific first)
  for (const { pattern, name, domain } of KNOWN_PROJECTS) {
    if (pattern.test(norm)) return { name, domain };
  }

  // 2. gstack root → skill system
  const gstackMatch = norm.match(/\/gstack\/([^/]+)/);
  if (gstackMatch) {
    const skillName = gstackMatch[1];
    return { name: `gstack/${skillName}`, domain: 'skills' };
  }

  // 3. brain root → knowledge
  if (norm.includes('/brain/')) {
    const brainSub = norm.match(/\/brain\/([^/]+)/);
    return { name: brainSub ? `brain/${brainSub[1]}` : 'brain', domain: 'knowledge' };
  }

  // 4. Desktop child-folder (non-system) → desktop project
  const desktopMatch = norm.match(/\/Desktop\/([^/]+)\//i);
  if (desktopMatch) {
    const folder = desktopMatch[1];
    if (!DESKTOP_NON_PROJECTS.has(folder) && !folder.startsWith('.')) {
      return { name: folder, domain: 'desktop-project' };
    }
  }

  return null;
}

// ── Impact scoring ────────────────────────────────────────────────────────────

function scoreImpact(eventType, name, ext, signals, isExistingNode) {
  const lower = name.toLowerCase();

  // HIGH: architecture-level file names
  if (HIGH_IMPACT_NAMES.has(name)) return 'high';
  if (HIGH_IMPACT_PATTERNS.some(re => re.test(name))) return 'high';

  // HIGH: signal groups that indicate structural scope
  if (signals.includes('arch') || signals.includes('api') && signals.includes('auth')) return 'high';

  // HIGH: deleting something that was in the graph (known capability removed)
  if (eventType === 'file_deleted' && isExistingNode) return 'high';

  // HIGH: brand-new file with architecture signals
  if (eventType === 'file_added' && !isExistingNode && signals.includes('arch')) return 'high';

  // LOW: binary/asset/log files
  if (LOW_IMPACT_EXTS.has(ext)) return 'low';

  // LOW: no signals at all and not a source file
  if (signals.length === 0 && !['.js','.ts','.jsx','.tsx','.py','.go','.rs','.md','.json'].includes(ext)) {
    return 'low';
  }

  return 'medium';
}

// ── Confidence scoring ────────────────────────────────────────────────────────

function scoreConfidence(origin, signals, project, isExistingNode, ext) {
  let score = 0.40;

  // Clear root origin
  if (origin === 'gstack' || origin === 'brain') score += 0.20;
  else if (origin === 'claude-skills' || origin === 'gemini-agents') score += 0.18;
  else if (origin === 'agents-skills') score += 0.15;
  else if (origin === 'Desktop')      score += 0.10;

  // Known project detected
  if (project) score += 0.15;

  // Matching signals
  if (signals.length > 0) score += Math.min(signals.length * 0.05, 0.15);

  // Known extension
  if (['.js','.ts','.jsx','.tsx','.md','.json','.py'].includes(ext)) score += 0.08;

  // Already in the graph (we know this file)
  if (isExistingNode) score += 0.10;

  return Math.min(Math.round(score * 100) / 100, 0.99);
}

// ── Intent derivation (natural language, evidence-based) ──────────────────────

function deriveIntent(eventType, category, signals, project, name) {
  const projectLabel = project ? ` in ${project.name}` : '';

  // Verb from event type
  const verbs = {
    file_added:   'introduced',
    file_changed: 'evolved',
    file_deleted: 'removed',
  };
  const verb = verbs[eventType] || 'modified';

  // Describe WHAT changed based on signals + category
  let subject;
  if (signals.includes('arch'))   subject = 'architecture-level file';
  else if (signals.includes('api'))    subject = 'API/service layer';
  else if (signals.includes('auth'))   subject = 'authentication module';
  else if (signals.includes('data'))   subject = 'data model or schema';
  else if (signals.includes('config')) subject = 'system configuration';
  else if (signals.includes('test'))   subject = 'test suite';
  else if (signals.includes('design')) subject = 'system documentation';
  else if (signals.includes('skill'))  subject = 'skill definition';
  else if (signals.includes('build'))  subject = 'build pipeline';
  else if (category === 'skill')       subject = 'skill capability';
  else if (category === 'project')     subject = 'project source file';
  else if (category === 'api')         subject = 'API resource';
  else if (category === 'note')        subject = 'knowledge entry';
  else if (category === 'config')      subject = 'configuration file';
  else                                  subject = `file (${name})`;

  // Compose
  const parts = [subject[0].toUpperCase() + subject.slice(1), verb];
  if (projectLabel) parts.push(projectLabel);
  return parts.join(' ');
}

// ── Graph cross-reference ─────────────────────────────────────────────────────

function crossReference(filePath) {
  const linkedNodes = [];
  let liveGraph;
  try { liveGraph = require('./liveGraph'); } catch { return linkedNodes; }

  // Self node
  const selfNode = liveGraph.getNode(filePath);
  if (selfNode) {
    linkedNodes.push({ id: selfNode.id, label: selfNode.label, type: selfNode.type, relation: 'self' });
  }

  // Walk up max 4 directories looking for a project package.json node
  let checkDir = path.dirname(filePath);
  for (let i = 0; i < 4; i++) {
    const pkgPath = path.join(checkDir, 'package.json');
    const pkgNode = liveGraph.getNode(pkgPath);
    if (pkgNode) {
      linkedNodes.push({ id: pkgNode.id, label: pkgNode.label, type: pkgNode.type, relation: 'parent-project' });
      break;
    }
    const parent = path.dirname(checkDir);
    if (parent === checkDir) break;
    checkDir = parent;
  }

  // Nearby skill node: look for SKILL.md in the same or parent directory
  const skillPaths = [
    path.join(path.dirname(filePath), 'SKILL.md'),
    path.join(path.dirname(path.dirname(filePath)), 'SKILL.md'),
  ];
  for (const sp of skillPaths) {
    const skillNode = liveGraph.getNode(sp);
    if (skillNode) {
      linkedNodes.push({ id: skillNode.id, label: skillNode.label, type: skillNode.type, relation: 'parent-skill' });
      break;
    }
  }

  return linkedNodes;
}

// ── Main analysis function ────────────────────────────────────────────────────

function analyze(rawEvent, classified) {
  const filePath = rawEvent.path;
  const name     = path.basename(filePath);
  const ext      = path.extname(name).toLowerCase();
  const origin   = rawEvent.origin || classified?.origin || 'unknown';
  const category = classified?.type || 'unknown';

  const signals      = detectSignals(name, filePath);
  const project      = detectProject(filePath);
  const linkedNodes  = crossReference(filePath);
  const isKnownNode  = linkedNodes.some(n => n.relation === 'self');

  const impact     = scoreImpact(rawEvent.type, name, ext, signals, isKnownNode);
  const confidence = scoreConfidence(origin, signals, project, isKnownNode, ext);
  const intent     = deriveIntent(rawEvent.type, category, signals, project, name);

  const enriched = {
    // Raw event fields pass-through
    type:      rawEvent.type,
    path:      filePath,
    origin,
    timestamp: rawEvent.timestamp,
    source:    rawEvent.source || 'watcher',

    // Semantic layer
    semantic: {
      intent,
      category,
      project:    project ? project.name  : null,
      domain:     project ? project.domain : origin,
      impact,
      confidence,
      signals,
      changeVerb: { file_added: 'created', file_changed: 'modified', file_deleted: 'deleted' }[rawEvent.type] || 'unknown',
    },

    // Graph cross-reference
    linkedNodes,

    enrichedAt: new Date().toISOString(),
  };

  return enriched;
}

// ── Log to semantic-events.json (NDJSON, instant append) ─────────────────────

function log(enrichedEvent) {
  try {
    fs.appendFileSync(SEMANTIC_LOG, JSON.stringify(enrichedEvent) + '\n');
  } catch {}
}

// ── Init: ensure log file exists ─────────────────────────────────────────────

function init() {
  try {
    const dir = path.dirname(SEMANTIC_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(SEMANTIC_LOG)) fs.writeFileSync(SEMANTIC_LOG, '');
    console.log('[semanticEngine] Initialized — output: output/semantic-events.json');
  } catch {}
}

// ── Read recent semantic events ───────────────────────────────────────────────

function tail(n = 10) {
  try {
    const content = fs.readFileSync(SEMANTIC_LOG, 'utf8');
    const lines   = content.trim().split('\n').filter(Boolean);
    return lines.slice(-n).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

// ── In-session stats ──────────────────────────────────────────────────────────

let _sessionStats = {
  analyzed:    0,
  highImpact:  0,
  lowImpact:   0,
  byCategory:  {},
  byProject:   {},
};

function trackStats(enriched) {
  _sessionStats.analyzed++;
  if (enriched.semantic.impact === 'high') _sessionStats.highImpact++;
  if (enriched.semantic.impact === 'low')  _sessionStats.lowImpact++;

  const cat = enriched.semantic.category || 'unknown';
  _sessionStats.byCategory[cat] = (_sessionStats.byCategory[cat] || 0) + 1;

  const proj = enriched.semantic.project || '_none';
  _sessionStats.byProject[proj] = (_sessionStats.byProject[proj] || 0) + 1;
}

function getStats() {
  return { ..._sessionStats };
}

// ── Combined analyze + log + track ───────────────────────────────────────────

function process(rawEvent, classified) {
  const enriched = analyze(rawEvent, classified);
  log(enriched);
  trackStats(enriched);
  return enriched;
}

module.exports = { init, analyze, log, process, tail, getStats };
