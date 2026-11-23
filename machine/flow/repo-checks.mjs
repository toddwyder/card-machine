import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { boundedCommand, builderLock, LOCK_WAIT_SECONDS } from './bounded-sandbox.mjs';
import { syncCopyModules } from './copy.mjs';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 4000;
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function changedFiles(checkout, base) {
  if (!checkout || !base) return [];
  const out = git(checkout, ['diff', '--name-only', base, 'HEAD']);
  return out ? out.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
}

export function uncommittedFiles(checkout) {
  if (!checkout) return [];
  const out = git(checkout, ['status', '--porcelain']);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

export function isDocsOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every(file => file.endsWith('.md'));
}

export function buildCheckPlan({ hasRenovate = false, docsOnly = false } = {}) {
  const hygiene = [
    ...(hasRenovate ? [{ name: 'Validate Renovate configuration', command: 'npx --yes --package renovate@44.251.0 -- renovate-config-validator --strict' }] : []),
    { name: 'Check skill names are unique', command: 'node scripts/check-skill-names.mjs' },
    { name: 'Check skill version records agree', command: 'node scripts/check-skill-versions.mjs' },
    { name: 'Check installed pstack matches its pinned commit', command: 'node scripts/check-pstack-pin.mjs' },
    { name: 'Check agent-read files point at paths that exist', command: 'node scripts/check-agent-links.mjs' },
    { name: 'Check the ADR folder stays retired', command: 'node scripts/check-no-adr-folder.mjs' },
    { name: 'Check agent-facing docs name kinds of model only', command: 'node scripts/check-doc-models.mjs' },
    { name: 'Check the knowledge graph answers only from tracked paths', command: 'node scripts/check-graph-sources.mjs' },
    { name: 'Check the machine program list is up to date', command: 'node scripts/machine-programs.mjs --check' },
    { name: 'Check no reach into Julia repository outside the project setting', command: 'node scripts/check-no-julia-reach.mjs' },
  ];
  if (docsOnly) return hygiene;
  return [
    ...hygiene,
    { name: 'Plan the test owners', command: 'node scripts/test-owners.mjs --plan' },
    { name: "Run local owners' tests", command: 'node scripts/test-owners.mjs --run local' },
    { name: 'Guard the workflow folder', command: 'npm run guard:flow' },
    { name: 'Guard the machine boundaries', command: 'npm run guard:boundaries' },
  ];
}

function checkEnv(env) {
  const bunBin = env.BUN_INSTALL ? join(env.BUN_INSTALL, 'bin') : (env.HOME ? join(env.HOME, '.bun', 'bin') : '');
  const path = [bunBin, env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
  return { ...env, PATH: path };
}

function tailOutput(stdout, stderr) {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;
  return `...\n${combined.slice(-MAX_OUTPUT_CHARS)}`;
}

async function defaultRunStep(step, { checkout, lock, slice, memoryMax, ownerUnit, env }) {
  const stepEnv = checkEnv(env);
  if (process.platform === 'linux') {
    const inner = `cd ${quote(checkout)} && ${step.command}`;
    const cmd = slice
      ? boundedCommand(inner, { slice, memoryMax, ownerUnit, lock, description: step.name })
      : (lock ? `flock --timeout ${LOCK_WAIT_SECONDS} ${quote(lock)} /bin/sh -c ${quote(inner)}` : inner);
    try {
      const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', cmd], {
        cwd: checkout,
        env: stepEnv,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { ok: true, output: tailOutput(stdout, stderr) };
    } catch (error) {
      return {
        ok: false,
        output: tailOutput(error?.stdout ?? '', error?.stderr ?? error?.message ?? String(error)),
      };
    }
  }
  try {
    const { stdout, stderr } = await execFileAsync(step.command, {
      cwd: checkout,
      env: stepEnv,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, output: tailOutput(stdout, stderr) };
  } catch (error) {
    return {
      ok: false,
      output: tailOutput(error?.stdout ?? '', error?.stderr ?? error?.message ?? String(error)),
    };
  }
}

async function runPlanSequentially(plan, runner) {
  if (plan.length === 0) return { ok: true };
  const [head, ...rest] = plan;
  const result = await runner(head);
  if (!result.ok) {
    const detail = result.output ? `\n${result.output}` : '';
    return { ok: false, reason: `Repository check "${head.name}" failed.${detail}` };
  }
  return runPlanSequentially(rest, runner);
}

export async function runRepoChecks({
  checkout,
  base,
  projectRepo = checkout,
  lock = process.platform === 'linux' ? builderLock() : null,
  slice,
  memoryMax,
  ownerUnit,
  env = process.env,
  syncModules = true,
  runStep,
} = {}) {
  const dirty = uncommittedFiles(checkout);
  if (dirty.length > 0) {
    return {
      ok: false,
      reason: `Uncommitted changes in ${checkout}: commit or discard them before opening a pull request.\n${dirty.join('\n')}`,
    };
  }
  const files = changedFiles(checkout, base);
  if (files.length === 0) {
    return { ok: true, skipped: true, docsOnly: false, files: [] };
  }
  const docsOnly = isDocsOnly(files);
  if (!docsOnly && syncModules) {
    syncCopyModules({ repo: projectRepo, folder: checkout, lock, slice, memoryMax, ownerUnit, env });
  }
  const plan = buildCheckPlan({ hasRenovate: existsSync(join(checkout, 'renovate.json')), docsOnly });
  const runner = runStep
    ? step => runStep(step, { checkout, lock, slice, memoryMax, ownerUnit, env })
    : step => defaultRunStep(step, { checkout, lock, slice, memoryMax, ownerUnit, env });
  const outcome = await runPlanSequentially(plan, runner);
  return outcome.ok ? { ok: true, skipped: false, docsOnly, files } : outcome;
}
