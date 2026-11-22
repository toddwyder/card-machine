// Reads the machine's stages and steps directly from machine/flow/workflow.mjs,
// machine/flow/steps.mjs, machine/flow/playbook.mjs, and the poteto-mode
// playbooks (babysit.md, shipping.md). Maps known stages to the brief's
// plain-English names and appends any stage or step the machine runs later.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, '..', '..');

const INTERNAL_PLUMBING_IDS = new Set([
  'input',
  'attempt',
  'build-round',
  'review-phase',
  'review-round',
  'smoke-loop',
  'smoke-round',
  'fix-and-land',
  'hold',
  'stop-report',
  'cleanup',
]);

export const PLAIN_ENGLISH_STAGES = Object.freeze([
  Object.freeze({
    id: 'build',
    name: 'Build',
    machineStepIds: Object.freeze(['start', 'start-build', 'flow-build', 'finish-build', 'build-check']),
    steps: Object.freeze([
      Object.freeze({
        id: 'read-card',
        name: 'Read the card',
        machineStepIds: Object.freeze(['start', 'start-build']),
      }),
      Object.freeze({
        id: 'plan-slices',
        name: 'Plan the slices',
        machineStepIds: Object.freeze(['plan-slices', 'choose-playbook']),
      }),
      Object.freeze({
        id: 'build-slices',
        name: 'Build the slices',
        machineStepIds: Object.freeze(['flow-build']),
      }),
      Object.freeze({
        id: 'open-pr',
        name: 'Open the pull request',
        machineStepIds: Object.freeze(['finish-build', 'build-check']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'babysit',
    name: 'Babysit',
    machineStepIds: Object.freeze(['babysit', 'check-conflicts', 'answer-comments', 'get-checks-green', 'remediation']),
    steps: Object.freeze([
      Object.freeze({
        id: 'check-conflicts',
        name: 'Check for merge conflicts',
        machineStepIds: Object.freeze(['check-conflicts', 'babysit-conflicts']),
      }),
      Object.freeze({
        id: 'answer-comments',
        name: 'Answer review comments',
        machineStepIds: Object.freeze(['answer-comments', 'babysit-comments', 'remediation']),
      }),
      Object.freeze({
        id: 'get-checks-green',
        name: 'Get the checks green',
        machineStepIds: Object.freeze(['get-checks-green', 'babysit-ci']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'shipping',
    name: 'Shipping',
    machineStepIds: Object.freeze(['shipping', 'verdict', 'pass-note', 'gate', 'land']),
    steps: Object.freeze([
      Object.freeze({
        id: 'verify-independently',
        name: 'Verify the change independently',
        machineStepIds: Object.freeze(['shipping', 'verdict']),
      }),
      Object.freeze({
        id: 'pick-verified-pr',
        name: 'Pick the verified pull request to land',
        machineStepIds: Object.freeze(['pass-note', 'gate']),
      }),
      Object.freeze({
        id: 'recheck-verdict',
        name: 'Re-check the verdict still fits the code',
        machineStepIds: Object.freeze(['recheck-verdict']),
      }),
      Object.freeze({
        id: 'merge-and-read-back',
        name: 'Merge and read the result back',
        machineStepIds: Object.freeze(['land']),
      }),
      Object.freeze({
        id: 'leave-alone-while-landing',
        name: 'Leave it alone while it lands',
        machineStepIds: Object.freeze(['watch-land', 'leave-alone-while-landing']),
      }),
      Object.freeze({
        id: 'stop-at-verified-top',
        name: 'Stop at the top of the verified set',
        machineStepIds: Object.freeze(['stop-at-ceiling', 'stop-at-verified-top']),
      }),
    ]),
  }),
  Object.freeze({
    id: 'after-merge',
    name: 'After merge',
    machineStepIds: Object.freeze(['wait-main-checks', 'smoke', 'smoke-pass', 'acceptance', 'machine-accept']),
    steps: Object.freeze([
      Object.freeze({
        id: 'wait-main-checks',
        name: "Wait for main's checks",
        machineStepIds: Object.freeze(['wait-main-checks', 'main-checks']),
      }),
      Object.freeze({
        id: 'smoke-live-site',
        name: 'Smoke test the live site',
        machineStepIds: Object.freeze(['smoke', 'smoke-pass']),
      }),
      Object.freeze({
        id: 'uat-live-site',
        name: 'Your UAT on the live site',
        machineStepIds: Object.freeze(['acceptance', 'machine-accept']),
      }),
    ]),
  }),
]);

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

export function humanizeId(id) {
  const cleaned = String(id ?? '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!cleaned) return 'Step';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractStepIds(stepsSource) {
  const ids = new Set();
  for (const match of stepsSource.matchAll(/\bstep\(\s*['"]([^'"]+)['"]/g)) {
    ids.add(match[1]);
  }
  for (const match of stepsSource.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

function extractWorkflowIds(workflowSource, schemaSource) {
  const ids = new Set();
  for (const match of schemaSource.matchAll(/export\s+const\s+[A-Z0-9_]+\s*=\s*['"]([^'"]+)['"]/g)) {
    ids.add(match[1]);
  }
  for (const match of workflowSource.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

function parseNumberedPlaybookSteps(markdown) {
  const steps = [];
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+(.+)$/);
    if (match) steps.push(match[1].trim());
  }
  return steps;
}

function parseBulletPlaybookItems(markdown) {
  const items = [];
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match) items.push(match[1].trim());
  }
  return items;
}

function findRepoRoot(explicitRoot) {
  if (explicitRoot) return resolve(explicitRoot);
  for (const candidate of [defaultRepoRoot, process.env.FLOW_REPO, process.env.MASTRA_PROJECT_ROOT, process.cwd()].filter(Boolean)) {
    let dir = resolve(candidate);
    while (true) {
      if (existsSync(join(dir, 'machine', 'flow', 'workflow.mjs'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return defaultRepoRoot;
}

function cloneStages(stages) {
  return stages.map(stage => ({
    id: stage.id,
    name: stage.name,
    machineStepIds: [...(stage.machineStepIds ?? [])],
    dynamic: Boolean(stage.dynamic),
    steps: (stage.steps ?? []).map(step => ({
      id: step.id,
      name: step.name,
      machineStepIds: [...(step.machineStepIds ?? [])],
    })),
  }));
}

export function readMachineStages({ repoRoot } = {}) {
  const root = findRepoRoot(repoRoot);
  const workflowPath = join(root, 'machine', 'flow', 'workflow.mjs');
  const stepsPath = join(root, 'machine', 'flow', 'steps.mjs');
  const schemaPath = join(root, 'machine', 'flow', 'schema.mjs');
  const playbookPath = join(root, 'machine', 'flow', 'playbook.mjs');
  const babysitPath = join(root, '.agents', 'skills', 'poteto-mode', 'playbooks', 'babysit.md');
  const shippingPath = join(root, '.agents', 'skills', 'poteto-mode', 'playbooks', 'shipping.md');

  const workflowSource = readTextIfExists(workflowPath);
  const stepsSource = readTextIfExists(stepsPath);
  const schemaSource = readTextIfExists(schemaPath);
  const playbookSource = readTextIfExists(playbookPath);
  const babysitMarkdown = readTextIfExists(babysitPath);
  const shippingMarkdown = readTextIfExists(shippingPath);

  const discoveredStepIds = extractStepIds(stepsSource);
  const discoveredWorkflowIds = extractWorkflowIds(workflowSource, schemaSource);
  const shippingPlaybookSteps = parseNumberedPlaybookSteps(shippingMarkdown);
  const babysitPlaybookItems = parseBulletPlaybookItems(babysitMarkdown);
  const hasPlaybookSupport = /parsePlaybookSteps|choose_playbook/.test(playbookSource);

  return {
    repoRoot: root,
    stages: cloneStages(PLAIN_ENGLISH_STAGES),
    discoveredStepIds,
    discoveredWorkflowIds,
    shippingPlaybookSteps,
    babysitPlaybookItems,
    hasPlaybookSupport,
  };
}

function isInternalPlumbing(stepKey) {
  const leaf = String(stepKey ?? '').split('.').at(-1) ?? '';
  if (!leaf) return true;
  if (leaf.startsWith('mapping_')) return true;
  return INTERNAL_PLUMBING_IDS.has(leaf);
}

function collectKnownMachineIds(stages) {
  const known = new Set();
  for (const stage of stages) {
    known.add(stage.id);
    for (const id of stage.machineStepIds ?? []) known.add(id);
    for (const step of stage.steps ?? []) {
      known.add(step.id);
      for (const id of step.machineStepIds ?? []) known.add(id);
    }
  }
  return known;
}

function formatPlaybookTaskName(task) {
  const raw = String(task?.activeForm || task?.content || task?.name || task?.id || 'Build step').trim();
  const firstLine = raw.split(/\r?\n/, 1)[0].trim();
  return firstLine.replace(/^\d+\.\s+/, '').replace(/\*\*/g, '');
}

export function resolveStagesForRun({ baseStages = PLAIN_ENGLISH_STAGES, runSteps = {}, playbookTasks = [] } = {}) {
  const stages = cloneStages(baseStages);

  if (Array.isArray(playbookTasks) && playbookTasks.length > 0) {
    const buildStage = stages.find(stage => stage.id === 'build');
    if (buildStage) {
      buildStage.steps = playbookTasks.map((task, index) => ({
        id: String(task?.id ?? `playbook_${index + 1}`),
        name: formatPlaybookTaskName(task),
        machineStepIds: [String(task?.id ?? `playbook_${index + 1}`)],
        taskStatus: task?.status ?? 'pending',
      }));
    }
  }

  const knownIds = collectKnownMachineIds(stages);
  const dynamicStages = new Map();

  for (const rawKey of Object.keys(runSteps ?? {})) {
    if (isInternalPlumbing(rawKey)) continue;
    const leaf = String(rawKey).split('.').at(-1);
    if (!leaf || knownIds.has(leaf) || knownIds.has(rawKey)) continue;

    if (!dynamicStages.has(leaf)) {
      const label = humanizeId(leaf);
      const stage = {
        id: leaf,
        name: label,
        machineStepIds: [leaf],
        dynamic: true,
        steps: [
          {
            id: leaf,
            name: label,
            machineStepIds: [leaf],
          },
        ],
      };
      dynamicStages.set(leaf, stage);
      stages.push(stage);
      knownIds.add(leaf);
    }
  }

  return stages;
}
