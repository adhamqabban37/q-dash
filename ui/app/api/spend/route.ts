import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

const EMPTY = {
  generated: null,
  timezone: 'America/Chicago',
  totals: { events: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, durationMs: 0, lastActive: null },
  byAgent: {},
  byProject: {},
  byDay: {},
  byWeek: {},
};

export async function GET() {
  const p = path.join(OUTPUT, 'spend.json');
  if (!fs.existsSync(p)) {
    return NextResponse.json(EMPTY, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return NextResponse.json(
      { ...EMPTY, ...data },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json({ ...EMPTY, error: err.message }, { status: 500 });
  }
}
