import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WARNING_THRESHOLDS,
  STEP_STATE_TABLE,
  RUN_STATE_TABLE,
  HELPER_STATUS_TABLE,
  formatTokens,
  formatElapsed,
  formatEstimatedDollars,
  describeSpanAction,
  parseHelpersFromSpans,
  evaluateWarnings,
  buildRunViewSnapshot,
} from './run-view-model.js';

const NOW_ISO = '2026-11-22T18:30:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

const MOCK_PRICE_CATALOG = {
  source: "test",
  costs: {
  anthropic: {
    models: {
      'claude-sonnet-4-5': {
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
  },
};

describe('run-view-model formatters and state tables', () => {
  it('formats tokens, elapsed duration, and estimated dollars', () => {
    assert.equal(formatTokens(1_840_000), '1.84 M tokens');
    assert.equal(formatTokens(412_000), '412 k tokens');
    assert.equal(formatTokens(850), '850 tokens');
    assert.equal(formatTokens(0), '0 tokens');

    assert.equal(formatElapsed(72 * 60_000), '1 h 12 min');
    assert.equal(formatElapsed(14 * 60_000), '14 min');
    assert.equal(formatElapsed(20_000), '< 1 min');

    assert.equal(formatEstimatedDollars(2.4), 'about $2.40, estimate');
    assert.equal(formatEstimatedDollars(0), 'about $0.00, estimate');
    assert.equal(formatEstimatedDollars(null), 'estimate unavailable');
  });

  it('defines explicit state tables for all step, run, and helper states', () => {
    for (const key of ['running', 'passed', 'passed_with_notes', 'sent_back', 'stuck', 'given_up', 'upcoming']) {
      assert.ok(STEP_STATE_TABLE[key], `missing step state ${key}`);
      assert.equal(STEP_STATE_TABLE[key].state, key);
    }
    for (const key of ['running', 'waiting_for_you', 'finished', 'stopped', 'stuck', 'given_up']) {
      assert.ok(RUN_STATE_TABLE[key], `missing run state ${key}`);
      assert.equal(RUN_STATE_TABLE[key].state, key);
      assert.ok(RUN_STATE_TABLE[key].label.length > 0);
    }
    for (const key of ['working', 'done', 'stuck', 'stopped']) {
      assert.ok(HELPER_STATUS_TABLE[key], `missing helper status ${key}`);
    }
  });

  it('translates Mastra tool and skill spans into plain English', () => {
    assert.equal(
      describeSpanAction({
        spanType: 'tool_call',
        name: 'mastra_workspace_read_file',
        input: { path: '/home/ubuntu/repo/dashboard/lib/run-source.js' },
      }),
      'Read run-source.js',
    );
    assert.equal(
      describeSpanAction({
        spanType: 'tool_call',
        name: 'mastra_workspace_write_file',
        input: { path: 'dashboard/app/page.jsx' },
      }),
      'Wrote page.jsx',
    );
    assert.equal(
      describeSpanAction({
        spanType: 'tool_call',
        name: 'mastra_workspace_execute_command',
        input: { command: 'node --test' },
      }),
      'Ran command',
    );
    assert.equal(
      describeSpanAction({
        spanType: 'skill_action',
        name: 'skill',
        input: { name: 'tdd' },
      }),
      'Loaded skill tdd',
    );
  });
});

describe('run-view-model helper span parsing', () => {
  it('parses spans into helper cards with newest-first actions, token totals, and burning-fast detection', () => {
    const spans = [
      {
        spanId: 'agent-1',
        spanType: 'agent_run',
        name: "agent run: 'flow-build'",
        startedAt: NOW_MS - 5 * 60_000,
        endedAt: null,
        attributes: { agentId: 'flow-build' },
      },
      {
        spanId: 'tool-1',
        parentSpanId: 'agent-1',
        spanType: 'tool_call',
        name: 'mastra_workspace_read_file',
        startedAt: NOW_MS - 4 * 60_000,
        endedAt: NOW_MS - 3.5 * 60_000,
        input: { path: 'machine/flow/workflow.mjs' },
      },
      {
        spanId: 'skill-1',
        parentSpanId: 'agent-1',
        spanType: 'skill_action',
        name: 'skill',
        startedAt: NOW_MS - 3 * 60_000,
        endedAt: NOW_MS - 2.9 * 60_000,
        input: { skill: 'tdd' },
      },
      {
        spanId: 'tool-2',
        parentSpanId: 'agent-1',
        spanType: 'tool_call',
        name: 'mastra_workspace_execute_command',
        startedAt: NOW_MS - 1 * 60_000,
        endedAt: null,
        input: { command: 'node --test' },
      },
      {
        spanId: 'inf-1',
        parentSpanId: 'agent-1',
        spanType: 'model_inference',
        name: 'model inference',
        startedAt: NOW_MS - 2 * 60_000,
        endedAt: NOW_MS - 1.5 * 60_000,
        attributes: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          usage: { inputTokens: 110_000, outputTokens: 15_000 },
        },
      },
    ];

    const parsed = parseHelpersFromSpans(spans, {
      now: NOW_MS,
      thresholds: DEFAULT_WARNING_THRESHOLDS,
      catalog: MOCK_PRICE_CATALOG,
      corrections: {},
    });

    assert.equal(parsed.helpers.length, 1);
    const helper = parsed.helpers[0];
    assert.equal(helper.id, 'agent-1');
    assert.equal(helper.status, 'working');
    assert.equal(helper.statusLabel, 'Working');
    assert.equal(helper.tokens, 125_000);
    assert.equal(helper.tokensLabel, '125 k tokens');

    // Actions must be sorted newest first
    assert.deepEqual(
      helper.actions.map(action => ({ label: action.label, state: action.state })),
      [
        { label: 'Ran command', state: 'now' },
        { label: 'Loaded skill tdd', state: 'done' },
        { label: 'Read workflow.mjs', state: 'done' },
      ],
    );

    assert.equal(parsed.totalTokens, 125_000);
    assert.ok(parsed.estimatedDollars > 0);
    assert.equal(parsed.burningFastCalls.length, 1);
    assert.equal(parsed.burningFastCalls[0].agentName, helper.name);
    assert.equal(parsed.burningFastCalls[0].tokens, 125_000);
  });
});

describe('run-view-model warnings and full snapshot building', () => {
  it('evaluates all four warning types with plain-English messages', () => {
    const warnings = evaluateWarnings({
      runStatus: 'stopped',
      stopWhy: 'Card cost limit $5.00 reached',
      stuckInfo: { minutes: 9, targetName: 'Build the slices' },
      burningFastCalls: [{ agentName: 'Build helper', tokens: 145_000 }],
      subscriptions: [
        { id: 'claude', name: 'Claude', status: 'ok', percentLeft: 14 },
        { id: 'openai', name: 'OpenAI', status: 'ok', percentLeft: 65 },
        { id: 'commandcode', name: 'CommandCode', status: 'unknown' },
      ],
      thresholds: DEFAULT_WARNING_THRESHOLDS,
    });

    const byKind = Object.fromEntries(warnings.map(warning => [warning.kind, warning]));
    assert.equal(byKind.stopped.borderStyle, 'solid');
    assert.equal(byKind.stopped.severity, 'danger');
    assert.match(byKind.stopped.message, /Card cost limit/);

    assert.equal(byKind.stuck.borderStyle, 'dashed');
    assert.equal(byKind.stuck.severity, 'warning');
    assert.match(byKind.stuck.message, /9 min/);

    assert.equal(byKind.quota_low.borderStyle, 'dashed');
    assert.equal(byKind.quota_low.severity, 'warning');
    assert.match(byKind.quota_low.message, /Claude/);
    assert.match(byKind.quota_low.message, /14%/);

    assert.equal(byKind.burning_fast.borderStyle, 'dashed');
    assert.equal(byKind.burning_fast.severity, 'warning');
    assert.match(byKind.burning_fast.message, /Build helper/);
    assert.match(byKind.burning_fast.message, /145 k tokens/);
  });

  it('builds a running snapshot with card title by name, active step, and estimated dollars', () => {
    const rawRun = {
      runId: 'run-123',
      status: 'running',
      createdAt: new Date(NOW_MS - 14 * 60_000).toISOString(),
      updatedAt: new Date(NOW_MS - 1 * 60_000).toISOString(),
      initialState: {
        card: 'JUL-361',
        kind: 'product',
        buildRounds: 1,
        reviewRound: 0,
        failCount: 0,
        stopped: false,
      },
      steps: {
        start: { status: 'success', startedAt: NOW_MS - 14 * 60_000, endedAt: NOW_MS - 13 * 60_000 },
        'attempt.build-round.start-build': {
          status: 'success',
          startedAt: NOW_MS - 13 * 60_000,
          endedAt: NOW_MS - 12 * 60_000,
          output: {
            prompt: "Linear card JUL-361: Mission control's Run view shows a running card\n\n## Goal\n...",
          },
        },
        'attempt.build-round.flow-build': {
          status: 'running',
          startedAt: NOW_MS - 12 * 60_000,
        },
      },
    };

    const spans = [
      {
        spanId: 'ag-1',
        spanType: 'agent_run',
        name: "agent run: 'flow-build'",
        startedAt: NOW_MS - 12 * 60_000,
        endedAt: null,
      },
      {
        spanId: 'inf-1',
        parentSpanId: 'ag-1',
        spanType: 'model_inference',
        startedAt: NOW_MS - 2 * 60_000,
        endedAt: NOW_MS - 1 * 60_000,
        attributes: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          usage: { inputTokens: 80_000, outputTokens: 10_000 },
        },
      },
    ];

    const snapshot = buildRunViewSnapshot({
      now: NOW_MS,
      sourceStatus: 'live',
      rawRun,
      spans,
      subscriptions: [{ id: 'claude', name: 'Claude', remainingPercent: 80 }],
      catalog: MOCK_PRICE_CATALOG,
      corrections: {},
    });

    assert.equal(snapshot.sourceStatus, 'live');
    assert.equal(snapshot.warnings.length, 0);
    assert.ok(snapshot.run);
    assert.equal(snapshot.run.runId, 'run-123');
    assert.equal(snapshot.run.title, "Mission control's Run view shows a running card");
    assert.equal(snapshot.run.status, 'running');
    assert.equal(snapshot.run.elapsedLabel, '14 min');
    assert.equal(snapshot.run.currentStageId, 'build');
    assert.equal(snapshot.run.currentStageName, 'Build');
    assert.equal(snapshot.run.currentStepName, 'Build the slices');
    assert.equal(snapshot.run.roundNumber, 1);
    assert.match(snapshot.run.estimatedDollarsLabel, /^about \$\d+\.\d{2}, estimate$/);
  });

  it('maps waiting_for_you, stuck, given_up, passed_with_notes, sent_back, and dynamic stages', () => {
    const waitingSnap = buildRunViewSnapshot({
      now: NOW_MS,
      sourceStatus: 'fixture',
      rawRun: {
        runId: 'run-uat',
        title: 'Run view UAT check',
        status: 'suspended',
        createdAt: new Date(NOW_MS - 30 * 60_000).toISOString(),
        initialState: { card: 'JUL-361', kind: 'product', reviewRound: 1, buildRounds: 1, failCount: 0 },
        steps: {
          start: { status: 'success', endedAt: NOW_MS - 29 * 60_000 },
          'attempt.build-round.flow-build': { status: 'success', endedAt: NOW_MS - 20 * 60_000 },
          'attempt.review-phase.review-round.shipping': { status: 'success', endedAt: NOW_MS - 15 * 60_000 },
          'attempt.review-phase.review-round.verdict': {
            status: 'success',
            endedAt: NOW_MS - 14 * 60_000,
            output: { verdict: 'PASS+NOTES', detail: 'Minor copy tweak noted' },
          },
          'attempt.acceptance': { status: 'suspended', startedAt: NOW_MS - 10 * 60_000 },
        },
      },
    });

    assert.equal(waitingSnap.run.status, 'waiting_for_you');
    assert.equal(waitingSnap.run.currentStageId, 'after-merge');
    const shippingStage = waitingSnap.run.stages.find(stage => stage.id === 'shipping');
    assert.equal(shippingStage.steps[0].state, 'passed_with_notes');
    // Waiting for Todd should NOT trigger a stuck warning
    assert.equal(waitingSnap.warnings.some(w => w.kind === 'stuck'), false);

    const stuckSnap = buildRunViewSnapshot({
      now: NOW_MS,
      sourceStatus: 'fixture',
      rawRun: {
        runId: 'run-stuck',
        title: 'Stuck build test',
        status: 'running',
        createdAt: new Date(NOW_MS - 20 * 60_000).toISOString(),
        updatedAt: new Date(NOW_MS - 10 * 60_000).toISOString(),
        initialState: { card: 'JUL-362', kind: 'product', buildRounds: 2, checkReturns: 1 },
        steps: {
          start: { status: 'success', endedAt: NOW_MS - 19 * 60_000 },
          'attempt.build-round.flow-build': { status: 'running', startedAt: NOW_MS - 10 * 60_000 },
          'attempt.build-round.build-check': { status: 'success', output: { checkPassed: false, checkReason: 'Lint failed' } },
        },
      },
    });

    assert.equal(stuckSnap.run.status, 'stuck');
    assert.ok(stuckSnap.warnings.some(w => w.kind === 'stuck'));
    const buildStage = stuckSnap.run.stages.find(stage => stage.id === 'build');
    assert.equal(buildStage.steps.find(s => s.id === 'build-slices').state, 'stuck');
    assert.equal(buildStage.steps.find(s => s.id === 'open-pr').state, 'sent_back');

    const givenUpSnap = buildRunViewSnapshot({
      now: NOW_MS,
      sourceStatus: 'fixture',
      rawRun: {
        runId: 'run-given-up',
        title: 'Given up card',
        status: 'success',
        createdAt: new Date(NOW_MS - 40 * 60_000).toISOString(),
        updatedAt: new Date(NOW_MS - 2 * 60_000).toISOString(),
        initialState: {
          card: 'JUL-363',
          kind: 'product',
          failCount: 2,
          stopped: true,
          stopWhy: 'Failed verification twice',
        },
        steps: {
          start: { status: 'success' },
          'attempt.review-phase.review-round.verdict': { status: 'success', output: { verdict: 'FAIL', failCount: 2 } },
          'deploy-check': { status: 'success' },
        },
      },
    });

    assert.equal(givenUpSnap.run.status, 'given_up');
    assert.ok(givenUpSnap.warnings.some(w => w.kind === 'stopped'));
    assert.ok(givenUpSnap.run.stages.some(stage => stage.id === 'deploy-check' && stage.name === 'Deploy check'));
  });

  it('still emits quota_low warnings when Studio is unavailable and run is null', () => {
    const snap = buildRunViewSnapshot({
      now: NOW_MS,
      sourceStatus: 'unavailable',
      rawRun: null,
      subscriptions: [{ id: 'claude', name: 'Claude', remainingPercent: 12 }],
    });

    assert.equal(snap.sourceStatus, 'unavailable');
    assert.equal(snap.run, null);
    assert.equal(snap.warnings.length, 1);
    assert.equal(snap.warnings[0].kind, 'quota_low');
  });
});
