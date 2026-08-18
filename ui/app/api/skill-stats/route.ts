import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const REGISTRY = path.join(process.cwd(), '..', 'output', 'skill-registry.json');
const STATS    = path.join(process.cwd(), '..', 'output', 'skill-stats.json');

function safeJSON(p: string) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export async function GET() {
  const registry = safeJSON(REGISTRY);
  const stats    = safeJSON(STATS);
  const skills = registry?.skills || [];
  const skillStats = stats?.skills || {};

  const enriched = skills.map((s: any) => {
    const st = skillStats[s.name] || { invocationCount: 0, lastUsed: null, projects: [] };
    return {
      name: s.name,
      description: s.description,
      path: s.path,
      source: s.source,
      invocationCount: st.invocationCount,
      lastUsed: st.lastUsed,
      projects: st.projects || [],
      dormant: st.invocationCount === 0 && (!st.lastUsed || (Date.now() - new Date(st.lastUsed).getTime() > 7 * 24 * 60 * 60 * 1000)),
    };
  });

  return NextResponse.json({
    generated: new Date().toISOString(),
    total: enriched.length,
    dormant: enriched.filter((s: any) => s.dormant).length,
    skills: enriched.sort((a: any, b: any) => b.invocationCount - a.invocationCount),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
