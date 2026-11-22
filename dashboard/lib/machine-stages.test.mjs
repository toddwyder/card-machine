import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readMachineStages,
  resolveStagesForRun,
  humanizeId,
} from './machine-stages.js';

describe('machine-stages', () => {
  it('reads stages and steps from the real machine files with plain-English names', () => {
    const machine = readMachineStages();

    assert.ok(machine.discoveredStepIds.includes('start-build'));
    assert.ok(machine.discoveredStepIds.includes('flow-build'));
    assert.ok(machine.discoveredStepIds.includes('shipping'));
    assert.ok(machine.discoveredStepIds.includes('smoke'));
    assert.ok(machine.discoveredStepIds.includes('retro'));
    assert.ok(machine.discoveredWorkflowIds.includes('card-path'));
    assert.ok(machine.shippingPlaybookSteps.length >= 6);
    assert.ok(machine.babysitPlaybookItems.length >= 3);

    assert.deepEqual(
      machine.stages.map(stage => ({ id: stage.id, name: stage.name })),
      [
        { id: 'build', name: 'Build' },
        { id: 'babysit', name: 'Babysit' },
        { id: 'shipping', name: 'Shipping' },
        { id: 'after-merge', name: 'After merge' },
      ],
    );

    assert.deepEqual(
      machine.stages[0].steps.map(step => step.name),
      [
        'Read the card',
        'Plan the slices',
        'Build the slices',
        'Open the pull request',
      ],
    );

    assert.deepEqual(
      machine.stages[1].steps.map(step => step.name),
      [
        'Check for merge conflicts',
        'Answer review comments',
        'Get the checks green',
      ],
    );

    assert.deepEqual(
      machine.stages[2].steps.map(step => step.name),
      [
        'Verify the change independently',
        'Pick the verified pull request to land',
        'Re-check the verdict still fits the code',
        'Merge and read the result back',
        'Leave it alone while it lands',
        'Stop at the top of the verified set',
      ],
    );

    assert.deepEqual(
      machine.stages[3].steps.map(step => step.name),
      [
        "Wait for main's checks",
        'Smoke test the live site',
        'Your UAT on the live site',
      ],
    );
  });

  it('maps live playbook tasks cleanly into Build steps when present', () => {
    const machine = readMachineStages();
    const resolved = resolveStagesForRun({
      baseStages: machine.stages,
      runSteps: {
        start: { status: 'success' },
        'attempt.build-round.flow-build': { status: 'running' },
      },
      playbookTasks: [
        { id: 'playbook_1', content: 'Read the card and check the workspace', status: 'completed' },
        { id: 'playbook_2', content: 'Write failing tests first', status: 'in_progress' },
        { id: 'playbook_3', content: 'Implement and open the pull request', status: 'pending' },
      ],
    });

    const buildStage = resolved.find(stage => stage.id === 'build');
    assert.ok(buildStage);
    assert.deepEqual(
      buildStage.steps.map(step => ({ id: step.id, name: step.name, taskStatus: step.taskStatus })),
      [
        { id: 'playbook_1', name: 'Read the card and check the workspace', taskStatus: 'completed' },
        { id: 'playbook_2', name: 'Write failing tests first', taskStatus: 'in_progress' },
        { id: 'playbook_3', name: 'Implement and open the pull request', taskStatus: 'pending' },
      ],
    );
  });

  it('appends dynamic stages when a run contains stages not in the static map (e.g. retro or deploy-check)', () => {
    const machine = readMachineStages();
    const resolved = resolveStagesForRun({
      baseStages: machine.stages,
      runSteps: {
        start: { status: 'success' },
        'attempt.build-round.start-build': { status: 'success' },
        'attempt.mapping_attempt_0': { status: 'success' },
        hold: { status: 'success' },
        retro: { status: 'running' },
        'deploy-check': { status: 'pending' },
      },
    });

    assert.deepEqual(
      resolved.map(stage => ({ id: stage.id, name: stage.name })),
      [
        { id: 'build', name: 'Build' },
        { id: 'babysit', name: 'Babysit' },
        { id: 'shipping', name: 'Shipping' },
        { id: 'after-merge', name: 'After merge' },
        { id: 'retro', name: 'Retro' },
        { id: 'deploy-check', name: 'Deploy check' },
      ],
    );

    const retroStage = resolved.find(stage => stage.id === 'retro');
    assert.equal(retroStage.dynamic, true);
    assert.deepEqual(retroStage.steps.map(step => step.id), ['retro']);

    const deployStage = resolved.find(stage => stage.id === 'deploy-check');
    assert.equal(deployStage.dynamic, true);
    assert.deepEqual(deployStage.steps.map(step => step.name), ['Deploy check']);
  });

  it('reads custom repo roots cleanly and humanizes kebab/snake IDs', () => {
    assert.equal(humanizeId('deploy-check'), 'Deploy check');
    assert.equal(humanizeId('post_merge_audit'), 'Post merge audit');
    assert.equal(humanizeId('retro'), 'Retro');

    const dir = mkdtempSync(join(tmpdir(), 'machine-stages-test-'));
    try {
      mkdirSync(join(dir, 'machine', 'flow'), { recursive: true });
      mkdirSync(join(dir, '.agents', 'skills', 'poteto-mode', 'playbooks'), { recursive: true });
      writeFileSync(join(dir, 'machine', 'flow', 'workflow.mjs'), "export const id = 'card-path';");
      writeFileSync(join(dir, 'machine', 'flow', 'steps.mjs'), "const a = step('custom-step', () => {});");
      writeFileSync(join(dir, 'machine', 'flow', 'playbook.mjs'), 'export function parsePlaybookSteps() { return []; }');
      writeFileSync(join(dir, '.agents', 'skills', 'poteto-mode', 'playbooks', 'babysit.md'), '- Check conflicts\n- Answer threads\n- Green CI\n');
      writeFileSync(join(dir, '.agents', 'skills', 'poteto-mode', 'playbooks', 'shipping.md'), '1. **Verify.**\n2. **Pick.**\n');

      const machine = readMachineStages({ repoRoot: dir });
      assert.ok(machine.discoveredStepIds.includes('custom-step'));
      assert.equal(machine.shippingPlaybookSteps.length, 2);
      assert.equal(machine.babysitPlaybookItems.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
