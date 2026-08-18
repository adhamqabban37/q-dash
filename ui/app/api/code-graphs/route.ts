import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const OUTPUT = path.join(process.cwd(), '..', 'output');

export async function GET() {
  const p = path.join(OUTPUT, 'code-graphs.json');
  if (!fs.existsSync(p)) return NextResponse.json({ graphs: [], total: 0 });
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ graphs: [], error: err.message }, { status: 500 });
  }
}
