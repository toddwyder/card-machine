import { NextResponse } from 'next/server';
import { readRunViewSnapshot } from '#lib/run-source.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await readRunViewSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
