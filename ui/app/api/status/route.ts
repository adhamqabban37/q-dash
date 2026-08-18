import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

function safeJSON(p: string) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function countNDJSON(p: string): number {
  if (!fs.existsSync(p)) return 0;
  try {
    const c = fs.readFileSync(p, 'utf8');
    return c.split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

export async function GET() {
  const index   = safeJSON(path.join(OUTPUT, 'index.json'));
  const graph   = safeJSON(path.join(OUTPUT, 'graph.json'));
  const heatmap = safeJSON(path.join(OUTPUT, 'heatmap.json'));
  const eventCount = countNDJSON(path.join(OUTPUT, 'events.log.json'));
  const semCount   = countNDJSON(path.join(OUTPUT, 'semantic-events.json'));

  return NextResponse.json({
    totalFiles:    index?.total  || 0,
    graphNodes:    graph?.nodes?.length  || 0,
    graphEdges:    graph?.edges?.length  || 0,
    totalEvents:   eventCount,
    semanticEvents: semCount,
    heatmapEvents: heatmap?.totalEvents || 0,
    lastIndexed:   index?.generated  || null,
    lastGraph:     graph?.generated  || null,
    skills:        index?.skills?.length  || 0,
    agents:        index?.agents?.length  || 0,
    projects:      index?.projects?.length || 0,
    apis:          index?.apis?.length || 0,
    outputDir:     OUTPUT,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
