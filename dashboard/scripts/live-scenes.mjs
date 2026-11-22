// The logs the Run view is tested against, written by the machine's own live writer.
// Nothing here states the file format: `createLiveFeed` decides what a line looks like, so a
// change to the writer reaches these logs and every test that folds or renders them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createLiveFeed, liveFileIn } from '../../machine/flow/live.mjs';

export const SCENES = Object.freeze(['running', 'burning', 'stuck', 'stopped', 'finished', 'quiet', 'torn', 'uat']);

const CARD = 'JUL-361';
const TITLE = "Mission control's Run view";
const LEAD = 'flow-build';
const HELPER = 'pstack-feature-refactoring-1';
const MODEL = 'commandcode/moonshotai/Kimi-K3.1-Pro';

// Every stage the machine has, in order, so a finished run in a test ends where a real one does.
const ALL_STAGES = Object.freeze([
  'start', 'start-build', 'flow-build', 'finish-build', 'build-check', 'shipping', 'verdict',
  'remediation', 'pass-note', 'gate', 'acceptance', 'machine-accept', 'land', 'smoke', 'smoke-pass',
  'stop-report', 'retro', 'cleanup', 'hold',
]);

const TASK_LIST = {
  // The Lead's list as the machine publishes it: one entry per playbook step, mid-way through,
  // with one step the run was told to skip and its reason left on the title.
  lead: [
    { id: 'playbook_1', title: 'Trace the affected subsystem', status: 'completed' },
    { id: 'playbook_2', title: 'Architect the shape', status: 'in_progress' },
    { id: 'playbook_3', title: 'Write the throughput checkpoint as four todo items', status: 'pending' },
    { id: 'playbook_4', title: 'Delegate code-writing to a subagent using your configured feature model', status: 'pending' },
    { id: 'playbook_5', title: 'Verify on the matching surface', status: 'pending' },
    { id: 'playbook_6', title: 'Rebase into small, ordered commits', status: 'pending' },
    { id: 'playbook_7', title: 'Interrogate the design skip: the arena settled it', status: 'pending' },
    { id: 'playbook_8', title: 'Run Opening a PR', status: 'pending' },
  ],
  helper: [
    { id: 'slice_1', title: 'Read the fold', status: 'completed' },
    { id: 'slice_2', title: 'Write the test', status: 'in_progress' },
  ],
};

// A writer whose clock the scene moves, so a log's times are only ever what the scene says.
function writer(file, startAt) {
  const lines = [];
  let clock = startAt;
  const feed = createLiveFeed({
    file,
    now: () => clock,
    append: (path, line) => lines.push(line),
    logger: { warn() {} },
  });
  return {
    feed,
    lines,
    advance(ms) {
      clock += ms;
      return clock;
    },
    get clock() {
      return clock;
    },
  };
}

function stagePair({ feed, advance }, stage, ms = 20000) {
  feed.stage({ stage, status: 'started' });
  advance(ms);
  feed.stage({ stage, status: 'done' });
}

// The work every scene shows: the plan stage, the builder's first slice with three tool calls,
// one model call, and the two lists of tasks.
function buildSlice({ feed, advance }, { tokens = 80000, tail = 3000 } = {}) {
  feed.agent({ agent: LEAD, spanId: 'lead-1', status: 'started' });
  stagePair({ feed, advance }, 'start', 12000);
  stagePair({ feed, advance }, 'start-build', 24000);
  feed.agent({ agent: HELPER, spanId: 'helper-1', status: 'started' });
  feed.stage({ stage: 'flow-build', status: 'started' });
  for (const [index, name] of ['mastra_workspace_read_file', 'mastra_workspace_execute_command', 'skill'].entries()) {
    feed.tool({ agent: HELPER, callId: `call-${index + 1}`, name, status: 'started' });
    advance(1800);
    feed.tool({ agent: HELPER, callId: `call-${index + 1}`, name, status: 'done' });
    advance(900);
  }
  feed.model({ agent: HELPER, model: MODEL, spanId: 'model-1', inputTokens: tokens, outputTokens: 2400 });
  advance(tail);
  feed.tasks({ agent: LEAD, tasks: TASK_LIST.lead });
  advance(500);
  feed.tasks({ agent: HELPER, tasks: TASK_LIST.helper });
  advance(500);
}

