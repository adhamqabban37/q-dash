'use strict';

// Timezone policy: timestamps are stored UTC; "today" and day-bucketing below
// are computed in America/Chicago via core/time.js (dayKey), not raw UTC.

const fs   = require('fs');
const path = require('path');
const time = require('./time');

const INSIGHTS_PATH = path.join(__dirname, '..', 'output', 'insights.json');
const HEATMAP_PATH  = path.join(__dirname, '..', 'output', 'heatmap.json');
const SESSIONS_PATH = path.join(__dirname, '..', 'output', 'sessions.json');

const INSIGHT_EVERY   = 25;   // regenerate after every N events
const MAX_INSIGHTS    = 60;   // cap stored insights
const RECENT_WINDOW   = 1000; // rolling event window size

// ── In-memory state ───────────────────────────────────────────────────────────

let _recentEvents       = [];
let _insights           = [];
let _eventsSinceLast    = 0;
let _saveTimer          = null;

// ── Safe disk reads ───────────────────────────────────────────────────────────

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

function readNDJSON(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const out = [];
    for (const l of fs.readFileSync(filePath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { out.push(JSON.parse(l)); } catch {}
    }
    return out;
  } catch { return []; }
}

// ── Insight builder helpers ───────────────────────────────────────────────────

function makeInsight(id, type, category, message, confidence, supportingEvents = []) {
  return {
    id,
    type,                          // 'trend' | 'summary' | 'anomaly'
    category,                      // 'project' | 'skill' | 'session' | 'system'
    message,
    confidence: Math.round(confidence * 100) / 100,
    supportingEvents: supportingEvents.slice(0, 5),
    timestamp: new Date().toISOString(),
  };
}

function topEntry(obj) {
  if (!obj || !Object.keys(obj).length) return null;
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
}

// ── Insight generators (each returns an insight object or null) ───────────────

function genTodaySummary() {
  const today   = time.dayKey(new Date());
  const todays  = _recentEvents.filter(e => e.timestamp && time.dayKey(e.timestamp) === today);
  if (todays.length < 2) return null;

  const projects = [...new Set(todays.map(e => e.semantic?.project).filter(Boolean))];
  const files    = [...new Set(todays.map(e => e.path).filter(Boolean))];

  let message;
  if (projects.length === 1) {
    message = `Today: ${todays.length} changes in "${projects[0]}" across ${files.length} files`;
  } else if (projects.length > 1) {
    message = `Today: ${todays.length} changes across ${projects.length} projects (${projects.slice(0, 3).join(', ')})`;
  } else {
    message = `Today: ${todays.length} filesystem changes across ${files.length} files`;
  }

  return makeInsight(
    `today_${today}`, 'summary', 'session', message,
    todays.length > 10 ? 0.95 : 0.80,
    files.slice(0, 5)
  );
}

function genMostActiveProject(heatmap) {
  if (!heatmap?.hotProjects?.length) return null;
  const top   = heatmap.hotProjects[0];
  const files = (heatmap.hotFiles || []).filter(f => f.path?.includes(top.name));

  return makeInsight(
    'most_active_project', 'trend', 'project',
    `Most active project: "${top.name}" with ${top.count} recorded events`,
    top.count > 10 ? 0.92 : 0.72,
    files.slice(0, 3).map(f => f.path)
  );
}

function genCurrentlyBuilding() {
  const last30 = _recentEvents.slice(-30);
  if (last30.length < 3) return null;

  const counts = {};
  for (const e of last30) {
    const p = e.semantic?.project;
    if (p) counts[p] = (counts[p] || 0) + 1;
  }

  const top = topEntry(counts);
  if (!top) return null;
  const [projName, count] = top;

  const recent = last30
    .filter(e => e.semantic?.project === projName)
    .map(e => e.path)
    .filter(Boolean);

  const actType = last30.find(e => e.semantic?.project === projName)?.semantic?.changeVerb || 'modifying';

  return makeInsight(
    'currently_building', 'summary', 'project',
    `Currently building: "${projName}" — ${count} of last 30 events`,
    0.90,
    [...new Set(recent)].slice(0, 4)
  );
}

function genEmergingSkill(heatmap) {
  if (!heatmap?.hotSkills?.length) return null;
  const top      = heatmap.hotSkills[0];
  const skillPat = `/gstack/${top.name}`;
  const recent   = _recentEvents.filter(e => e.path?.replace(/\\/g, '/').includes(skillPat));
  if (recent.length < 2) return null;

  return makeInsight(
    `emerging_skill_${top.name}`, 'trend', 'skill',
    `Most active skill: "${top.name}" — ${top.count} total events, ${recent.length} recent`,
    recent.length > 5 ? 0.87 : 0.70,
    recent.slice(0, 3).map(e => e.path)
  );
}

function genHighImpactSpike() {
  const last50 = _recentEvents.slice(-50);
  const high   = last50.filter(e => e.semantic?.impact === 'high');
  if (high.length < 4) return null;

  const ratio = high.length / last50.length;
  return makeInsight(
    'high_impact_spike', 'anomaly', 'system',
    `Architecture activity spike: ${high.length}/${last50.length} recent events are HIGH impact`,
    Math.min(0.65 + ratio * 0.30, 0.95),
    [...new Set(high.map(e => e.path).filter(Boolean))].slice(0, 5)
  );
}

