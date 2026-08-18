import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

export async function GET(req: NextRequest) {
  const raw = parseInt(req.nextUrl.searchParams.get('n') || '100', 10);
  const n = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);

  const p = path.join(OUTPUT, 'agent-events.log.json');
  if (!fs.existsSync(p)) {
    return NextResponse.json({ events: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim());
    const tail = lines.slice(-n);
    // Parse each line, skip malformed ones; result is oldest-first, newest last.
    const events = tail
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    return NextResponse.json({ events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ events: [], error: err.message }, { status: 500 });
  }
}
