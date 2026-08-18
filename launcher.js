'use strict';

// Mock TTY properties to fool libraries that check for interactive terminals
Object.defineProperty(process.stdin, 'isTTY', { get: () => true });
Object.defineProperty(process.stdout, 'isTTY', { get: () => true });
Object.defineProperty(process.stderr, 'isTTY', { get: () => true });

console.log('[Launcher] TTY Mock enabled. Starting Q-Dash Engine...');

try {
  require('./run.js');
} catch (err) {
  console.error('[Launcher] Fatal error during boot:', err);
  process.exit(1);
}
