'use strict';

const path      = require('path');
const eventBus  = require('./eventBus');

const WATCH_ROOTS = [
  'C:\\Users\\Tyson\\brain',
  'C:\\Users\\Tyson\\gstack',
  'C:\\Users\\Tyson\\Desktop',
  'C:\\Users\\Tyson\\.agents\\skills',
  'C:\\Users\\Tyson\\.claude\\skills',
  'C:\\Users\\Tyson\\.gemini\\agents',
];

// Patterns that should never trigger events
const IGNORE_PATTERNS = [
  /node_modules/i,
  /\.git[/\\\\]/,
  /\.next[/\\\\]/,
  /[/\\\\]dist[/\\\\]/,
  /[/\\\\]build[/\\\\]/,
  /[/\\\\]\.cache[/\\\\]/,
  /AppData[/\\\\]/,
  /\$Recycle/,
  /\.(png|jpg|jpeg|gif|exe|zip|rar|7z|iso|pdf|dll|sys|bin|tmp)$/i, // Binary and temp files
  /Agentic dash[/\\\\]output[/\\\\]/i,
  /Agentic dash[/\\\\]qdash[/\\\\]/i,
  /events\.log\.json$/,
  /index\.json$/,
  /graph\.json$/,
];

function shouldIgnore(filePath) {
  return IGNORE_PATTERNS.some(re => re.test(filePath));
}

function getOrigin(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (p.includes('/.claude/skills') || p.includes('\\.claude\\skills')) return 'claude-skills';
  if (p.includes('/.gemini/agents') || p.includes('\\.gemini\\agents')) return 'gemini-agents';
  if (p.includes('/.agents/skills') || p.includes('\\.agents\\skills')) return 'agents-skills';
  if (p.includes('/brain/') || p.match(/\/brain$/i))   return 'brain';
  if (p.includes('/gstack/') || p.match(/\/gstack$/i)) return 'gstack';
  return 'Desktop';
}

let _watcher = null;

function startWatcher() {
  let chokidar;
  try {
    chokidar = require('chokidar');
  } catch {
    console.error('[watcher] chokidar not installed — run: npm install chokidar');
    process.exit(1);
  }

  _watcher = chokidar.watch(WATCH_ROOTS, {
    persistent:    true,
    ignoreInitial: true,      // don't fire for files that already exist at start
    followSymlinks: false,
    depth:         12,
    awaitWriteFinish: {
      stabilityThreshold: 400,  // wait 400 ms after last write before firing
      pollInterval:       100,
    },
    ignored: (filePath, stat) => {
      // chokidar calls with (path, stat); stat may be undefined on first call
      if (shouldIgnore(filePath)) return true;
      // Allow .agents/skills even though it lives in a dotdir
      if (filePath.includes('\\.agents\\skills') || filePath.includes('/.agents/skills')) return false;
      // Skip other hidden files/directories
      const base = path.basename(filePath);
      if (base.startsWith('.') && base !== '.env') return true;
      return false;
    },
    usePolling: false,      // use native fs events
  });

  _watcher.on('add', filePath => {
    if (!filePath || typeof filePath !== 'string') return;
    if (shouldIgnore(filePath)) return;
    eventBus.fire('file_added', { path: filePath, origin: getOrigin(filePath) });
  });

  _watcher.on('change', filePath => {
    if (!filePath || typeof filePath !== 'string') return;
    if (shouldIgnore(filePath)) return;
    eventBus.fire('file_changed', { path: filePath, origin: getOrigin(filePath) });
  });

  _watcher.on('unlink', filePath => {
    if (!filePath || typeof filePath !== 'string') return;
    if (shouldIgnore(filePath)) return;
    eventBus.fire('file_deleted', { path: filePath, origin: getOrigin(filePath) });
  });

  _watcher.on('error', err => {
    console.error('[watcher] Error:', err.message);
  });

  _watcher.on('ready', () => {
    const watched = _watcher.getWatched();
    const dirCount = Object.keys(watched).length;
    console.log(`[watcher] Ready — watching ${dirCount} directories across 4 roots`);
  });

  return _watcher;
}

function stopWatcher() {
  if (_watcher) _watcher.close();
}

module.exports = { startWatcher, stopWatcher };
