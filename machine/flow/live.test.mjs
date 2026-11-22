import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  LIVE_FILE, cardOfContext, createLiveFeed, flowFeed, liveFeedForCard, liveFileIn, setLiveDir, spanLiveProcessor, stageEvents, stageHooks,
} from './live.mjs';

const quiet = { warn() {} };

const feedIn = (dir, name = 'JUL-1') => createLiveFeed({ file: join(dir, name, LIVE_FILE), logger: quiet });

const lines = (file) =>
  readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

const scratch = () => mkdtempSync(join(tmpdir(), 'live-feed-'));

test('each hook writes the line the Run view folds', () => {
  const dir = scratch();
  const feed = feedIn(dir);
  feed.run({ card: 'JUL-1', title: 'Show the run' });
  feed.stage({ stage: 'start-build', status: 'started' });
  feed.stage({ stage: 'start-build', status: 'done' });
  feed.agent({ agent: 'flow-build', spanId: 'span-a', status: 'started' });
  feed.tool({ agent: 'flow-build', callId: 'span-t', name: 'mastra_workspace_read_file', status: 'done' });
  feed.model({ agent: 'flow-build', model: 'claude-opus-5-5', spanId: 'span-m', inputTokens: 1200, outputTokens: 300, cachedInputTokens: 400 });
  feed.tasks({ agent: 'flow-build', tasks: [{ id: 'playbook_1', title: 'Trace', status: 'completed' }] });

  const written = lines(liveFileIn(dir, 'JUL-1'));
  assert.deepEqual(written.map((event) => event.type), ['run', 'stage', 'stage', 'agent', 'tool', 'model', 'tasks']);
  assert.equal(written[0].title, 'Show the run');
  assert.deepEqual([written[1].stage, written[1].status, written[1].attempt], ['start-build', 'started', 1]);
  assert.deepEqual([written[2].status, written[2].attempt], ['done', 1]);
  assert.equal(written[4].callId, 'span-t');
  assert.deepEqual([written[5].inputTokens, written[5].outputTokens, written[5].cachedInputTokens], [1200, 300, 400]);
  assert.equal(written[6].tasks[0].status, 'completed');
  assert.ok(written.every((event) => typeof event.id === 'string' && Number.isFinite(event.at)));
});

test('the same event seen twice writes one line and a second attempt is its own event', () => {
  const dir = scratch();
  const feed = feedIn(dir);
  const span = { id: 'span-t', type: 'tool_call', name: 'skill', endTime: new Date(), parent: null, entityName: 'Lead' };
  feed.observeSpan({ ...span, endTime: undefined });
  feed.observeSpan({ ...span, endTime: undefined });
  feed.observeSpan(span);
  feed.observeSpan(span);
  feed.stage({ stage: 'build-check', status: 'started' });
  feed.stage({ stage: 'build-check', status: 'done' });
  feed.stage({ stage: 'build-check', status: 'started' });

  const written = lines(liveFileIn(dir, 'JUL-1'));
  assert.deepEqual(written.map((event) => `${event.type}:${event.status ?? ''}`), [
    'tool:started', 'tool:done', 'stage:started', 'stage:done', 'stage:started',
  ]);
  assert.equal(written.at(-1).attempt, 2);
});

