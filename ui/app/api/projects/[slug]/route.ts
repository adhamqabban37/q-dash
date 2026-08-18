import { NextRequest, NextResponse } from 'next/server';
import { getProjectDetail } from '@/lib/projectScanner';

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const detail = getProjectDetail(params.slug);
    if (!detail) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
