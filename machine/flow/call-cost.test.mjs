import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallCostControl } from './call-cost.mjs';
import { tripwireStop } from './report.mjs';

test('cost lookup failure prevents the next model step', async () => {
  const guard = new CallCostControl({ maxCost: 4, scope: 'resource' });
  guard.observability = { flush: async () => {} };
  guard.observabilityStorage = { getMetricAggregate: async () => { throw new Error('storage offline'); } };
  guard.logger = { warn() {} };
  let stopped;
  await guard.processInputStep({
    requestContext: new Map([['mastra__resourceId', 'JUL-361']]),
    state: {},
    abort: message => { stopped = message; },
  });
  assert.match(stopped ?? '', /cost.*(unavailable|failed)/i);
});

test('cost record read failure names the failure instead of a $0.00 spending limit', async () => {
  const guard = new CallCostControl({ maxCost: 7.48, scope: 'resource' });
  guard.observability = { flush: async () => {} };
  guard.observabilityStorage = {
    getMetricAggregate: async () => {
      throw new Error('FATAL Error: Failed: database has been invalidated');
    },
  };
  guard.logger = { warn() {} };
  let aborted;
  await guard.processInputStep({
    requestContext: new Map([['mastra__resourceId', 'JUL-361']]),
    state: {},
    abort: (reason, options) => { aborted = { reason, options }; },
  });
  const stop = tripwireStop({
    reason: aborted?.reason,
    processorId: guard.id,
    metadata: aborted?.options?.metadata,
  });
  assert.equal(stop.stopPart, 'Spending');
  assert.doesNotMatch(stop.stopWhy, /\$0\.00/);
  assert.match(stop.stopWhy, /Cost check unavailable:.*database has been invalidated/);

  const realLimit = tripwireStop({
    reason: 'Token cost limit exceeded',
    processorId: guard.id,
    metadata: { maxCost: 7.48, usage: { estimatedCost: 7.51 } },
  });
  assert.equal(realLimit.stopWhy, 'Card cost limit $7.48 reached (card spend: $7.5100)');
});
