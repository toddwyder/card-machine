// The words a stop leaves behind are the same wherever the card stops.
import { writePostFailure } from './scratch.mjs';

export function tripwireStop({ reason, processorId, metadata } = {}) {
  const id = metadata?.processorId ?? processorId ?? '';
  if (id === 'token-cost-control') {
    if (metadata?.maxCost != null && metadata?.usage?.estimatedCost != null) {
      const limit = Number(metadata.maxCost);
      const spend = Number(metadata.usage.estimatedCost);
      return {
        stopPart: 'Spending',
        stopWhy: `Card cost limit $${limit.toFixed(2)} reached (card spend: $${spend.toFixed(4)})`,
      };
    }
    return {
      stopPart: 'Spending',
      stopWhy: String(reason || 'Cost check unavailable'),
    };
  }
  if (metadata?.part === 'Playbook' || metadata?.part === 'Resources') {
    return { stopPart: metadata.part, stopWhy: String(metadata?.reason ?? reason ?? `${metadata.part} check failed`) };
  }
  if (metadata?.observerFailure || /observational-memory/i.test(`${id} ${reason ?? ''}`)) {
    return { stopPart: 'Memory', stopWhy: `Memory model failed: ${String(reason ?? 'unknown error')}` };
  }
  return { stopPart: id || 'Agent', stopWhy: String(reason ?? 'Agent aborted') };
}

export function withLowestFreeRam(state, memoryWatch) {
  if (!state?.buildStartedAt || typeof memoryWatch?.lowest !== 'function') return state;
  const found = memoryWatch.lowest({ since: state.buildStartedAt, until: new Date().toISOString() });
  if (!found) return state;
  return { ...state, lowestFreeRamMb: found.lowestMb, lowestFreeRamAt: found.at };
}

export function reportText(state, detail) {
  const memoryLine = state.lowestFreeRamMb != null
    ? [`Lowest free RAM: ${state.lowestFreeRamMb} MB (at ${state.lowestFreeRamAt})`]
    : (state.buildStartedAt ? ['Lowest free RAM: unavailable (no samples recorded during build)'] : []);
  return [
    `# ${state.card} stopped`,
    '',
    `Part: ${state.stopPart || 'unknown'}`,
    `Why: ${state.stopWhy || 'no reason recorded'}`,
    `Check returns: ${state.checkReturns ?? 0}`,
    `Shipping failures: ${state.failCount}`,
    `Failures counted: ${state.failCount}`,
    `Shipping rounds: ${state.reviewRound}`,
    `Build rounds: ${state.buildRounds}`,
    ...memoryLine,
    ...(state.copy ? [`Copy: ${state.copy}`, `Started from main at: ${state.base}`] : []),
    `Last detail: ${detail || 'none'}`,
    '',
    'A second failure stops the card; the next step is an Investigation.',
  ].join('\n');
}

export const acceptanceWaitMessage = (card, request) =>
  `${card} is paused at acceptance (${request}), waiting for Todd's yes/no answer in Mastra Studio.`;

export async function notifyCard(review, card, body, cardDir) {
  if (!review?.postCardComment || !card || !body) return;
  try {
    await review.postCardComment(card, body);
  } catch (error) {
    if (!cardDir) return;
    const message = error instanceof Error ? error.message : String(error);
    writePostFailure(cardDir, card, message);
  }
}