// What each scene does after the shared start, plus the run row the machine would have stored.
const SCENE_WORK = {
  running: {},
  burning: { model: { tokens: 240000 } },
  stuck: {},
  stopped: { stopped: true },
  finished: { finished: true },
  quiet: { none: true },
  torn: {},
  uat: { uat: true },
};

/**
 * Write one scene into `dir`: its live log and the run row the machine keeps beside it.
 * Returns the file the log went to, or null for the scene that has no log.
 */
export function writeScene(dir, scene, { now = Date.now(), card = CARD, title = TITLE, stateRow = true } = {}) {
  if (!SCENES.includes(scene)) throw new Error(`unknown scene ${scene}`);
  const work = SCENE_WORK[scene];
  mkdirSync(dir, { recursive: true });
  const file = liveFileIn(dir, card);
  if (work.none) {
    if (stateRow) writeRunRow(dir, { status: 'success', startAt: now - 3600_000, lastAt: now - 3500_000 });
    return null;
  }
  // A stuck run is the running run whose last line is older than the quiet limit.
  const startAt = now - (scene === 'stuck' ? 8 * 60_000 + 90_000 : 6 * 60_000);
  const log = writer(file, startAt);
  log.feed.run({ card, title });
  buildSlice(log, work.model ?? {});
  let status = 'running';
  if (work.stopped) {
    stagePair(log, 'finish-build', 15000);
    log.feed.stage({ stage: 'build-check', status: 'started' });
    log.advance(9000);
    log.feed.stage({ stage: 'build-check', status: 'failed' });
    log.advance(60000);
    status = 'failed';
  }
  if (work.finished) {
    stagePair(log, 'finish-build', 15000);
    for (const stage of ALL_STAGES.slice(4)) stagePair(log, stage, 15000);
    log.feed.tasks({ agent: LEAD, tasks: TASK_LIST.lead.map(task => ({ ...task, status: 'completed' })) });
    log.advance(1000);
    log.feed.tasks({ agent: HELPER, tasks: TASK_LIST.helper.map(task => ({ ...task, status: 'completed' })) });
    log.advance(30000);
    status = 'success';
  }
  if (work.uat) {
    for (const stage of ['finish-build', 'build-check', 'shipping', 'verdict', 'pass-note', 'gate']) stagePair(log, stage, 15000);
    log.feed.stage({ stage: 'acceptance', status: 'started' });
    log.advance(20000);
  }
  if (scene === 'stuck') log.advance(8 * 60_000);
  let text = log.lines.join('');
  // The last line of a live file can be half written when a test reads it.
  if (scene === 'torn') text += '{"id":"torn-1","at":';
  writeFileSync(file, text);
  if (stateRow) writeRunRow(dir, { status, startAt, lastAt: log.clock });
  return file;
}

/** The run row the machine's SQLite state keeps, with the columns the screen reads. */
export function writeRunRow(dir, { status, startAt, lastAt, workflow = 'card-path' }) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(`${dir}/state.db`);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS mastra_workflow_runs (workflow_name TEXT, run_id TEXT, status TEXT, createdAt INTEGER, updatedAt INTEGER)');
    db.prepare('DELETE FROM mastra_workflow_runs').run();
    db.prepare('INSERT INTO mastra_workflow_runs (workflow_name, run_id, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)')
      .run(workflow, `${workflow}-scene`, status, startAt, lastAt ?? startAt);
  } finally {
    db.close();
  }
}

// `node dashboard/scripts/live-scenes.mjs <dir> <scene>` writes one scene for a real server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, scene = 'running'] = process.argv.slice(2);
  if (!dir) throw new Error('usage: node dashboard/scripts/live-scenes.mjs <dir> <scene>');
  console.log(writeScene(dir, scene) ?? `${dir} (nothing running)`);
}
