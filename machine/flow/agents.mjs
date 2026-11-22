import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { createCodingAgent } from '@mastra/core/coding-agent';
import { CyberRefusalHandler } from '@mastra/core/processors';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';

import { sandboxEnv } from './access.mjs';
import { BoundedLocalSandbox, BUILDER_SLICE, COMMAND_MEMORY_MAX, builderLock } from './bounded-sandbox.mjs';
import { CallCostControl } from './call-cost.mjs';
import { ensureCopyModules } from './copy.mjs';
import { studioUnit } from './interrupted.mjs';
import { cardMemory } from './memory.mjs';
import { buildModelReader, leadModelId } from './models.mjs';
import { createChoosePlaybookTool, createGuardedTaskTools } from './playbook.mjs';
import { ensureCardResources } from './resources.mjs';
import { SHIPPING_MAX_STEPS } from './review.mjs';
import { agentModel, helperKey, readRoleModels, readStageModels } from './role-models.mjs';

// Mastra's own cost guard stops a card once its resource-scoped estimated cost passes this
// many dollars. Lead, helpers, memory, and stage agents all share the card as their resource.
export const COST_LIMIT_DOLLARS = 4;

const HELPER_CONCURRENCY = 4;
const POTETO_SKILL = '.agents/skills/poteto-mode/SKILL.md';

