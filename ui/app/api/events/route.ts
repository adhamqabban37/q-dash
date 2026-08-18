import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

function readNDJSON(filePath: string, limit: number) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const filled = lines.filter(l => l.trim());
    const tail = filled.slice(-limit);
    return tail.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '120');

  // Prefer semantic-events (richer), fall back to raw events
  const semPath  = path.join(OUTPUT, 'semantic-events.json');
  const rawPath  = path.join(OUTPUT, 'events.log.json');

  const semantic = readNDJSON(semPath, limit);
  const raw      = readNDJSON(rawPath, limit);

  // Merge: use semantic when available (keyed by path+timestamp)
  const semMap = new Map(semantic.map((e: any) => [`${e.path}|${e.timestamp}`, e]));
  const merged: any[] = [];
  const seen  = new Set<string>();

  for (const e of [...semantic, ...raw]) {
    const key = `${e.path}|${e.timestamp}`;
    if (!seen.has(key)) { seen.add(key); merged.push(semMap.get(key) || e); }
  }

  merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return NextResponse.json(
    { events: merged.slice(-limit), total: merged.length },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
