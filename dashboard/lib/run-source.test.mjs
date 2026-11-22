import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRunViewSnapshot, readWarningThresholds } from './run-source.js';

const NOW_ISO = '2026-11-22T18:30:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

describe('run-source', () => {
  it('loads warning thresholds from dashboard/config/run-view-warnings.json', () => {
    const thresholds = readWarningThresholds();
    assert.equal(thresholds.stuckMinutes, 7);
    assert.equal(thresholds.quotaLowPercent, 20);
    assert.equal(thresholds.burningFastCallTokens, 100_000);
  });

  it('reads a JSON fixture via fixturePath and runs it through buildRunViewSnapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-source-fixture-'));
    const fixtureFile = join(dir, 'running.json');
    try {
      writeFileSync(fixtureFile, JSON.stringify({
        rawRun: {
          runId: 'fix-run-1',
          title: 'Fixture card: Run view live check',
          status: 'running',
          createdAt: new Date(NOW_MS - 15 * 60_000).toISOString(),
          updatedAt: new Date(NOW_MS - 30_000).toISOString(),
          initialState: { card: 'JUL-361', kind: 'product', buildRounds: 1 },
          steps: {
            start: { status: 'success', endedAt: NOW_MS - 14 * 60_000 },
            'attempt.build-round.flow-build': { status: 'running', startedAt: NOW_MS - 10 * 60_000 },
          },
        },
        rawLastRun: {
          title: 'Previous finished card',
          outcome: 'Finished',
          tokensLabel: '320 k tokens',
          estimatedDollarsLabel: 'about $1.10, estimate',
          endedAt: '2026-11-22T17:00:00.000Z',
        },
        spans: [
          {
            spanId: 'ag-fix',
            spanType: 'agent_run',
            name: "agent run: 'flow-build'",
            startedAt: NOW_MS - 10 * 60_000,
            endedAt: null,
          },
          {
            spanId: 'inf-fix',
            parentSpanId: 'ag-fix',
            spanType: 'model_inference',
            startedAt: NOW_MS - 2 * 60_000,
            endedAt: NOW_MS - 60_000,
            attributes: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-5',
              usage: { inputTokens: 115_000, outputTokens: 10_000 },
            },
          },
        ],
        subscriptions: [
          { id: 'claude', name: 'Claude', remainingPercent: 18 },
        ],
      }));

      const snapshot = await readRunViewSnapshot({ fixturePath: fixtureFile, now: NOW_MS });
      assert.equal(snapshot.sourceStatus, 'fixture');
      assert.equal(snapshot.updatedAt, NOW_ISO);
      assert.equal(snapshot.run.runId, 'fix-run-1');
      assert.equal(snapshot.run.title, 'Fixture card: Run view live check');
      assert.equal(snapshot.run.status, 'running');
      assert.equal(snapshot.run.helpers.length, 1);
      assert.equal(snapshot.lastRun.title, 'Previous finished card');
      assert.equal(snapshot.subscriptions.length, 1);
      // Both quota_low (18% <= 20%) and burning_fast (125k > 100k) must fire through the real model
      const kinds = snapshot.warnings.map(w => w.kind).sort();
      assert.deepEqual(kinds, ['burning_fast', 'quota_low']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fetches read-only from Mastra Studio endpoints and builds the live snapshot', async () => {
    const requestedUrls = [];
    const fetchImpl = async (url) => {
      requestedUrls.push(String(url));
      if (String(url).includes('/api/workflows/card-path/runs?perPage=5')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            runs: [
              { runId: 'live-1', snapshot: { status: 'running', value: { card: 'JUL-361' } } },
              {
                runId: 'live-0',
                updatedAt: '2026-11-22T16:00:00.000Z',
                snapshot: {
                  status: 'success',
                  value: { card: 'JUL-360', title: 'Earlier card', stopped: false },
                  context: {},
                },
              },
            ],
          }),
        };
      }
      if (String(url).includes('/api/workflows/card-path/runs/live-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            runId: 'live-1',
            status: 'running',
            createdAt: new Date(NOW_MS - 12 * 60_000).toISOString(),
            updatedAt: new Date(NOW_MS - 30_000).toISOString(),
            initialState: { card: 'JUL-361', kind: 'product', buildRounds: 1 },
            steps: {
              start: { status: 'success', endedAt: NOW_MS - 11 * 60_000 },
              'attempt.build-round.start-build': {
                status: 'success',
                endedAt: NOW_MS - 10 * 60_000,
                output: { prompt: 'Linear card JUL-361: Live studio test card\n\nBody' },
              },
              'attempt.build-round.flow-build': { status: 'running', startedAt: NOW_MS - 10 * 60_000 },
            },
          }),
        };
      }
      if (String(url).includes('/api/observability/traces?perPage=200')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            spans: [
              {
                spanId: 'sp-agent',
                spanType: 'agent_run',
                name: "agent run: 'flow-build'",
                startedAt: NOW_MS - 9 * 60_000,
                endedAt: null,
              },
              {
                spanId: 'sp-tool',
                parentSpanId: 'sp-agent',
                spanType: 'tool_call',
                name: 'mastra_workspace_read_file',
                startedAt: NOW_MS - 2 * 60_000,
                endedAt: NOW_MS - 1 * 60_000,
                input: { path: 'dashboard/lib/run-view-model.js' },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const snapshot = await readRunViewSnapshot({
      studioUrl: 'http://127.0.0.1:4112',
      now: NOW_MS,
      subscriptions: [{ id: 'claude', name: 'Claude', remainingPercent: 72 }],
      fetchImpl,
    });

    assert.equal(snapshot.sourceStatus, 'live');
    assert.equal(requestedUrls.length, 3);
    assert.ok(requestedUrls[0].endsWith('/api/workflows/card-path/runs?perPage=5'));
    assert.ok(requestedUrls[1].endsWith('/api/workflows/card-path/runs/live-1'));
    assert.ok(requestedUrls[2].endsWith('/api/observability/traces?perPage=200'));

    assert.equal(snapshot.run.runId, 'live-1');
    assert.equal(snapshot.run.title, 'Live studio test card');
    assert.equal(snapshot.run.helpers[0].actions[0].label, 'Read run-view-model.js');
    assert.equal(snapshot.lastRun.title, 'Earlier card');
    assert.equal(snapshot.lastRun.outcome, 'Finished');
  });

  it('handles unreachable Studio gracefully while preserving subscriptions and quota_low warnings', async () => {
    const fetchImpl = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4112');
    };

    const snapshot = await readRunViewSnapshot({
      studioUrl: 'http://127.0.0.1:4112',
      now: NOW_MS,
      subscriptions: [{ id: 'claude', name: 'Claude', remainingPercent: 10 }],
      fetchImpl,
    });

    assert.equal(snapshot.sourceStatus, 'unavailable');
    assert.equal(snapshot.run, null);
    assert.equal(snapshot.lastRun, null);
    assert.equal(snapshot.subscriptions.length, 1);
    assert.equal(snapshot.warnings.length, 1);
    assert.equal(snapshot.warnings[0].kind, 'quota_low');
  });
});
