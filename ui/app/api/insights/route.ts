import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

export async function GET() {
  const p = path.join(OUTPUT, 'insights.json');
  if (!fs.existsSync(p)) return NextResponse.json({ insights: [], total: 0 });
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ insights: [], error: err.message }, { status: 500 });
  }
}
