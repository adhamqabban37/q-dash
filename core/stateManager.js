'use strict';

const state = {
  startTime:          new Date().toISOString(),
  phase:              1,
  mode:               'static',
  systemHealth:       'healthy',
  lastScanTime:       null,
  lastEventTime:      null,
  updatesThisSession: 0,
  totalFilesTracked:  0,
  totalNodesInGraph:  0,
  totalEdgesInGraph:  0,
  activeChanges:      [],   // rolling last-50 events
  eventCounts: {
    file_added:   0,
    file_changed: 0,
    file_deleted: 0,
  },
};

function update(patch) {
  Object.assign(state, patch);
}

function setLive() {
  state.phase = 2;
  state.mode  = 'live';
}

function setLastScan() {
  state.lastScanTime = new Date().toISOString();
}

function recordEvent(event) {
  state.lastEventTime = event.timestamp;
  state.updatesThisSession++;

  if (state.eventCounts[event.type] !== undefined) {
    state.eventCounts[event.type]++;
  }

  state.activeChanges.unshift({
    type:      event.type,
    path:      event.path,
    timestamp: event.timestamp,
  });
  if (state.activeChanges.length > 50) {
    state.activeChanges = state.activeChanges.slice(0, 50);
  }
}

function setHealth(status) {
  state.systemHealth = status;
}

function getState() {
  return { ...state, activeChanges: [...state.activeChanges] };
}

function getSummary() {
  const uptimeSec = Math.round(
    (Date.now() - new Date(state.startTime).getTime()) / 1000
  );
  return {
    mode:         state.mode,
    phase:        state.phase,
    health:       state.systemHealth,
    uptimeSeconds: uptimeSec,
    lastScan:     state.lastScanTime,
    lastEvent:    state.lastEventTime,
    updates:      state.updatesThisSession,
    eventCounts:  state.eventCounts,
    filesTracked: state.totalFilesTracked,
    graphNodes:   state.totalNodesInGraph,
    graphEdges:   state.totalEdgesInGraph,
  };
}

module.exports = { state, update, setLive, setLastScan, recordEvent, setHealth, getState, getSummary };
