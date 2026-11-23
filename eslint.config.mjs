import commentsPlugin from '@eslint-community/eslint-plugin-eslint-comments';

export const frameworkRules = {
  'max-lines': ['error', 400],
  'no-restricted-globals': [
    'error',
    {
      name: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      name: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      name: 'setImmediate',
      message: 'Do not use setImmediate. Use framework waiting or retry mechanisms.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'WhileStatement',
      message: 'Do not use while loops. Use the workflow builder for repetition, retries and waits.',
    },
    {
      selector: 'DoWhileStatement',
      message: 'Do not use do...while loops. Use the workflow builder for repetition, retries and waits.',
    },
    {
      selector: 'ForStatement',
      message: 'Do not use for loops. Use the workflow builder for repetition, retries and waits.',
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'fs',
          importNames: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:fs',
          importNames: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'fs/promises',
          importNames: ['writeFile', 'appendFile'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:fs/promises',
          importNames: ['writeFile', 'appendFile'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:timers/promises',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'timers/promises',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'timers',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'node:timers',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
      ],
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      property: 'writeFile',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'writeFileSync',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'appendFile',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'appendFileSync',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'createWriteStream',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      object: 'globalThis',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'globalThis',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'globalThis',
      property: 'setImmediate',
      message: 'Do not use setImmediate. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'global',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'global',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'global',
      property: 'setImmediate',
      message: 'Do not use setImmediate. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'window',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'window',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'window',
      property: 'setImmediate',
      message: 'Do not use setImmediate. Use framework waiting or retry mechanisms.',
    },
  ],
  'eslint-comments/require-description': 'error',
  'eslint-comments/no-unlimited-disable': 'error',
};

export const frameworkPlugins = {
  'eslint-comments': commentsPlugin,
};

// The runner files below write the run record, the cost record, the per-card spending record, the
// interrupted-run record and its heartbeat, the live event file the Run view reads, the proof run
// that fills a run folder for the Run view, and the exit timer, so the framework rules cover the
// flow definitions only.
const flowRunnerFiles = [
  'machine/flow/run.mjs',
  'machine/flow/start.mjs',
  'machine/flow/scratch.mjs',
  'machine/flow/crash-stop.mjs',
  'machine/flow/interrupted.mjs',
  'machine/flow/proof-run.mjs',
  'machine/flow/**/*.test.mjs',
];

export default [
  {
    ignores: flowRunnerFiles,
  },
  {
    files: ['machine/flow/**'],
    plugins: frameworkPlugins,
    rules: frameworkRules,
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    // The live event file is the one thing this module writes, one line per
    // span, so the framework's write rules stay on for everything else it does.
    files: ['machine/flow/live.mjs'],
    plugins: frameworkPlugins,
    rules: {
      ...frameworkRules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:fs',
              importNames: ['writeFile', 'writeFileSync', 'appendFile', 'createWriteStream'],
              message: 'the live feed only appends lines with appendFileSync',
            },
            {
              name: 'fs',
              importNames: ['writeFile', 'writeFileSync', 'appendFile', 'createWriteStream'],
              message: 'the live feed only appends lines with appendFileSync',
            },
            { name: 'node:fs/promises', importNames: ['writeFile', 'appendFile'], message: 'the live feed appends synchronously' },
            { name: 'fs/promises', importNames: ['writeFile', 'appendFile'], message: 'the live feed appends synchronously' },
            ...(frameworkRules['no-restricted-imports']?.[1]?.paths ?? []).filter(
              path => !['node:fs', 'fs', 'node:fs/promises', 'fs/promises'].includes(path.name),
            ),
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        ...(frameworkRules['no-restricted-properties']?.slice(1) ?? []).filter(
          entry => !['writeFile', 'appendFile', 'writeFileSync', 'appendFileSync', 'createWriteStream'].includes(entry.property),
        ),
      ],
    },
  },
];
