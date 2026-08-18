'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH MEMORY SCANNER — Discovers context files per project
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const MEMORY_FILES = ['CLAUDE.md', 'GEMINI.md', 'XENLIX-CONTEXT.md', 'AGENTS.md', 'README.md', 'CONTEXT.md', 'INSTRUCTIONS.md'];
const MEMORY_DIRS  = ['.claude/rules', '.claude/rules.md', '.agent', '.qdash'];

const OUTPUT = path.join(__dirname, '..', 'output', 'memory-index.json');

function discoverProjects() {
  // Pull from existing index.json + projectScanner
  const idxPath = path.join(__dirname, '..', 'output', 'index.json');
  if (!fs.existsSync(idxPath)) return [];
  try {
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const projects = idx.projects || [];
    const map = new Map();
    for (const f of projects) {
      if (f.name === 'package.json') {
        const root = path.dirname(f.path);
        const folder = path.basename(root);
        if (!map.has(root)) map.set(root, { path: root, name: folder, memoryFiles: [] });
      }
    }
    return [...map.values()];
  } catch { return []; }
}

function isMemoryFile(name) {
  return MEMORY_FILES.includes(name);
}

function isMemoryDir(name) {
  return MEMORY_DIRS.includes(name);
}

function hasMemoryTag(content) {
  if (!content) return false;
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return false;
  return /\b(memory|context|instructions|rules)\b/i.test(fm[1]);
}

function scanProjectMemory(root) {
  const found = [];
  try {
    // Top-level memory files
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && isMemoryFile(entry.name)) {
        const fp = path.join(root, entry.name);
        const stat = fs.statSync(fp);
        found.push({
          path: fp,
          name: entry.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          kind: 'top-level',
        });
      }
    }
    // Walk subdirs one level deep for .claude/rules etc
    function walk(dir, depth) {
      if (depth > 3) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        if (isMemoryDir(entry.name) || entry.name === '.claude' || entry.name === '.agent') {
          const subdir = path.join(dir, entry.name);
          try {
            for (const sub of fs.readdirSync(subdir, { withFileTypes: true })) {
              if (sub.isFile() && (sub.name.endsWith('.md') || isMemoryFile(sub.name))) {
                const fp = path.join(subdir, sub.name);
                const stat = fs.statSync(fp);
                found.push({ path: fp, name: sub.name, size: stat.size, modified: stat.mtime.toISOString(), kind: entry.name });
              }
            }
          } catch {}
        }
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
    walk(root, 0);
  } catch {}
  return found;
}

function recordRead(memoryFilePath, sessionId) {
  // Maintain a per-file read counter
  if (!recordRead._cache) recordRead._cache = new Map();
  const key = memoryFilePath;
  if (!recordRead._cache.has(key)) recordRead._cache.set(key, { reads: 0, sessions: new Set(), lastRead: null });
  const r = recordRead._cache.get(key);
  r.reads++;
  r.sessions.add(sessionId);
  r.lastRead = new Date().toISOString();
}

function scan() {
  const projects = discoverProjects();
  const index = {
    generated: new Date().toISOString(),
    totalProjects: projects.length,
    projects: projects.map(p => {
      const memoryFiles = scanProjectMemory(p.path);
      return { ...p, memoryFileCount: memoryFiles.length, memoryFiles };
    }),
  };
  try {
    fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2));
  } catch (e) {
    console.error('[memoryScanner] save failed:', e.message);
  }
  return index;
}

function init() {
  const result = scan();
  console.log(`[memoryScanner] indexed memory for ${result.totalProjects} projects`);
}

module.exports = { init, scan, scanProjectMemory, recordRead, MEMORY_FILES };
