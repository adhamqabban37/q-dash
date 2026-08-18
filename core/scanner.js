'use strict';

const fs = require('fs');
const path = require('path');

const SCAN_ROOTS = [
  { path: 'C:\\Users\\Tyson\\brain',           origin: 'brain' },
  { path: 'C:\\Users\\Tyson\\gstack',          origin: 'gstack' },
  { path: 'C:\\Users\\Tyson\\.agents\\skills', origin: 'agents-skills' },
  { path: 'C:\\Users\\Tyson\\.claude\\skills', origin: 'claude-skills' },
  { path: 'C:\\Users\\Tyson\\.gemini\\agents', origin: 'gemini-agents' },
  { path: 'C:\\Users\\Tyson\\Desktop',         origin: 'Desktop' },
];

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '__pycache__',
  '.cache',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'Thumbs.db',
  '$Recycle.Bin',
  'System Volume Information',
  'WindowsApps',
  'AppData',
]);

function shouldIgnore(name) {
  return IGNORE_DIRS.has(name) || name.startsWith('.');
}

function scanDir(dirPath, origin, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      scanDir(fullPath, origin, results);
    } else if (entry.isFile()) {
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }

      results.push({
        path: fullPath,
        name: entry.name,
        ext: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        origin,
      });
    }
  }

  return results;
}

function scan() {
  const allFiles = [];

  for (const root of SCAN_ROOTS) {
    const rootPath = typeof root === 'string' ? root : root.path;
    const origin   = typeof root === 'string' ? path.basename(root) : root.origin;

    if (!fs.existsSync(rootPath)) {
      console.warn(`[scanner] Skipping missing directory: ${rootPath}`);
      continue;
    }
    console.log(`[scanner] Scanning ${rootPath}...`);
    const files = scanDir(rootPath, origin);
    console.log(`[scanner]   Found ${files.length} files`);
    allFiles.push(...files);
  }

  console.log(`[scanner] Total files found: ${allFiles.length}`);
  return allFiles;
}

module.exports = { scan };
