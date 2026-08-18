'use strict';

const fs   = require('fs');
const path = require('path');

// ── Phase 1 modules ──────────────────────────────────────────────────────────
const { scan }       = require('./core/scanner');
const { classify }   = require('./core/classifier');
const { buildGraph } = require('./core/graphBuilder');
const { collectCodeGraphs } = require('./core/graphifyBridge');

// ── Phase 2 modules ──────────────────────────────────────────────────────────
const eventBus      = require('./core/eventBus');
const stateManager  = require('./core/stateManager');
const indexUpdater  = require('./core/indexUpdater');
const liveGraph     = require('./core/liveGraph');
const { startWatcher, stopWatcher } = require('./core/watcher');

// ── Phase 3 modules ──────────────────────────────────────────────────────────
const semanticEngine = require('./core/semanticEngine');

// ── Phase 4 modules ──────────────────────────────────────────────────────────
const eventReplay    = require('./core/eventReplay');
const sessionBuilder = require('./core/sessionBuilder');
const heatmapEngine  = require('./core/heatmapEngine');
const insightEngine  = require('./core/insightEngine');

// ── Agent telemetry modules ──────────────────────────────────────────────────
const ingestBridge        = require('./core/ingestBridge');
const skillTracker        = require('./core/skillTracker');
const memoryScanner       = require('./core/memoryScanner');
const agentEvents         = require('./core/agentEvents');
const agentSessionBuilder = require('./core/agentSessionBuilder');
const spendAggregator     = require('./core/spendAggregator');
const ledgerWriter        = require('./core/ledgerWriter');

const OUTPUT_DIR   = path.join(__dirname, 'output');
const PROPOSALS_DIR = path.join(__dirname, 'qdash', 'proposals');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Phase 1 helpers (unchanged logic) ────────────────────────────────────────

function buildIndexData(classifiedFiles) {
  const index = {
    generated: new Date().toISOString(),
    total: classifiedFiles.length,
    files: [], skills: [], projects: [], apis: [], agents: [], unknown: [],
  };
  for (const file of classifiedFiles) {
    const entry = {
      path: file.path, name: file.name, ext: file.ext,
      size: file.size, modified: file.modified, origin: file.origin,
      type: file.type, category: file.category, subcategory: file.subcategory,
      tags: file.tags || [], wikiLinks: file.wikiLinks || [],
      hasFrontmatter: file.hasFrontmatter || false,
    };
    index.files.push(entry);
    if (file.type === 'skill')        index.skills.push(entry);
    else if (file.type === 'project') index.projects.push(entry);
    else if (file.type === 'api')     index.apis.push(entry);
    else if (file.type === 'agent')   index.agents.push(entry);
    else if (file.type === 'unknown') index.unknown.push(entry);
  }
  return index;
}

function buildProposals(classifiedFiles) {
  const today = new Date().toISOString().split('T')[0];
  return classifiedFiles
    .filter(f => !f.hasFrontmatter && ['.md', '.mdx', '.txt'].includes(f.ext))
    .map(f => ({
      file: f.path,
      suggested_frontmatter: {
        type: f.type, category: f.category,
        subcategory: f.subcategory || 'general',
        status: 'active',
        tags: f.tags && f.tags.length > 0 ? f.tags : [],
        updated: today,
      },
    }));
}

// ── Phase 1 Boot ─────────────────────────────────────────────────────────────

