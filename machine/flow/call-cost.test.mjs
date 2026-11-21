import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallCostControl } from './call-cost.mjs';

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
