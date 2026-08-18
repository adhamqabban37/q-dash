'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'output', 'events.log.json');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this._ensureLog();
  }

  _ensureLog() {
    try {
      const dir = path.dirname(LOG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '');
    } catch {}
  }

  // Primary method: fire a typed event, write to log, notify listeners
  fire(type, payload = {}) {
    const event = {
      type,
      path: payload.path || null,
      origin: payload.origin || null,
      timestamp: new Date().toISOString(),
      source: 'watcher',
      ...payload,
    };

    // Append as NDJSON line — O(1) append, no rewrite
    try {
      fs.appendFileSync(LOG_PATH, JSON.stringify(event) + '\n');
    } catch {}

    // Emit specific event (e.g. 'file_added') and catch-all 'event'
    this.emit(type, event);
    this.emit('event', event);

    return event;
  }

  // Read last N events from the log
  tail(n = 20) {
    try {
      const content = fs.readFileSync(LOG_PATH, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.slice(-n).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }
}

module.exports = new EventBus();
