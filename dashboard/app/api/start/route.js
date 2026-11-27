import { startCard } from '../../../lib/card-session.mjs';
import { getCard } from '../../../lib/linear.js';
import { readSettings } from '../../../lib/model-settings.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const refusal = (message, status) => Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(request) {
  let identifier;
  try {
    ({ identifier } = await request.json());
  } catch {
    return refusal('Send the card to start.', 400);
  }
  if (typeof identifier !== 'string' || !/^JUL-\d+$/.test(identifier)) return refusal('Send the card to start.', 400);

  let card;
  try {
    card = await getCard(identifier);
  } catch (error) {
    return refusal(error.message, 502);
  }

  try {
    const started = await startCard(card, { model: readSettings().lead });
    return Response.json(started, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return refusal(error.message, error.status ?? 500);
  }
}
