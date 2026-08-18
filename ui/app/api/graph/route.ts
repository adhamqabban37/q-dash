import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

export async function GET(req: NextRequest) {
  const limit     = parseInt(req.nextUrl.searchParams.get('limit') || '6000');
  const typeFilter = req.nextUrl.searchParams.get('type') || '';
  const graphPath  = path.join(OUTPUT, 'graph.json');

  if (!fs.existsSync(graphPath)) {
    return NextResponse.json({ nodes: [], edges: [], error: 'graph.json not found' });
  }

  try {
    const raw = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    let nodes = raw.nodes || [];
    let edges = raw.edges || [];

    // Optional type filter
    if (typeFilter) {
      const types = typeFilter.split(',');
      nodes = nodes.filter((n: any) => types.includes(n.type));
    }

    // Limit nodes — keep by order (scanner visits most important dirs first)
    if (nodes.length > limit) nodes = nodes.slice(0, limit);

    const nodeIds = new Set(nodes.map((n: any) => n.id));
    // Keep edges where both ends are in the limited node set
    // Prioritise meaningful edges (agent-uses, wiki-link, shared-tag) over structural noise
    const PRIORITY: Record<string, number> = {
      'agent-uses': 0, 'project-uses-agent': 0.5,
      'wiki-link': 1, 'project-has-note': 1.5, 'project-uses-skill': 1.8,
      'shared-tag': 2, 'folder-sibling': 3, 'project-contains': 4,
    };
    edges = edges
      .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .sort((a: any, b: any) => {
        const pa = PRIORITY[a.relation] ?? (a.relation.startsWith('same-type') ? 5 : 6);
        const pb = PRIORITY[b.relation] ?? (b.relation.startsWith('same-type') ? 5 : 6);
        return pa - pb;
      })
      .slice(0, 15000);

    return NextResponse.json(
      { nodes, edges, total: raw.nodes?.length || 0, generated: raw.generated },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json({ nodes: [], edges: [], error: err.message }, { status: 500 });
  }
}
