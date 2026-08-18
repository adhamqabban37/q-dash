import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const MEMORY = path.join(process.cwd(), '..', 'output', 'memory-index.json');

function safeJSON(p: string) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

export async function GET() {
  const idx = safeJSON(MEMORY);
  if (!idx) {
    return NextResponse.json({ generated: new Date().toISOString(), totalProjects: 0, projects: [] });
  }
  return NextResponse.json(idx, { headers: { 'Cache-Control': 'no-store' } });
}
