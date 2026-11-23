import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TaskSignalProvider } from '@mastra/core/signals';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { cardOfContext, liveFeedForRun } from './live.mjs';

export const PLAYBOOK_DIR = '.agents/skills/poteto-mode/playbooks';

const PLAYBOOK_ALIASES = {
  'multi-phase-or-multi-pr-plan': 'multi-phase-plan',
  'authoring-or-modifying-a-skill': 'authoring-a-skill',
  'worktree-and-simulator-cleanup': 'worktree-cleanup',
};

const TASKS_REQUEST_CONTEXT_KEY = 'mastra:tasks';
const TASK_STATE_TYPE = 'task';

// The Run view shows each agent's task list as it stands, so every write announces the
// whole list rather than a change: the screen never has to merge two lists.
const announceTasks = (context, tasks) => {
  const list = (Array.isArray(tasks) ? tasks : []).map(({ id, content, status }) => ({ id, title: content, status }));
  liveFeedForRun(cardOfContext(context))?.tasks({
    // Mastra keeps the agent's id on `agentId` in tool context; `id` and `name` are not set there,
    // and falling back to them labelled a real run's task list "machine" on the Run view.
    agent: context?.agent?.agentId ?? context?.agent?.name ?? 'machine',
    tasks: list,
  });
};

export function normalizePlaybookName(name) {
  const cleaned = String(name ?? '')
    .trim()
    .replace(/^[`'"“”]+|[`'"“”]+$/g, '')
    .replace(/^(?:\.agents\/skills\/poteto-mode\/)?playbooks\//i, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return PLAYBOOK_ALIASES[cleaned] ?? cleaned;
}

// Extract top-level numbered steps (`1. ...`, `2. ...`) and their indented continuation lines
// word for word from a poteto-mode playbook markdown file.
export function parsePlaybookSteps(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const steps = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^\d+\.\s+(.+)$/);
    if (match) {
      if (current) steps.push(current.join('\n'));
      current = [match[1]];
      continue;
    }
    if (current) {
      if (/^\s+\S/.test(line)) {
        current.push(line);
      } else {
        steps.push(current.join('\n'));
        current = null;
      }
    }
  }
  if (current) steps.push(current.join('\n'));
  return steps;
}

export function listPlaybooks(repo) {
  const dir = join(repo, PLAYBOOK_DIR);
  const catalog = new Map();
  if (!existsSync(dir)) return catalog;

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    const steps = parsePlaybookSteps(readFileSync(join(dir, file), 'utf8'));
    if (steps.length > 0) catalog.set(slug, { slug, file, steps });
  }
  return catalog;
}

export function resolvePlaybook(repo, name) {
  const slug = normalizePlaybookName(name);
  if (!slug) return null;
  return listPlaybooks(repo).get(slug) ?? null;
}

export function seedPlaybookTasks(existingTasks, steps) {
  const playbookTasks = steps.map((content, index) => ({
    id: `playbook_${index + 1}`,
    content,
    status: 'pending',
    activeForm: content.split(/\r?\n/, 1)[0].slice(0, 80),
  }));
  const customTasks = (Array.isArray(existingTasks) ? existingTasks : [])
    .filter(task => !String(task?.id ?? '').startsWith('playbook_'));
  return [...playbookTasks, ...customTasks];
}

export function createChoosePlaybookTool({ repo, onChosen, onInvalid } = {}) {
  return createTool({
    id: 'choose_playbook',
    description:
      'Name the poteto-mode playbook for this card as your first act. Writes every step of that playbook word for word into your task list ahead of any card-specific items.',
    inputSchema: z.object({
      playbook: z.string().min(1).describe('Playbook name or slug from .agents/skills/poteto-mode/playbooks/ (e.g. feature, bug-fix, investigation, refactoring).'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      isError: z.boolean(),
      playbook: z.string().optional(),
      steps: z.array(z.string()).optional(),
      tasks: z.array(z.object({
        id: z.string(),
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed']),
        activeForm: z.string(),
      })).optional(),
      error: z.string().optional(),
    }),
    execute: async ({ playbook }, context) => {
      const entry = resolvePlaybook(repo, playbook);
      if (!entry) {
        onInvalid?.({ playbook: String(playbook ?? ''), requestContext: context?.requestContext });
        const available = [...listPlaybooks(repo).keys()].join(', ');
        return {
          ok: false,
          isError: true,
          error: `Unknown playbook "${playbook}". Choose one of: ${available}.`,
        };
      }

      const { store, threadId, tasks: existing } = await readTaskState(context);
      const tasks = seedPlaybookTasks(existing, entry.steps);

      if (store && threadId) {
        await store.setState({ threadId, type: TASK_STATE_TYPE, value: tasks });
      }
      context?.requestContext?.set?.(TASKS_REQUEST_CONTEXT_KEY, tasks);
      context?.requestContext?.get?.('controller')?.emitEvent?.({ type: 'task_updated', tasks });
      announceTasks(context, tasks);
      onChosen?.({ playbook: entry.slug, steps: entry.steps, requestContext: context?.requestContext });

      return {
        ok: true,
        isError: false,
        playbook: entry.slug,
        steps: entry.steps,
        tasks,
      };
    },
  });
}

const FLAG_PATTERN = /\bflag\s*:/i;

export const hasTaskFlag = task =>
  FLAG_PATTERN.test(String(task?.content ?? '')) || FLAG_PATTERN.test(String(task?.activeForm ?? ''));

async function readTaskState(context) {
  const store = await context?.mastra?.getStorage?.()?.getStore?.('threadState');
  const threadId = context?.agent?.threadId;
  const raw = store && threadId
    ? await store.getState({ threadId, type: TASK_STATE_TYPE })
    : context?.requestContext?.get?.(TASKS_REQUEST_CONTEXT_KEY);
  return { store, threadId, tasks: Array.isArray(raw) ? raw : [] };
}

const flaggedTaskRefusal = tasks => ({
  content: 'Refused: a task cannot be marked completed with a flag:. Finish the step cleanly in this run without flagging it.',
  tasks,
  isError: true,
});

const wrapTaskTool = (base, checkRefusal) => createTool({
  id: base.id,
  description: base.description,
  inputSchema: base.inputSchema,
  outputSchema: base.outputSchema,
  execute: async (input, context) => {
    const { tasks } = await readTaskState(context);
    if (checkRefusal(input, tasks)) return flaggedTaskRefusal(tasks);
    const result = await base.execute(input, context);
    announceTasks(context, (await readTaskState(context)).tasks);
    return result;
  },
});

export function createGuardedTaskTools() {
  const builtin = new TaskSignalProvider().getTools();
  return {
    task_write: wrapTaskTool(
      builtin.task_write,
      input => Array.isArray(input?.tasks) && input.tasks.some(task => task?.status === 'completed' && hasTaskFlag(task)),
    ),
    task_update: wrapTaskTool(builtin.task_update, (input, tasks) => {
      const existing = tasks.find(task => task?.id === input?.id);
      const nextStatus = input?.status ?? existing?.status;
      const nextTask = { content: input?.content ?? existing?.content, activeForm: input?.activeForm ?? existing?.activeForm };
      return nextStatus === 'completed' && hasTaskFlag(nextTask);
    }),
    task_complete: wrapTaskTool(builtin.task_complete, (input, tasks) => {
      const existing = tasks.find(task => task?.id === input?.id);
      return Boolean(existing && hasTaskFlag(existing));
    }),
  };
}
