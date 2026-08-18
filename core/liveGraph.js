'use strict';

const fs   = require('fs');
const path = require('path');

const GRAPH_PATH = path.join(__dirname, '..', 'output', 'graph.json');

// In-memory structures
let nodes     = new Map();   // id → node object
let edges     = new Map();   // `${src}|${tgt}|${rel}` → edge object
let saveTimer = null;

// ── ID utilities ─────────────────────────────────────────────────────────────

function makeId(filePath) {
  return filePath.replace(/\\/g, '/').replace(/[^a-zA-Z0-9/._-]/g, '_');
}

function edgeKey(source, target, relation) {
  return `${source}|${target}|${relation}`;
}

// ── Load ────────────────────────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(GRAPH_PATH)) {
    console.warn('[liveGraph] graph.json not found — starting empty graph');
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
    nodes = new Map((data.nodes || []).map(n => [n.id, n]));
    edges = new Map((data.edges || []).map(e => [edgeKey(e.source, e.target, e.relation), e]));
    console.log(`[liveGraph] Loaded ${nodes.size} nodes, ${edges.size} edges`);
  } catch (err) {
    console.error('[liveGraph] Failed to load graph.json:', err.message);
  }
}

// ── Save (debounced 500 ms) ──────────────────────────────────────────────────

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

function flush() {
  try {
    fs.writeFileSync(GRAPH_PATH, JSON.stringify({
      generated: new Date().toISOString(),
      nodes: [...nodes.values()],
      edges: [...edges.values()],
    }, null, 2));
  } catch (err) {
    console.error('[liveGraph] Save failed:', err.message);
  }
}

// Force-save without debounce (e.g. on shutdown)
function save() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  flush();
}

// ── Node operations ──────────────────────────────────────────────────────────

function addNode(classified) {
  const id = makeId(classified.path);
  nodes.set(id, {
    id,
    label:       classified.name,
    type:        classified.type,
    category:    classified.category,
    subcategory: classified.subcategory,
    origin:      classified.origin,
    path:        classified.path,
    ext:         classified.ext,
    size:        classified.size,
    modified:    classified.modified,
    tags:        classified.tags      || [],
    wikiLinks:   classified.wikiLinks || [],
  });

  // Derive incremental edges for the new node
  _addFolderSiblingEdges(classified.path);
  _addWikiLinkEdges(classified);

  scheduleSave();
  return id;
}

function updateNode(classified) {
  const id = makeId(classified.path);
  const existing = nodes.get(id);
  if (!existing) return addNode(classified);

  nodes.set(id, {
    ...existing,
    size:        classified.size,
    modified:    classified.modified,
    type:        classified.type,
    category:    classified.category,
    subcategory: classified.subcategory,
    tags:        classified.tags      || existing.tags,
    wikiLinks:   classified.wikiLinks || existing.wikiLinks,
  });

  // Re-evaluate wiki-link edges (links may have changed)
  _removeWikiLinkEdges(id);
  _addWikiLinkEdges(classified);

  scheduleSave();
}

function removeNode(filePath) {
  const id = makeId(filePath);
  nodes.delete(id);

  // Prune every edge that touches this node
  for (const k of [...edges.keys()]) {
    const [src, tgt] = k.split('|');
    if (src === id || tgt === id) edges.delete(k);
  }

  scheduleSave();
}

// ── Edge operations ──────────────────────────────────────────────────────────

function addEdge(source, target, relation) {
  if (!source || !target || source === target) return;
  const k = edgeKey(source, target, relation);
  if (!edges.has(k)) {
    edges.set(k, { source, target, relation });
    scheduleSave();
  }
}

function removeEdge(source, target, relation) {
  const k = edgeKey(source, target, relation);
  if (edges.has(k)) {
    edges.delete(k);
    scheduleSave();
  }
}

// ── Internal edge helpers ────────────────────────────────────────────────────

function _addFolderSiblingEdges(filePath) {
  const dir = path.dirname(filePath).replace(/\\/g, '/');
  const newId = makeId(filePath);

  for (const [, node] of nodes) {
    if (node.id === newId) continue;
    // Synthetic nodes (folders, tags, categories) have no path — skip them.
    if (typeof node.path !== 'string' || !node.path) continue;
    const nodeDir = path.dirname(node.path).replace(/\\/g, '/');
    if (nodeDir === dir) {
      addEdge(newId, node.id, 'folder-sibling');
    }
  }
}

function _addWikiLinkEdges(classified) {
  if (!classified.wikiLinks || classified.wikiLinks.length === 0) return;
  const srcId = makeId(classified.path);

  for (const link of classified.wikiLinks) {
    const lower = link.toLowerCase();
    // Find a node whose label or path fragment matches
    for (const [, node] of nodes) {
      if (node.id === srcId) continue;
      if (typeof node.label !== 'string') continue;
      const nodeName = node.label.toLowerCase().replace(/\.[^.]+$/, '');
      if (nodeName === lower || nodeName.includes(lower)) {
        addEdge(srcId, node.id, 'wiki-link');
        break;
      }
    }
  }
}

function _removeWikiLinkEdges(nodeId) {
  for (const k of [...edges.keys()]) {
    if (k.startsWith(nodeId + '|') && k.endsWith('|wiki-link')) {
      edges.delete(k);
    }
  }
}

// ── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
  return { nodes: nodes.size, edges: edges.size };
}

function hasNode(filePath) {
  return nodes.has(makeId(filePath));
}

// Return the node object for a file path, or null
function getNode(filePath) {
  return nodes.get(makeId(filePath)) || null;
}

// Return all edges where this node is source or target (max 20 for perf)
function getEdgesFor(nodeId, limit = 20) {
  const result = [];
  for (const [, edge] of edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      result.push(edge);
      if (result.length >= limit) break;
    }
  }
  return result;
}

// Return node objects for a set of node IDs
function getNodesByIds(ids) {
  return ids.map(id => nodes.get(id)).filter(Boolean);
}

module.exports = {
  load, save,
  addNode, updateNode, removeNode,
  addEdge, removeEdge,
  getStats, hasNode, makeId,
  getNode, getEdgesFor, getNodesByIds,
};
