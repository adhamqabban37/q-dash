import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const dynamic = 'force-dynamic';

const OUTPUT = path.join(process.cwd(), '..', 'output');
const QDIR   = path.join(os.homedir(), '.qdash');
const BRIDGE = path.join(QDIR, 'bridge', 'trigger.json');
const PENDING = path.join(QDIR, 'bridge', 'inbox-pending.jsonl');
const EVENTS = path.join(OUTPUT, 'events.log.json');
const STATE  = path.join(OUTPUT, 'state.json');

function safeJSON(p: string) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function countNDJSON(p: string): number {
  if (!fs.existsSync(p)) return 0;
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).length; } catch { return 0; }
}
function ageSeconds(p: string): number | null {
  try { return Math.floor((Date.now() - fs.statSync(p).mtimeMs) / 1000); } catch { return null; }
}
function statusLight(ageSec: number | null): 'green' | 'yellow' | 'red' {
  if (ageSec === null) return 'red';
  if (ageSec < 10) return 'green';
  if (ageSec < 30) return 'yellow';
  return 'red';
}

export async function GET() {
  const index   = safeJSON(path.join(OUTPUT, 'index.json'));
  const graph   = safeJSON(path.join(OUTPUT, 'graph.json'));
  const heatmap = safeJSON(path.join(OUTPUT, 'heatmap.json'));
  const insights = safeJSON(path.join(OUTPUT, 'insights.json'));
  const skillStats = safeJSON(path.join(OUTPUT, 'skill-stats.json'));
  const memory   = safeJSON(path.join(OUTPUT, 'memory-index.json'));

  const eventCount = countNDJSON(EVENTS);
  const semCount   = countNDJSON(path.join(OUTPUT, 'semantic-events.json'));
  const pendingCount = countNDJSON(PENDING);

  const engineAge = ageSeconds(STATE);
  const watcherAge = ageSeconds(EVENTS);
  const ingestAge = ageSeconds(BRIDGE);

  // Active sessions: derived from last 5 minutes of semantic events
  const semPath = path.join(OUTPUT, 'semantic-events.json');
  let activeSessions: any[] = [];
  try {
    if (fs.existsSync(semPath)) {
      const lines = fs.readFileSync(semPath, 'utf8').split('\n').filter(Boolean);
      const cutoff = Date.now() - 5 * 60 * 1000;
      const recent = lines
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e: any) => e && e.timestamp && new Date(e.timestamp).getTime() > cutoff);
      // Group by project
      const byProject = new Map<string, number>();
      for (const e of recent) {
        const p = e.agentProject || e.semantic?.project || 'unknown';
        byProject.set(p, (byProject.get(p) || 0) + 1);
      }
      for (const [project, count] of byProject) {
        activeSessions.push({ project, count, lastSeen: new Date().toISOString() });
      }
    }
  } catch {}

  return NextResponse.json({
    generated: new Date().toISOString(),
    totalFiles: index?.total || 0,
    graphNodes: graph?.nodes?.length || 0,
    graphEdges: graph?.edges?.length || 0,
    totalEvents: eventCount,
    semanticEvents: semCount,
    pendingIngest: pendingCount,
    insights: insights?.total || 0,
    dormantSkills: skillStats ? Object.values(skillStats.skills || {}).filter((s: any) => s.invocationCount === 0).length : 0,
    projectsWithMemory: memory?.projects?.filter((p: any) => p.memoryFileCount > 0).length || 0,
    health: {
      engine:  statusLight(engineAge),
      watcher: statusLight(watcherAge),
      ingest:  statusLight(ingestAge),
    },
    activeSessions,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