test('a span is read as the agent that ran it, with the span own end and error', () => {
  const dir = scratch();
  const feed = feedIn(dir);
  // The shape Mastra hands the processor: the name is a label ("agent run: '<id>'") and the
  // id the screen knows is on entityId.
  const lead = { id: 'span-a', type: 'agent_run', name: "agent run: 'flow-build'", entityId: 'flow-build', entityName: 'Flow build', parent: null };
  const helper = {
    id: 'span-h', type: 'agent_run', name: "agent run: 'pstack-feature-refactoring-1'",
    entityId: 'pstack-feature-refactoring-1', entityName: 'Feature refactoring', parent: lead,
  };
  const tool = { id: 'span-t', type: 'tool_call', name: 'skill', parent: helper, attributes: {} };
  const model = { id: 'span-m', type: 'model_inference', parent: helper, endTime: new Date(), attributes: { model: 'cc/lead', usage: { inputTokens: 10, outputTokens: 2 } } };
  const failed = { id: 'span-f', type: 'tool_call', name: 'skill', endTime: new Date(), errorInfo: { message: 'no' }, parent: helper };

  [lead, helper, tool, model, failed].forEach((span) => feed.observeSpan(span));

  const written = lines(liveFileIn(dir, 'JUL-1'));
  assert.deepEqual(written.filter((event) => event.type === 'agent').map((event) => [event.agent, event.status]), [
    ['flow-build', 'started'],
    ['pstack-feature-refactoring-1', 'started'],
  ]);
  assert.equal(written.find((event) => event.callId === 'span-t').agent, 'pstack-feature-refactoring-1');
  assert.equal(written.find((event) => event.callId === 'span-t').status, 'started');
  assert.equal(written.find((event) => event.callId === 'span-f').status, 'failed');
  assert.equal(written.find((event) => event.type === 'model').model, 'cc/lead');
});

test('every append is one whole line, so a reader never sees half an event', () => {
  const dir = scratch();
  const appended = [];
  const feed = createLiveFeed({ file: join(dir, 'x', LIVE_FILE), append: (file, chunk) => appended.push(chunk), logger: quiet });
  feed.run({ card: 'JUL-1', title: 'a "quoted" title' });
  feed.tasks({ agent: 'flow-build', tasks: [{ id: 'a', title: 'line\nbreak', status: 'pending' }] });
  assert.equal(appended.length, 2);
  for (const chunk of appended) {
    assert.equal(chunk.split('\n').length, 2);
    assert.equal(chunk.at(-1), '\n');
    JSON.parse(chunk);
  }
});

test('a stage announces its start, then how it ended', async () => {
  const dir = scratch();
  const feed = feedIn(dir);
  const ran = await stageEvents('build-check', async (context) => `did ${context.n}`, () => feed)({ n: 2 });
  assert.equal(ran, 'did 2');
  await assert.rejects(stageEvents('shipping', async () => { throw new Error('refused'); }, () => feed)());
  const written = lines(liveFileIn(dir, 'JUL-1'));
  assert.deepEqual(written.map((event) => `${event.stage}:${event.status}`), [
    'build-check:started', 'build-check:done', 'shipping:started', 'shipping:failed',
  ]);
  await stageEvents('land', async () => 'no feed', () => null)();
});

test('a stage that asks to wait says so, and reads as done only once it is resumed and finishes', async () => {
  const dir = scratch();
  const feed = feedIn(dir);
  // The engine hands a step a suspend that returns as if the step had finished, so the
  // wrapper has to count the request itself: a suspended stage is waiting, not done.
  let suspended = null;
  const context = {
    suspend: async (payload) => { suspended = payload; },
  };
  await stageEvents('acceptance', async (step) => step.suspend({ request: 'JUL-1/build-1' }), () => feed)(context);
  assert.deepEqual(suspended, { request: 'JUL-1/build-1' });
  assert.deepEqual(lines(liveFileIn(dir, 'JUL-1')).map((event) => `${event.stage}:${event.status}`), [
    'acceptance:started', 'acceptance:waiting',
  ]);

  // Resuming runs the stage again: it is working, then done.
  await stageEvents('acceptance', async () => 'answered', () => feed)(context);
  assert.deepEqual(lines(liveFileIn(dir, 'JUL-1')).map((event) => `${event.stage}:${event.status}`).slice(-2), [
    'acceptance:started', 'acceptance:done',
  ]);
});

test('a stage with no way to wait still ends the way it ended', async () => {
  const dir = scratch();
  const feed = feedIn(dir);
  assert.equal(await stageEvents('build-check', async () => 'checked', () => feed)({ n: 1 }), 'checked');
  assert.deepEqual(lines(liveFileIn(dir, 'JUL-1')).map((event) => `${event.stage}:${event.status}`), [
    'build-check:started', 'build-check:done',
  ]);
});

