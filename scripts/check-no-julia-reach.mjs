#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_EXTENSIONS = new Set([
  '.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.yml', '.yaml', '.sh', '.conf', '.env',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  'dashboard/package-lock.json',
  'scripts/check-no-julia-reach.mjs',
  'scripts/server-in-use.mjs',
  'scripts/check-server-in-use.mjs',
  'scripts/check-server-in-use.test.mjs',
]);

const SKIP_PREFIXES = [
  'docs/',
  'graphify-out/',
  'machine/merge/',
  'machine/remediation/',
  'machine/shipping/',
];

const REACH_PATTERNS = [
  { label: 'julia-next GitHub repository reference', pattern: /\btoddwyder\/julia-next\b|\bjulia-next\.git\b/i },
  { label: 'julia-next local checkout path', pattern: /\/julia-next\b|(?:\.\.\/)+julia(?!-agents\b)[\w-]*/i },
  { label: 'OVH Julia checkout reference', pattern: /\/home\/ubuntu\/julia-(?:flow-repo|builder|dashboard|mastra)\b/i },
  { label: 'relative import into Julia app/lib', pattern: /(?:\.\.\/)+(?:app|lib)\// },
];

function listFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
  } catch {
    const files = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push(relative(root, full).replaceAll('\\', '/'));
      }
    };
    walk(root);
    return files;
  }
}

export function checkNoJuliaReach(root = process.cwd()) {
  const failures = [];
  for (const file of listFiles(root)) {
    if (SKIP_FILES.has(file) || file.endsWith('.test.mjs')) continue;
    if (SKIP_PREFIXES.some(prefix => file.startsWith(prefix))) continue;
    if (!CODE_EXTENSIONS.has(extname(file))) continue;
    const full = join(root, file);
    if (!existsSync(full)) continue;
    const lines = readFileSync(full, 'utf8').split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.replace(/https:\/\/linear\.app\/julia-next[^\s'"`]*/gi, '');
      for (const { label, pattern } of REACH_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          failures.push(`${file}:${index + 1}: ${label} (${match[0]})`);
        }
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkNoJuliaReach(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(`Julia repository reach check failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('No reach into Julia repository found.');
  }
}
