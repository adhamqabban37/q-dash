import { NextResponse } from 'next/server';
import { getAllProjectCards } from '@/lib/projectScanner';

export async function GET() {
  try {
    const projects = getAllProjectCards();
    return NextResponse.json(
      { projects, total: projects.length },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    return NextResponse.json({ projects: [], total: 0, error: err.message }, { status: 500 });
  }
}
