'use strict';

// graphifyBridge — discovers graphify knowledge graphs (graphify-out/graph.json)
// across the machine's project roots and summarizes each one for the cockpit.
// Output: output/code-graphs.json (regenerated — never hand-edit).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SEARCH_ROOTS = [
  'C:\\Users\\Tyson\\Desktop',
  'C:\\Users\\Tyson\\brain',
  'C:\\Users\\Tyson\\gstack',
];

const MAX_DEPTH = 3;
const TOP_GOD_NODES = 10;

const IGNORE_DIRS = new Set([
  'node_modules',
  '__pycache__',
  'dist',
  'build',
  'out',
  'output',
  'AppData',
  '$Recycle.Bin',
  'System Volume Information',
]);

function shouldIgnore(name) {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

// Walk a root looking for <project>/graphify-out/graph.json, depth-limited.
function findGraphProjects(dirPath, depth = 0, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldIgnore(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.name === 'graphify-out') {
      if (fs.existsSync(path.join(fullPath, 'graph.json'))) found.push(dirPath);
      continue; // never descend into graph output itself
    }
    if (depth < MAX_DEPTH) findGraphProjects(fullPath, depth + 1, found);
  }
  return found;
}

function gitShortHead(projectDir) {
  try {
    return execSync('git rev-parse --short=8 HEAD', {
      cwd: projectDir,
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim() || null;
  } catch {
    return null;
  }
}

function summarizeGraph(projectDir) {
  const graphPath = path.join(projectDir, 'graphify-out', 'graph.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  } catch (err) {
    console.warn(`[graphifyBridge] Skipping unreadable graph: ${graphPath} (${err.message})`);
    return null;
  }

  const nodes = raw.nodes || [];
  const links = raw.links || raw.edges || [];

  // Degree count for god nodes
  const degree = new Map();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const godNodes = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GOD_NODES)
    .map(([id, deg]) => ({
      label: nodeById.get(id)?.label || id,
      degree: deg,
      file: nodeById.get(id)?.source_file || null,
    }));

  const communities = new Set(
    nodes.map(n => n.community).filter(c => c !== undefined && c !== null)
  ).size;
  const inferredEdges = links.filter(l => l.confidence === 'INFERRED').length;

  // Freshness: compare the commit the graph was built from to the repo HEAD
  const builtAtCommit = (raw.built_at_commit || '').slice(0, 8) || null;
  const currentCommit = gitShortHead(projectDir);
  let stale = null;
  if (builtAtCommit && currentCommit) {
    stale = !(
      currentCommit.startsWith(builtAtCommit) ||
      builtAtCommit.startsWith(currentCommit)
    );
  }

  let updatedAt = null;
  try {
    updatedAt = fs.statSync(graphPath).mtime.toISOString();
  } catch {}

  return {
    project: path.basename(projectDir),
    path: projectDir,
    nodes: nodes.length,
    edges: links.length,
    communities,
    inferredEdges,
    godNodes,
    builtAtCommit,
    currentCommit,
    stale,
    updatedAt,
  };
}

function collectCodeGraphs() {
  console.log('[graphifyBridge] Discovering graphify code graphs...');
  const projectDirs = new Set();
  for (const root of SEARCH_ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const dir of findGraphProjects(root)) projectDirs.add(dir);
  }

  const graphs = [];
  for (const dir of projectDirs) {
    const summary = summarizeGraph(dir);
    if (summary) graphs.push(summary);
  }
  graphs.sort((a, b) => b.nodes - a.nodes);

  console.log(`[graphifyBridge] ${graphs.length} project graph(s) found`);
  for (const g of graphs) {
    const freshness = g.stale === null ? 'freshness unknown' : g.stale ? 'STALE' : 'fresh';
    console.log(`[graphifyBridge]   - ${g.project}: ${g.nodes} nodes, ${g.edges} edges (${freshness})`);
  }

  return {
    generated: new Date().toISOString(),
    total: graphs.length,
    graphs,
  };
}

module.exports = { collectCodeGraphs };