async function phase1Boot() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      Q DASH CORE ENGINE (QCE)             ║');
  console.log('║  PHASE 1 BOOT → PHASE 2 LIVE TRANSITION   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  ensureDir(OUTPUT_DIR);
  ensureDir(PROPOSALS_DIR);

  // Step 1
  console.log('── STEP 1: SCANNING FILESYSTEM ──');
  const rawFiles = scan();
  console.log('');

  // Step 2
  console.log('── STEP 2: CLASSIFYING FILES ──');
  const classifiedFiles = classify(rawFiles);
  console.log('');

  // Step 3
  console.log('── STEP 3: BUILDING INDEX ──');
  const index = buildIndexData(classifiedFiles);
  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`[index] ${index.files.length} files | ${index.skills.length} skills | ${index.agents.length} agents | ${index.projects.length} projects | ${index.apis.length} apis`);
  console.log('');

  // Step 4
  console.log('── STEP 4: BUILDING GRAPH ──');
  const graph = buildGraph(classifiedFiles);
  const graphPath = path.join(OUTPUT_DIR, 'graph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  console.log(`[graph] ${graph.nodes.length} nodes | ${graph.edges.length} edges`);
  console.log('');

  // Step 5
  console.log('── STEP 5: HYDRATION PROPOSALS ──');
  const proposals = buildProposals(classifiedFiles);
  fs.writeFileSync(
    path.join(PROPOSALS_DIR, 'metadata.json'),
    JSON.stringify(proposals, null, 2)
  );
  console.log(`[proposals] ${proposals.length} files need frontmatter`);
  console.log('');

  // Step 6
  console.log('── STEP 6: CODE KNOWLEDGE GRAPHS ──');
  const codeGraphs = collectCodeGraphs();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'code-graphs.json'),
    JSON.stringify(codeGraphs, null, 2)
  );
  console.log('');

  stateManager.setLastScan();
  stateManager.update({
    totalFilesTracked: index.total,
    totalNodesInGraph: graph.nodes.length,
    totalEdgesInGraph: graph.edges.length,
  });

  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Q DASH CORE ENGINE COMPLETE              ║');
  console.log('║  Index files generated successfully       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

// ── Phase 2: Live event pipeline ─────────────────────────────────────────────

function phase2Live() {
  console.log('── PHASE 2: INITIALIZING LIVE SYSTEM ──');

  // Load the just-written index and graph into memory
  indexUpdater.load();
  liveGraph.load();
  stateManager.setLive();

  // ── Phase 3: semantic engine ─────────────────────────────────────────────
  console.log('── PHASE 3: INITIALIZING SEMANTIC ENGINE ──');
  semanticEngine.init();

  // ── Phase 4: cognitive layer ─────────────────────────────────────────────
  console.log('── PHASE 4: INITIALIZING COGNITIVE LAYER ──');
  sessionBuilder.init();
  heatmapEngine.init();
  insightEngine.init();
  console.log('[eventReplay] Ready (on-demand replay from events.log.json + semantic-events.json)');

  // ── Agent telemetry: skill tracker, memory scanner, ingest bridge ────────
  console.log('── PHASE 5: INITIALIZING AGENT TELEMETRY ──');
  skillTracker.init({ insightEngine });
  memoryScanner.init();
  ingestBridge.init({ eventBus });
  agentSessionBuilder.init();
  spendAggregator.init();
  ledgerWriter.init();
  agentSessionBuilder.setOnSessionClosed(ledgerWriter.onSessionClosed);

  // Subscribe skill_invoked / memory_read to their trackers, reading the
  // canonical AgentEvent (event.agent) rather than the legacy engineEvent
  // shape — under the new schema, agentType is the AGENT KIND
  // (claude-code/gemini/hermes/human), not the legacy event type, so the
  // discriminator now lives at event.agent.metadata.kind.
  eventBus.on('agent_event', event => {
    const canonical = event.agent;
    if (!canonical) return;
    const kind = canonical.metadata && canonical.metadata.kind;

    if (kind === 'skill_invoked' && canonical.metadata.skill) {
      skillTracker.recordInvocation(canonical.metadata.skill, canonical.project, canonical.agentType);
    }
    if (kind === 'memory_read' && Array.isArray(canonical.filesTouched)) {
      const sessionId = canonical.sessionId || (canonical.agentType + ':' + canonical.timestamp);
      for (const f of canonical.filesTouched) {
        memoryScanner.recordRead(f, sessionId);
      }
    }
  });

  // ── Catch-all: record every raw event in state ───────────────────────────
  eventBus.on('event', event => {
    stateManager.recordEvent(event);
  });

  // ── AGENT EVENT (from ingestBridge) ──────────────────────────────────────
  eventBus.on('agent_event', event => {
    try {
      const enriched = event; // already enriched by ingestBridge.mapToEngineEvent
      // Feed the cognitive layer
      sessionBuilder.recordEvent(enriched);
      heatmapEngine.recordEvent(enriched);
      insightEngine.recordEvent(enriched);
      eventReplay.invalidate();
      // Feed the new agent-observability layer from the canonical event
      if (event.agent) {
        agentSessionBuilder.recordEvent(event.agent);
        spendAggregator.recordEvent(event.agent);
      }
      _logAgentEvent(enriched);
    } catch (err) {
      console.error(`  [!] agent_event error: ${err.message}`);
    }
  });

  // ── FILE ADDED ───────────────────────────────────────────────────────────
  eventBus.on('file_added', event => {
    const { path: filePath, origin } = event;
    if (!filePath || typeof filePath !== 'string') return;
    try {
      const classified = indexUpdater.addFile(filePath, origin);
      if (!classified || !classified.path) return;
      liveGraph.addNode(classified);
      _syncStats();

      // P3: semantic enrichment
      const enriched = semanticEngine.process(event, classified);

      // P4: cognitive layer (non-blocking, O(1) each)
      sessionBuilder.recordEvent(enriched);
      heatmapEngine.recordEvent(enriched);
      insightEngine.recordEvent(enriched);
      eventReplay.invalidate();

      // Human stream → agent-observability layer only (legacy layers above
      // already got the event). Skip if this write was just made by an
      // agent (ingestBridge's echo-suppression window).
      _synthesizeHumanEvent(event, filePath, enriched);

      _logSemantic(enriched, '+');
    } catch (err) {
      // Swallow non-fatal errors from individual file events
    }
  });

  // ── FILE CHANGED ─────────────────────────────────────────────────────────
  eventBus.on('file_changed', event => {
    const { path: filePath, origin } = event;
    try {
      const classified = indexUpdater.updateFile(filePath, origin);
      if (!classified) return;
      liveGraph.updateNode(classified);
      _syncStats();

      const enriched = semanticEngine.process(event, classified);

      sessionBuilder.recordEvent(enriched);
      heatmapEngine.recordEvent(enriched);
      insightEngine.recordEvent(enriched);
      eventReplay.invalidate();

      _synthesizeHumanEvent(event, filePath, enriched);

      _logSemantic(enriched, '~');
    } catch (err) {
      // swallow
    }
  });

  // ── FILE DELETED ─────────────────────────────────────────────────────────
  eventBus.on('file_deleted', event => {
    const { path: filePath } = event;
    try {
      // Enrich BEFORE removing so graph cross-ref still resolves
      const enriched = semanticEngine.process(event, null);
      indexUpdater.removeFile(filePath);
      liveGraph.removeNode(filePath);
      _syncStats();

      sessionBuilder.recordEvent(enriched);
      heatmapEngine.recordEvent(enriched);
      insightEngine.recordEvent(enriched);
      eventReplay.invalidate();

      _synthesizeHumanEvent(event, filePath, enriched);

      _logSemantic(enriched, '-');
    } catch (err) {
      // swallow
    }
  });

  // Start watcher — fires events into eventBus
  startWatcher();

  // Periodic status pulse every 60 seconds
  setInterval(() => {
    const s   = stateManager.getSummary();
    const ss  = semanticEngine.getStats();
    const ses = sessionBuilder.getStats();
    const hm  = heatmapEngine.getStats();
    const ins = insightEngine.getStats();
    if (s.updates === 0) return;

    console.log('');
    console.log('  ┌─ Q DASH PULSE ─────────────────────────────');
    console.log(`  │ Events   : ${s.updates} total  (+${s.eventCounts.file_added} ~${s.eventCounts.file_changed} -${s.eventCounts.file_deleted})`);
    console.log(`  │ Index    : ${s.filesTracked} files · ${s.graphNodes} graph nodes`);
    console.log(`  │ Semantic : ${ss.analyzed} enriched · ${ss.highImpact} HIGH impact`);
    console.log(`  │ Sessions : ${ses.completedSessions} complete · ${ses.liveEvents} events in current`);
    console.log(`  │ Heatmap  : ${hm.uniqueFiles} files · ${hm.uniqueProjects} projects · peak hr ${hm.peakHour}:00`);
    console.log(`  │ Insights : ${ins.totalInsights} active`);
    console.log('  └────────────────────────────────────────────');
    console.log('');
  }, 60_000);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _syncStats() {
  const i = indexUpdater.getStats();
  const g = liveGraph.getStats();
  stateManager.update({
    totalFilesTracked: i.total,
    totalNodesInGraph: g.nodes,
    totalEdgesInGraph: g.edges,
  });
}

function _short(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

// Print a compact semantic event line to the console
function _logSemantic(enriched, glyph) {
  const s       = enriched.semantic;
  const impact  = s.impact.toUpperCase().padEnd(6);
  const conf    = (s.confidence * 100).toFixed(0).padStart(3) + '%';
  const project = s.project ? `[${s.project}]` : '';
  const cat     = (s.category || 'unknown').padEnd(9);
  console.log(
    `  [${glyph}] ${impact} ${conf}  ${cat} ${project}  ${_short(enriched.path)}`
  );
  if (s.impact === 'high') {
    console.log(`      ↳ ${s.intent}`);
  }
}

// Synthesize a canonical 'human' AgentEvent from a raw watcher file event and
// feed it to the agent-observability layer ONLY (agentSessionBuilder +
// spendAggregator) — the legacy layers (sessionBuilder/heatmapEngine/
// insightEngine) already received the event via the caller above.
//
// Echo suppression: if ingestBridge just recorded an agent event touching
// this exact path within its TTL window, this write is almost certainly the
// agent's own edit landing on disk — skip synthesizing a human event for it.
function _synthesizeHumanEvent(rawEvent, filePath, enriched) {
  if (!filePath || typeof filePath !== 'string') return;
  if (ingestBridge.isAgentEcho(filePath)) {
    console.log(`  [echo] skip human event for ${_short(filePath)} (agent-touched)`);
    return;
  }
  try {
    const humanEvent = agentEvents.normalize({
      schema: agentEvents.SCHEMA_ID,
      agentId: 'human',
      agentType: 'human',
      sessionId: null,
      timestamp: enriched?.timestamp || new Date().toISOString(),
      eventType: 'file_change',
      project: enriched?.semantic?.project || 'unknown',
      filesTouched: [filePath],
      tokensIn: null,
      tokensOut: null,
      model: null,
      estimatedCostUsd: null,
      durationMs: null,
      metadata: { kind: rawEvent?.type || 'file_change', origin: 'watcher' },
    });
    // Log to the canonical NDJSON so restarts rebuild human sessions/spend
    // the same way agent sessions are rebuilt.
    ingestBridge.appendCanonicalLog(humanEvent);
    agentSessionBuilder.recordEvent(humanEvent);
    spendAggregator.recordEvent(humanEvent);
  } catch (err) {
    // non-fatal — human-stream telemetry is best-effort
  }
}

// Print an agent event line to the console
function _logAgentEvent(enriched) {
  const source  = (enriched.source || 'agent').padEnd(11);
  const type    = (enriched.agentType || 'event').padEnd(14);
  const project = (enriched.agentProject || '?').padEnd(18);
  const detail  = enriched.agentDetail || {};
  const detailStr = detail.tool || detail.skill || detail.cmd?.slice(0, 40) || detail.file || '';
  console.log(`  [@] ${source} ${type} ${project} ${detailStr}`.slice(0, 140));
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function onShutdown() {
  console.log('\n[QCE] Shutdown signal received — flushing all state...');
  stopWatcher();
  indexUpdater.save();
  liveGraph.save();
  sessionBuilder.flush();
  heatmapEngine.flush();
  insightEngine.flush();
  agentSessionBuilder.flush();
  spendAggregator.flush();

  const summary  = stateManager.getSummary();
  const semStats = semanticEngine.getStats();
  const sesStats = sessionBuilder.getStats();
  const hmStats  = heatmapEngine.getStats();
  const insStats = insightEngine.getStats();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║           Q DASH SESSION REPORT           ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Uptime:           ${String(summary.uptimeSeconds + 's').padEnd(22)}║`);
  console.log(`║  Total events:     ${String(summary.updates).padEnd(22)}║`);
  console.log(`║    Added:          ${String(summary.eventCounts.file_added).padEnd(22)}║`);
  console.log(`║    Changed:        ${String(summary.eventCounts.file_changed).padEnd(22)}║`);
  console.log(`║    Deleted:        ${String(summary.eventCounts.file_deleted).padEnd(22)}║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Graph nodes:      ${String(summary.graphNodes).padEnd(22)}║`);
  console.log(`║  Graph edges:      ${String(summary.graphEdges).padEnd(22)}║`);
  console.log(`║  Files tracked:    ${String(summary.filesTracked).padEnd(22)}║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Semantic events:  ${String(semStats.analyzed).padEnd(22)}║`);
  console.log(`║  HIGH impact:      ${String(semStats.highImpact).padEnd(22)}║`);
  console.log(`║  Sessions:         ${String(sesStats.completedSessions).padEnd(22)}║`);
  console.log(`║  Unique files:     ${String(hmStats.uniqueFiles).padEnd(22)}║`);
  console.log(`║  Unique projects:  ${String(hmStats.uniqueProjects).padEnd(22)}║`);
  console.log(`║  Peak hour:        ${String(hmStats.peakHour + ':00').padEnd(22)}║`);
  console.log(`║  Insights:         ${String(insStats.totalInsights).padEnd(22)}║`);
  console.log('╠══════════════════════════════════════════╣');

  // Print top 3 insights
  const topInsights = insightEngine.getInsights().insights.slice(0, 3);
  if (topInsights.length) {
    console.log('║  Top insights:                           ║');
    for (const ins of topInsights) {
      const msg = ins.message.slice(0, 38).padEnd(38);
      console.log(`║   • ${msg} ║`);
    }
  }

  // Show top project from semantic stats
  const projEntries = Object.entries(semStats.byProject || {}).filter(([k]) => k !== '_none');
  if (projEntries.length) {
    const [topProj, topCount] = projEntries.sort((a, b) => b[1] - a[1])[0];
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  Top project: ${(topProj + ' (' + topCount + ' events)').slice(0, 27).padEnd(27)}║`);
  }

  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('Output files:');
  console.log('  output/index.json           output/graph.json');
  console.log('  output/events.log.json      output/semantic-events.json');
  console.log('  output/sessions.json        output/heatmap.json');
  console.log('  output/insights.json');
  console.log('');
  process.exit(0);
}

process.on('SIGINT',  onShutdown);
process.on('SIGTERM', onShutdown);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await phase1Boot();
  phase2Live();

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       Q DASH LIVE SYSTEM RUNNING          ║');
  console.log('║       Watching filesystem...              ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('  Monitored roots:');
  console.log('    C:\\Users\\Tyson\\brain');
  console.log('    C:\\Users\\Tyson\\gstack');
  console.log('    C:\\Users\\Tyson\\Desktop');
  console.log('');
  console.log('  Phase 1+2 (Structure):');
  console.log('    output/index.json         output/graph.json');
  console.log('  Phase 3 (Semantics):');
  console.log('    output/events.log.json    output/semantic-events.json');
  console.log('  Phase 4 (Cognition):');
  console.log('    output/sessions.json      output/heatmap.json');
  console.log('    output/insights.json');
  console.log('');
  console.log('  Console key:  [+] added  [~] changed  [-] deleted');
  console.log('  Impact:       HIGH / MEDIUM / LOW   Confidence: %');
  console.log('');
  console.log('  Press Ctrl+C to stop and see the full session report.');
  console.log('');
}

main().catch(err => {
  console.error('[QCE] Fatal error:', err);
  process.exit(1);
});
