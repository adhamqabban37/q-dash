import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

const EMPTY = { generated: null, totalSessions: 0, sessions: [], live: [] };

export async function GET() {
  const p = path.join(OUTPUT, 'agent-sessions.json');
  if (!fs.existsSync(p)) {
    return NextResponse.json(EMPTY, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return NextResponse.json(
      {
        generated: data.generated ?? null,
        totalSessions: data.totalSessions ?? 0,
        sessions: data.sessions ?? [],
        live: data.live ?? [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json({ ...EMPTY, error: err.message }, { status: 500 });
  }
}