export const resolveCostLimit = () => {
  const fromEnv = Number(process.env.FLOW_CARD_LIMIT_DOLLARS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : COST_LIMIT_DOLLARS;
};

const cardCostControl = () =>
  new CallCostControl({ maxCost: resolveCostLimit(), scope: 'resource', window: '365d', includeBreakdown: true });

function repositoryContaining(directory) {
  if (existsSync(join(directory, POTETO_SKILL))) return directory;
  const parent = dirname(directory);
  if (parent === directory) throw new Error('Cannot find the repository poteto-mode skill. Set FLOW_REPO to the repository root.');
  return repositoryContaining(parent);
}

export function repoRoot() {
  return process.env.FLOW_REPO ?? repositoryContaining(resolve(process.env.MASTRA_PROJECT_ROOT ?? process.cwd()));
}

export function projectRepoRoot() {
  const value = process.env.FLOW_PROJECT_REPO?.trim();
  if (!value) {
    throw new Error('FLOW_PROJECT_REPO is unset or empty. Set FLOW_PROJECT_REPO to the target project repository path.');
  }
  return value;
}

export function projectGithubRepo() {
  const value = process.env.FLOW_PROJECT_GITHUB_REPO?.trim();
  if (!value) {
    throw new Error('FLOW_PROJECT_GITHUB_REPO is unset or empty. Set FLOW_PROJECT_GITHUB_REPO to the target GitHub repository slug (owner/name).');
  }
  return value;
}

export function createAgents({ model, leadModel, helperModel, repo = repoRoot(), leadModelFile, roleModelsFile, tools = {} } = {}) {
  if (!model && !leadModel) leadModelId(leadModelFile);
  const stages = model
    ? { shipping: model, remediation: model, retro: model, memory: typeof model === 'string' ? model : null }
    : readStageModels(roleModelsFile);
  const stageModel = id => (model ? model : agentModel(stages[id]));
  const memoryModelId = () => (model ? (typeof model === 'string' ? model : null) : readStageModels(roleModelsFile).memory);

  const cardResource = {
    id: 'card-resource',
    processInputStep({ requestContext }) {
      const card = requestContext?.get?.('flowCard');
      if (card) requestContext.set('mastra__resourceId', card);
    },
  };
  const resourceGuard = {
    id: 'resource-guard',
    async processInputStep({ requestContext, abort }) {
      const card = requestContext?.get?.('flowCard') ?? '';
      const dir = requestContext?.get?.('cardCheckout') ?? repo;
      const check = await ensureCardResources({ card, dir });
      if (!check.ok) {
        abort(check.reason, { metadata: { part: 'Resources', reason: check.reason } });
      }
    },
  };
  const cardProcessors = () => ({ inputProcessors: [cardResource, resourceGuard, cardCostControl()], outputProcessors: [] });
  const codingProcessors = () => ({
    inputProcessors: [cardResource, resourceGuard, cardCostControl()],
    outputProcessors: [new CyberRefusalHandler()],
  });

  const playbookGuard = () => {
    let chosen = null;
    let currentStep = 0;
    let remindedAtStep = null;
    let invalidAttempt = '';
    return {
      id: 'playbook-guard',
      onChosen: ({ playbook, requestContext }) => {
        chosen = { playbook, callNumber: currentStep + 1 };
        requestContext?.set?.('flowPlaybook', chosen);
      },
      onInvalid: ({ playbook }) => {
        invalidAttempt = String(playbook ?? '');
      },
      processInputStep: async ({ stepNumber = 0, requestContext, messageList, abort }) => {
        currentStep = stepNumber;
        if (stepNumber === 0) {
          chosen = null;
          remindedAtStep = null;
          invalidAttempt = '';
          return;
        }
        if (chosen) {
          requestContext?.set?.('flowPlaybook', chosen);
          return;
        }
        if (remindedAtStep === null) {
          remindedAtStep = stepNumber;
          const badNote = invalidAttempt ? ` "${invalidAttempt}" is not a poteto-mode playbook.` : '';
          messageList?.add?.({
            role: 'user',
            content: `You started work without naming a valid poteto-mode playbook.${badNote} Call \`choose_playbook\` with a valid playbook from \`.agents/skills/poteto-mode/playbooks/\` now before continuing.`,
          }, 'input');
          return;
        }
        if (stepNumber >= remindedAtStep + 1) {
          const reason = invalidAttempt
            ? `Lead did not name a valid poteto-mode playbook after reminder (tried "${invalidAttempt}")`
            : 'Lead started work without naming a poteto-mode playbook (no valid choose_playbook call after reminder)';
          abort(reason, { metadata: { reason, part: 'Playbook' } });
        }
      },
    };
  };

  const cardWorkspace = (id, { readOnly = false, sandbox = !readOnly, requireCheckout = false, ...extra } = {}) => ({ requestContext } = {}) => {
    const folder = requestContext?.get?.('cardCheckout') ?? (requireCheckout ? null : repo);
    if (!folder) throw new Error('Shipping has no checkout to review.');
    const unit = studioUnit();
    const studio = unit && /^card-machine-(self-)?studio\.service$/.test(unit);
    return new Workspace({
      id,
      filesystem: new LocalFilesystem({ basePath: folder, ...(readOnly ? { readOnly: true } : {}) }),
      ...(sandbox
        ? {
            // Studio runs card commands inside a builder slice with a measured
            // ceiling, so a runaway install dies there instead of taking Studio
            // down, and inside a jail that makes everything but the card's own
            // copy read only, so a second checkout cannot appear somewhere else.
            // Any other service — CI and the checks — gets the plain sandbox:
            // it has no slice to bind to, and a generic service name must never
            // turn the jail on where the server has no such unit.
            sandbox: studio
              ? new BoundedLocalSandbox({
                  workingDirectory: folder,
                  env: sandboxEnv({ repo }),
                  ownerUnit: unit,
                  jail: folder,
                  prepare: () => ensureCopyModules({
                    repo: process.env.FLOW_PROJECT_REPO?.trim() || repo,
                    folder,
                    lock: builderLock(),
                    slice: BUILDER_SLICE,
                    memoryMax: COMMAND_MEMORY_MAX,
                    ownerUnit: unit,
                  }),
                })
              : new LocalSandbox({ workingDirectory: folder, env: sandboxEnv({ repo }) }),
          }
        : {}),
      ...extra,
    });
  };

  const skillInstruction = `Read ${join(repo, POTETO_SKILL)} in full, including its Principles section, before any work.`;
  const stampCardResource = agent => {
    for (const method of ['stream', 'generate']) {
      const original = agent[method].bind(agent);
      agent[method] = (messages, opts = {}) => {
        const card = opts.requestContext?.get?.('flowCard');
        if (card) {
          opts.requestContext.set('mastra__resourceId', card);
          if (Array.isArray(messages)) {
            messages = messages.map(m => (m && typeof m === 'object' && m.resourceId ? { ...m, resourceId: card } : m));
          }
        }
        return original(messages, opts);
      };
    }
    return agent;
  };
  const helpers = () => Object.fromEntries(readRoleModels(roleModelsFile).flatMap(role => role.models.map((modelId, index) => {
    const choice = role.models.length > 1 ? `, choice ${index + 1}` : '';
    return [helperKey(role, index), stampCardResource(createCodingAgent({
      id: `pstack-${role.id}-${index + 1}`,
      name: role.name,
      description: `${role.name} pstack role on ${modelId}${choice}. ${role.explanation} Use this helper when delegating ${role.name} work.`,
      instructions: skillInstruction,
      model: helperModel ? (typeof helperModel === 'function' ? helperModel(role, index, modelId) : helperModel) : agentModel(modelId),
      ...codingProcessors(),
      ...cardMemory(memoryModelId),
      workspace: cardWorkspace('machine-repo-helper', { skills: ['.agents/skills'] }),
      tools,
      defaultOptions: { maxSteps: 100 },
    }))];
  })));

  const leadPlaybookGuard = playbookGuard();
  const choosePlaybookTool = createChoosePlaybookTool({
    repo,
    onChosen: leadPlaybookGuard.onChosen,
    onInvalid: leadPlaybookGuard.onInvalid,
  });
  const leadProcessors = codingProcessors();
  const build = createCodingAgent({
    id: 'flow-build',
    name: 'Lead',
    instructions: readFileSync(join(repo, POTETO_SKILL), 'utf8'),
    model: leadModel ?? buildModelReader(leadModelFile),
    inputProcessors: [...leadProcessors.inputProcessors, leadPlaybookGuard],
    outputProcessors: [...leadProcessors.outputProcessors, leadPlaybookGuard],
    ...cardMemory(memoryModelId),
    workspace: cardWorkspace('machine-repo', { readOnly: true, skills: ['.agents/skills'] }),
    agents: helpers,
    tools: { ...createGuardedTaskTools(), ...tools, choose_playbook: choosePlaybookTool },
    defaultOptions: {
      maxSteps: 400,
      toolCallConcurrency: HELPER_CONCURRENCY,
    },
  });
  leadModelId(leadModelFile);

  const shipping = new Agent({
    id: 'flow-shipping',
    name: 'Shipping',
    instructions:
      'You are the Shipping reviewer. You did not write the code. Load the pstack skills from .agents/skills and follow the Shipping playbook. Verify each criterion on the real surface the criterion names (such as Linear, a browser for web pages, or commands in the checkout), never treating unit tests with fakes as proof of real-service behavior, and answer in the shape the task gives.',
    model: stageModel('shipping'),
    ...cardProcessors(),
    workspace: cardWorkspace('shipping-checkout', { requireCheckout: true, skills: ['.agents/skills'] }),
    defaultOptions: { maxSteps: SHIPPING_MAX_STEPS },
  });

  const remediation = new Agent({
    id: 'flow-remediation',
    name: 'Flow remediation stand-in',
    instructions: 'You rewrite one short line so it reads better. Reply with the new line only. No tools.',
    model: stageModel('remediation'),
    ...cardProcessors(),
  });

  const retro = new Agent({
    id: 'flow-retro',
    name: 'Flow retro stand-in',
    instructions: 'You write one sentence about what this throwaway run did. No tools.',
    model: stageModel('retro'),
    ...cardProcessors(),
  });

  return { build, shipping, remediation, retro };
}
