import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

export async function GET() {
  const p = path.join(OUTPUT, 'sessions.json');
  if (!fs.existsSync(p)) return NextResponse.json({ sessions: [], totalSessions: 0 });
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Return sessions newest-first, strip heavy event arrays for list view
    const sessions = (data.sessions || [])
      .slice()
      .reverse()
      .slice(0, 50)
      .map((s: any) => ({ ...s, events: undefined }));
    return NextResponse.json(
      { sessions, totalSessions: data.totalSessions, generated: data.generated },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json({ sessions: [], error: err.message }, { status: 500 });
  }
}