test('a write that fails logs once and leaves the run going', () => {
  const dir = scratch();
  const warnings = [];
  const feed = createLiveFeed({
    file: join(dir, 'x', LIVE_FILE),
    append: () => { throw new Error('read-only'); },
    logger: { warn: (message) => warnings.push(message) },
  });
  assert.doesNotThrow(() => {
    feed.stage({ stage: 'start', status: 'started' });
    feed.stage({ stage: 'start', status: 'done' });
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /read-only/);
});

test('one feed per run file, and the run directory is resolved from the flow directory', () => {
  const dir = scratch();
  setLiveDir(dir);
  const first = liveFeedForCard(dir, 'JUL-2');
  const second = liveFeedForCard(dir, 'JUL-2');
  assert.equal(first, second);
  assert.equal(first.file, liveFileIn(dir, 'JUL-2'));
  assert.equal(liveFeedForCard(dir, ''), null);
  setLiveDir(null);
  assert.equal(liveFeedForCard(null, 'JUL-2'), null);
});

test('a stage finds its feed from the card the workflow carries', () => {
  const dir = scratch();
  const feed = flowFeed(dir)({ state: { card: 'JUL-7' }, inputData: {} });
  assert.equal(feed.file, liveFileIn(dir, 'JUL-7'));
  assert.equal(flowFeed(dir)({ state: {}, inputData: { card: 'JUL-8' } }).file, liveFileIn(dir, 'JUL-8'));
  assert.equal(flowFeed(dir)({ state: {}, inputData: {} }), null);
});

test('a stage runs through the hooks with its card, name and outcome', async () => {
  const dir = scratch();
  const hooks = stageHooks(dir);
  const context = { state: { card: 'JUL-9' }, inputData: {} };
  hooks.run(context, 'JUL-9', 'Run view');
  assert.equal(await hooks.staged('build-check', async () => 'checked')(context), 'checked');
  const events = lines(liveFileIn(dir, 'JUL-9'));
  assert.deepEqual(events.map(e => [e.type, e.stage ?? e.title, e.status]), [
    ['run', 'Run view', undefined],
    ['stage', 'build-check', 'started'],
    ['stage', 'build-check', 'done'],
  ]);
  await hooks.staged('land', async () => {})({ state: {}, inputData: {} });
  assert.equal(lines(liveFileIn(dir, 'JUL-9')).length, 3);
});

test('a tool call finds its card on the request context or the agent resource', () => {
  const get = (values) => (key) => values[key];
  assert.equal(cardOfContext({ requestContext: { get: get({ flowCard: 'JUL-3', mastra__resourceId: 'JUL-4' }) } }), 'JUL-3');
  assert.equal(cardOfContext({ requestContext: { get: get({ mastra__resourceId: 'JUL-4' }) } }), 'JUL-4');
  assert.equal(cardOfContext({ agent: { resourceId: 'JUL-5' } }), 'JUL-5');
  assert.equal(cardOfContext({}), '');
});

test('the span processor returns the very span it was given, even when the feed throws', async () => {
  const dir = scratch();
  const span = { id: 'span-a', type: 'agent_run', name: 'flow-build' };
  const processor = spanLiveProcessor(feedIn(dir));
  assert.equal(processor.process(span), span);
  assert.equal(processor.process(undefined), undefined);
  assert.equal(spanLiveProcessor(null).process(span), span);
  const broken = spanLiveProcessor({ observeSpan() { throw new Error('boom'); } });
  assert.equal(broken.process(span), span);
  await processor.shutdown();
});

test('the writer leaves an existing file of a finished run alone', () => {
  const dir = scratch();
  const file = join(dir, 'JUL-6', LIVE_FILE);
  mkdirSync(join(dir, 'JUL-6'), { recursive: true });
  writeFileSync(file, '{"id":"run:JUL-6","at":1,"type":"run","card":"JUL-6","title":"old"}\n');
  feedIn(dir, 'JUL-6').run({ card: 'JUL-6', title: 'new' });
  const written = lines(file);
  assert.equal(written.length, 2);
  assert.equal(written.at(-1).title, 'new');
});
