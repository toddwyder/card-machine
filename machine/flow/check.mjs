import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDER_SLICE, COMMAND_MEMORY_MAX } from './bounded-sandbox.mjs';
import { studioUnit } from './interrupted.mjs';
import { resolvePlaybook } from './playbook.mjs';
import { validatePrDraft } from './pr.mjs';
import { changedFiles, runRepoChecks } from './repo-checks.mjs';

const TASK_STATE_TYPE = 'task';
const SKIP_PATTERN = /\b(?:skip|n\/a)\s*:\s*\S/i;

const matchesPlaybookStep = (taskContent, step) => {
  const text = String(taskContent ?? '').trim();
  if (text === step) return true;
  if (!text.startsWith(step)) return false;
  return /^skip\s*:\s*\S/i.test(text.slice(step.length).trim());
};

export function evaluateBuildCheck({ tasks = [], steps = [], playbook = '' } = {}) {
  if (!playbook || !Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reasons: ['playbook: no playbook chosen'], reason: 'playbook: no playbook chosen' };
  }
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, reasons: ['task list: no tasks recorded'], reason: 'task list: no tasks recorded' };
  }

  const reasons = [];
  for (const [index, step] of steps.entries()) {
    const task = tasks.find(t => t?.id === `playbook_${index + 1}`)
      ?? tasks.find(t => matchesPlaybookStep(t?.content, step));
    if (!task) {
      reasons.push(`playbook: missing step "${step}"`);
      continue;
    }
    const content = String(task.content ?? '').trim();
    if (SKIP_PATTERN.test(content)) continue;
    if (task.status !== 'completed') {
      reasons.push(`task list: "${content}" is ${task.status ?? 'pending'}`);
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons, reason: reasons.join('; ') };
}

export const selfScript = ({
  env = process.env,
  cwd = process.cwd(),
  moduleUrl = import.meta.url,
} = {}) => {
  const here = dirname(fileURLToPath(moduleUrl));
  const candidates = [
    env.FLOW_REPO && resolve(env.FLOW_REPO, 'machine/flow/check.mjs'),
    env.MASTRA_PROJECT_ROOT && resolve(env.MASTRA_PROJECT_ROOT, 'machine/flow/check.mjs'),
    resolve(cwd, 'machine/flow/check.mjs'),
    resolve(here, '../../machine/flow/check.mjs'),
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) {
    throw new Error(`machine/flow/check.mjs not found; tried: ${candidates.join(', ')}`);
  }
  return found;
};

const crashCause = (error, stderr) => {
  const text = String(stderr ?? '');
  if (/heap out of memory|allocation failed/i.test(text)) return 'JavaScript heap out of memory';
  const lastLine = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
  if (lastLine) return lastLine;
  if (error?.signal) return `process killed by ${error.signal}`;
  return String(error?.message ?? error ?? 'unknown check failure');
};

const runCheckInChild = (payload) =>
  new Promise((resolvePromise) => {
    const child = execFile(
      process.execPath,
      [selfScript(), '--eval'],
      { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise({ ok: false, fatal: true, reason: crashCause(error, stderr) });
          return;
        }
        try {
          resolvePromise(JSON.parse(stdout));
        } catch (parseError) {
          resolvePromise({ ok: false, fatal: true, reason: `invalid check output: ${parseError.message}` });
        }
      },
    );
    child.stdin.end(JSON.stringify(payload));
  });

export function checkStateUpdate(state, result) {
  if (result.ok) {
    return { nextState: state, output: { checkPassed: true, checkReason: '' } };
  }
  const stop = Boolean(result.fatal || state.checkReturns >= 2);
  const checkReturns = result.fatal || stop ? state.checkReturns : state.checkReturns + 1;
  const checkReasons = result.fatal ? state.checkReasons : [...state.checkReasons, result.reason];
  const stopWhy = result.fatal
    ? `stopped at the check step: ${result.reason}`
    : `stopped at the check step: ${checkReasons.map((r, i) => `(${i + 1}) ${r}`).join('; ')}`;
  return {
    nextState: { ...state, checkReturns, checkReasons, ...(stop ? { stopPart: 'check step', stopWhy } : {}) },
    output: { checkPassed: false, checkReason: result.reason, stopped: stop, detail: result.reason },
  };
}

export const realCheck = {
  async run({ mastra, threadId, playbook, repo, checkout, base, projectRepo, card, prTitle, prBody }) {
    const entry = playbook ? resolvePlaybook(repo, playbook) : null;
    const store = await mastra?.getStorage?.()?.getStore?.('threadState');
    const tasks = store && threadId ? await store.getState({ threadId, type: TASK_STATE_TYPE }) : [];
    const taskResult = await runCheckInChild({
      tasks: Array.isArray(tasks) ? tasks : [],
      steps: entry?.steps ?? [],
      playbook: entry?.slug ?? String(playbook ?? ''),
    });
    if (!taskResult.ok) return taskResult;
    if (!checkout || !base) return { ok: true };
    const files = changedFiles(checkout, base);
    if (files.length === 0) return { ok: true };
    const prCheck = validatePrDraft({ card, title: prTitle, body: prBody });
    if (!prCheck.ok) {
      return { ok: false, reason: `${prCheck.reason} Call write_pr with a title and body that name ${card} before finishing.` };
    }
    const unit = studioUnit();
    const studio = unit && /^card-machine-(self-)?studio\.service$/.test(unit);
    return runRepoChecks({
      checkout,
      base,
      projectRepo: projectRepo ?? repo,
      ...(studio ? { slice: BUILDER_SLICE, memoryMax: COMMAND_MEMORY_MAX, ownerUnit: unit } : {}),
    });
  },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--eval')) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(`${JSON.stringify(evaluateBuildCheck(payload))}\n`);
}
