'use strict';

const fs   = require('fs');
const path = require('path');
const { classifyOne } = require('./classifier');

const INDEX_PATH = path.join(__dirname, '..', 'output', 'index.json');

// In-memory map: absolute path → entry object
let fileMap  = new Map();
let saveTimer = null;

// ── Load ────────────────────────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.warn('[indexUpdater] index.json not found — starting empty');
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    fileMap = new Map((data.files || []).map(f => [f.path, f]));
    console.log(`[indexUpdater] Loaded ${fileMap.size} entries from index.json`);
  } catch (err) {
    console.error('[indexUpdater] Failed to load index.json:', err.message);
  }
}

// ── Save (debounced 500 ms) ──────────────────────────────────────────────────

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

function flush() {
  const files    = [...fileMap.values()];
  const snapshot = {
    generated: new Date().toISOString(),
    total:     files.length,
    files,
    skills:    files.filter(f => f.type === 'skill'),
    agents:    files.filter(f => f.type === 'agent'),
    projects:  files.filter(f => f.type === 'project'),
    apis:      files.filter(f => f.type === 'api'),
    unknown:   files.filter(f => f.type === 'unknown'),
  };
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(snapshot, null, 2));
  } catch (err) {
    console.error('[indexUpdater] Save failed:', err.message);
  }
}

// ── File stat → classified entry conversion ──────────────────────────────────

function makeFileStat(filePath, origin) {
  const stat = fs.statSync(filePath);
  return {
    path:     filePath,
    name:     path.basename(filePath),
    ext:      path.extname(filePath).toLowerCase(),
    size:     stat.size,
    modified: stat.mtime.toISOString(),
    origin:   origin || guessOrigin(filePath),
  };
}

function guessOrigin(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (p.includes('/brain/') || p.endsWith('/brain'))     return 'brain';
  if (p.includes('/gstack/') || p.endsWith('/gstack'))   return 'gstack';
  if (p.includes('/.claude/skills') || p.endsWith('/.claude/skills')) return 'claude-skills';
  if (p.includes('/.gemini/agents') || p.endsWith('/.gemini/agents')) return 'gemini-agents';
  if (p.includes('/.agents/skills') || p.endsWith('/.agents/skills')) return 'agents-skills';
  return 'Desktop';
}

function toEntry(classified) {
  return {
    path:           classified.path,
    name:           classified.name,
    ext:            classified.ext,
    size:           classified.size,
    modified:       classified.modified,
    origin:         classified.origin,
    type:           classified.type,
    category:       classified.category,
    subcategory:    classified.subcategory,
    tags:           classified.tags  || [],
    wikiLinks:      classified.wikiLinks || [],
    hasFrontmatter: classified.hasFrontmatter || false,
  };
}

// ── Public patch API ─────────────────────────────────────────────────────────

function addFile(filePath, origin) {
  let stat;
  try { stat = makeFileStat(filePath, origin); } catch { return null; }
  const classified = classifyOne(stat);
  fileMap.set(filePath, toEntry(classified));
  scheduleSave();
  return classified;
}

function updateFile(filePath, origin) {
  let stat;
  try { stat = makeFileStat(filePath, origin); } catch { return null; }
  const classified = classifyOne(stat);
  fileMap.set(filePath, toEntry(classified));
  scheduleSave();
  return classified;
}

function removeFile(filePath) {
  const had = fileMap.delete(filePath);
  if (had) scheduleSave();
}

function getEntry(filePath) {
  return fileMap.get(filePath) || null;
}

function getStats() {
  const files = [...fileMap.values()];
  return {
    total:    files.length,
    skills:   files.filter(f => f.type === 'skill').length,
    projects: files.filter(f => f.type === 'project').length,
    apis:     files.filter(f => f.type === 'api').length,
    unknown:  files.filter(f => f.type === 'unknown').length,
    notes:    files.filter(f => f.type === 'note').length,
  };
}

// Force-save without waiting for debounce (e.g. on shutdown)
function save() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  flush();
}

module.exports = { load, save, addFile, updateFile, removeFile, getEntry, getStats };
