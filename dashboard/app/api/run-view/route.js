import { readRunViewSnapshot } from '../../../lib/run-view-server.mjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const snapshot = await readRunViewSnapshot();
  return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
}