function genDeletionAnomaly() {
  const last100 = _recentEvents.slice(-100);
  const dels    = last100.filter(e => e.type === 'file_deleted');
  if (dels.length < 6) return null;

  const ratio = dels.length / last100.length;
  return makeInsight(
    'deletion_anomaly', 'anomaly', 'system',
    `Deletion spike: ${dels.length} files removed in last ${last100.length} events (${Math.round(ratio * 100)}%)`,
    0.88,
    dels.slice(0, 5).map(e => e.path)
  );
}

function genPeakHour(heatmap) {
  if (!heatmap || heatmap.totalEvents < 30) return null;

  const h     = heatmap.peakHour;
  const count = heatmap.activityCurve?.[h]?.count || 0;
  const ampm  = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
  const period = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';

  return makeInsight(
    'peak_hour', 'trend', 'system',
    `Peak productivity hour: ${ampm} (${count} events). System most active in the ${period}.`,
    heatmap.totalEvents > 100 ? 0.88 : 0.65,
    []
  );
}

function genLastSession(sessions) {
  const list = sessions?.sessions;
  if (!list?.length) return null;
  const last = list[list.length - 1];
  const proj = last.dominantProject || 'unknown project';
  const mins = Math.round((last.durationSeconds || 0) / 60);
  const type = last.activityType || 'mixed';

  return makeInsight(
    `last_session_${last.sessionId}`, 'summary', 'session',
    `Last session: ${mins}min of ${type} work on "${proj}" — ${last.eventCount} events, ` +
    `${last.impactSummary?.high || 0} HIGH impact`,
    0.93,
    (last.filesChanged || []).slice(0, 4)
  );
}

function genHotDirectory(heatmap) {
  if (!heatmap?.hotDirectories?.length) return null;
  const top = heatmap.hotDirectories[0];
  if (top.count < 5) return null;

  const shortPath = top.path.replace(/\\/g, '/').split('/').slice(-3).join('/');
  return makeInsight(
    'hot_directory', 'trend', 'system',
    `System hotspot: ".../${shortPath}" — ${top.count} events (highest change density)`,
    0.84,
    []
  );
}

// ── Main generator ────────────────────────────────────────────────────────────

function generateInsights() {
  const heatmap  = readJSON(HEATMAP_PATH);
  const sessions = readJSON(SESSIONS_PATH);

  const candidates = [
    genTodaySummary(),
    genMostActiveProject(heatmap),
    genCurrentlyBuilding(),
    genEmergingSkill(heatmap),
    genHighImpactSpike(),
    genDeletionAnomaly(),
    genPeakHour(heatmap),
    genLastSession(sessions),
    genHotDirectory(heatmap),
  ].filter(Boolean);

  // Merge: deduplicate by id (keep newest), then cap
  const byId = new Map(_insights.map(i => [i.id, i]));
  for (const ins of candidates) byId.set(ins.id, ins);

  _insights = [...byId.values()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, MAX_INSIGHTS);

  scheduleSave();
}

// ── Save (debounced) ─────────────────────────────────────────────────────────

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flush, 800);
}

function flush() {
  try {
    fs.writeFileSync(INSIGHTS_PATH, JSON.stringify({
      generated: new Date().toISOString(),
      total:     _insights.length,
      insights:  _insights,
    }, null, 2));
  } catch (err) {
    console.error('[insightEngine] Save failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function recordEvent(enrichedEvent) {
  _recentEvents.push(enrichedEvent);
  if (_recentEvents.length > RECENT_WINDOW) {
    _recentEvents = _recentEvents.slice(-RECENT_WINDOW);
  }

  _eventsSinceLast++;
  if (_eventsSinceLast >= INSIGHT_EVERY) {
    generateInsights();
    _eventsSinceLast = 0;
  }
}

// Allow external modules (e.g. skillTracker) to inject insights directly
function recordInsight(insight) {
  if (!insight || !insight.id) return;
  // Replace existing insight with same id
  const byId = new Map(_insights.map(i => [i.id, i]));
  byId.set(insight.id, { ...insight, timestamp: new Date().toISOString() });
  _insights = [...byId.values()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, MAX_INSIGHTS);
  scheduleSave();
}

function getInsights() {
  return { generated: new Date().toISOString(), total: _insights.length, insights: _insights };
}

function getStats() {
  return {
    totalInsights:   _insights.length,
    recentEventWindow: _recentEvents.length,
    pendingUntilNext: Math.max(0, INSIGHT_EVERY - _eventsSinceLast),
  };
}

function init() {
  // Load existing insights if present
  if (fs.existsSync(INSIGHTS_PATH)) {
    try {
      const d  = readJSON(INSIGHTS_PATH);
      _insights = d?.insights || [];
      console.log(`[insightEngine] Loaded ${_insights.length} existing insights`);
    } catch {}
  }

  // Seed rolling window from semantic log
  const hist = readNDJSON(path.join(__dirname, '..', 'output', 'semantic-events.json'));
  if (hist.length) {
    _recentEvents = hist.slice(-RECENT_WINDOW);
    generateInsights();
    console.log(`[insightEngine] Seeded with ${_recentEvents.length} historical events → ${_insights.length} insights`);
  } else {
    flush();
    console.log('[insightEngine] Initialized (no historical events)');
  }
}

module.exports = { init, recordEvent, recordInsight, generateInsights, getInsights, getStats, flush };
