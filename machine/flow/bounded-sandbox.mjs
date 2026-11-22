// Commands that card agents run belong to a builder slice with a fixed memory
// ceiling, and each command gets its own scope inside that slice. A runaway
// install or test run dies at the ceiling instead of taking Studio and the rest
// of the server with it. Measured on this server, unconstrained: a dashboard
// `npm ci` peaked at 4,720,484,352 bytes and Studio at 1,777,201,152 bytes. The
// ceiling is the npm ci peak plus 5 percent of headroom.
//
// The same commands run inside a bubblewrap jail that makes everything outside
// the card's own copy read only, so an agent cannot build a second checkout
// somewhere else. Commands that install or build also take one shared lock, so
// two of them never run at once.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { LocalSandbox } from '@mastra/core/workspace';

export const BUILDER_SLICE = 'card-builder.slice';

// Ceilings are whole mebibytes so the numbers here match what `systemctl show`
// reports for the slice.
export const BUILDER_MEMORY_MAX = 4700 * 1024 * 1024;
export const COMMAND_MEMORY_MAX = BUILDER_MEMORY_MAX;

// Commands that install dependencies or build a tree. They take the shared lock
// so a card's install and another card's test never overlap.
export const LOCK_WAIT_SECONDS = 1800;

const INSTALLER_SUBCOMMANDS = new Set([
  'ci', 'clean-install', 'ic', 'cit', 'install-ci-test',
  'install', 'i', 'it', 'install-test',
  'add', 'update', 'up', 'upgrade',
]);
const YARN_SUBCOMMANDS = new Set(['install', 'add', 'up', 'upgrade']);
const HEAVY_NPM_SUBCOMMANDS = new Set([...INSTALLER_SUBCOMMANDS, 'test', 't', 'run', 'run-script', 'exec', 'build']);
const HEAVY_RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const HEAVY_RUNNER_TOOLS = new Set(['next', 'playwright', 'stryker', 'vitest', 'tsc', 'eslint']);
const HEAVY_BROWSERS = new Set(['chrome', 'chrome-headless-shell', 'chromium']);
const WRAPPER_BINARIES = new Set(['exec', 'nohup', 'command', 'env', 'nice', 'timeout', 'stdbuf', 'time']);
const SHELL_BINARIES = new Set(['sh', 'bash', 'dash', 'zsh']);
const FLAG_WITH_VALUE = new Set([
  '--prefix', '-C', '--cwd', '--dir', '--userconfig', '--cache', '--registry',
  '--workspace', '-w', '--loglevel', '--filter', '-F', '--config', '--globalconfig',
  '--script-shell', '--tag', '--otp', '--scope', '--color', '--package', '-p',
  '--chdir', '-u', '--unset', '--adjustment',
  '-n', '-k', '-s', '--kill-after', '--signal',
  '-i', '-o', '-e', '--input', '--output', '--error',
  '-r', '--require', '--import', '--loader', '--conditions',
]);
const SPAWN_CALL_RE = /\b(?:child_process|exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|subprocess|Popen|os\.system)\b/;

const splitChains = command =>
  command.match(/(?:'[^']*'|"[^"]*"|(?<!\|)\|(?!\|)|[^;&|(){}\n`])+/g) ?? [];

const splitPipeline = chain =>
  chain.match(/(?:'[^']*'|"[^"]*"|[^|])+/g) ?? [];

const splitTokens = segment =>
  (segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(token => token.replace(/^(['"])(.*)\1$/, '$2'));

const skipLeadingFlags = tokens => {
  if (tokens.length === 0) return tokens;
  const [head, ...rest] = tokens;
  if (head === '--') return rest;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) return skipLeadingFlags(rest);
  if (FLAG_WITH_VALUE.has(head)) return skipLeadingFlags(rest.slice(1));
  if (head.startsWith('-')) return skipLeadingFlags(rest);
  return tokens;
};

const skipWrappers = tokens => {
  if (tokens.length === 0) return tokens;
  const [head, ...rest] = tokens;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) return skipWrappers(rest);
  const bin = head.split('/').at(-1);
  if (bin === 'timeout') return skipWrappers(skipLeadingFlags(rest).slice(1));
  if (bin === 'env' || bin === 'nice' || bin === 'stdbuf' || bin === 'time') return skipWrappers(skipLeadingFlags(rest));
  if (WRAPPER_BINARIES.has(bin)) return skipWrappers(rest);
  return tokens;
};

const inlineScriptArg = (bin, rest) => {
  const isFlag = bin === 'python' || bin === 'python3'
    ? token => token === '-c'
    : token => token === '-e' || token === '--eval' || token === '-p' || token === '--print';
  const index = rest.findIndex(isFlag);
  return index >= 0 ? rest[index + 1] ?? '' : '';
};

const extractQuotedStrings = code =>
  Array.from(code.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g), m => m[1] ?? m[2] ?? m[3] ?? '');

const matchStage = (tokens, checkTokens) => {
  if (tokens.length === 0) return false;
  const [head, ...rest] = tokens;
  const bin = head.split('/').at(-1);
  if (SHELL_BINARIES.has(bin)) {
    const cIndex = rest.findIndex(token => token === '-c' || /^-[a-z]*c[a-z]*$/.test(token));
    return cIndex >= 0 && rest[cIndex + 1] ? matchCommand(rest[cIndex + 1], checkTokens) : false;
  }
  if (bin === 'eval') {
    return rest.length > 0 ? matchCommand(rest.join(' '), checkTokens) : false;
  }
  if (bin === 'node' || bin === 'bun' || bin === 'python' || bin === 'python3') {
    const code = inlineScriptArg(bin, rest);
    if (code && SPAWN_CALL_RE.test(code)) {
      const literals = extractQuotedStrings(code);
      if (literals.some(lit => matchCommand(lit, checkTokens))) return true;
      if (literals.length > 1 && matchCommand(literals.join(' '), checkTokens)) return true;
    }
  }
  return checkTokens(bin, rest);
};

const matchCommand = (command, checkTokens) => {
  if (typeof command !== 'string') return false;
  return splitChains(command).some(chain => {
    const stages = splitPipeline(chain).map(seg => skipWrappers(splitTokens(seg)));
    if (stages.some(stage => matchStage(stage, checkTokens))) return true;
    return stages.some((stage, index) => {
      if (index === 0 || stage.length === 0) return false;
      const bin = stage[0].split('/').at(-1);
      if (!SHELL_BINARIES.has(bin)) return false;
      const prev = stages[index - 1];
      return prev.length > 1 && matchCommand(prev.slice(1).join(' '), checkTokens);
    });
  });
};

const checkInstallerTokens = (bin, rest) => {
  if (bin === 'npm' || bin === 'pnpm' || bin === 'bun') {
    const [sub] = skipLeadingFlags(rest);
    return Boolean(sub && INSTALLER_SUBCOMMANDS.has(sub));
  }
  if (bin === 'yarn') {
    const [sub] = skipLeadingFlags(rest);
    return !sub || YARN_SUBCOMMANDS.has(sub);
  }
  return false;
};

const checkHeavyTokens = (bin, rest) => {
  if (bin === 'npm' || bin === 'pnpm' || bin === 'bun') {
    const [sub] = skipLeadingFlags(rest);
    return Boolean(sub && HEAVY_NPM_SUBCOMMANDS.has(sub));
  }
  if (HEAVY_RUNNERS.has(bin)) {
    const [sub] = skipLeadingFlags(rest);
    return Boolean(sub && HEAVY_RUNNER_TOOLS.has(sub.split('/').at(-1)));
  }
  if (bin === 'yarn') return true;
  if (bin === 'node') return rest.includes('--test');
  if (bin === 'next') return skipLeadingFlags(rest)[0] === 'build';
  if (bin === 'playwright') return skipLeadingFlags(rest)[0] === 'test';
  if (bin === 'stryker') return skipLeadingFlags(rest)[0] === 'run';
  return HEAVY_BROWSERS.has(bin);
};

export function isInstallerCommand(command) {
  return matchCommand(command, checkInstallerTokens);
}

export function isHeavyCommand(command) {
  return matchCommand(command, checkHeavyTokens);
}

export const HEAVY_COMMAND = Object.freeze({ test: isHeavyCommand });

const INSTALLER_REFUSAL = 'Package installers are refused during a card run. Dependencies are managed by the card copy; report missing dependencies to the Lead instead.';

const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

const unitName = (value, suffix) => {
  if (typeof value !== 'string' || !new RegExp(`^[a-zA-Z0-9_.@:-]+\\.${suffix}$`).test(value)) {
    throw new TypeError(`Expected a systemd ${suffix} unit name`);
  }
  return value;
};

const positive = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Memory limit must be a positive integer number of bytes');
  return value;
};

export function builderLock() {
  return `/run/user/${process.getuid()}/card-builder.lock`;
}

export function sliceMemoryMax(slice = BUILDER_SLICE) {
  try {
    const value = execFileSync('systemctl', ['--user', 'show', unitName(slice, 'slice'), '--property=MemoryMax', '--value'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  } catch {
    return null;
  }
}

// Systemd owns the aggregate slice and each command's scope. Mastra keeps the
// process handle, the streaming output, the timeout, and the abort. The scope
// binds to Studio, so a command stops when Studio stops rather than outliving
// the process that started it.
export function boundedCommand(command, { slice = BUILDER_SLICE, memoryMax = COMMAND_MEMORY_MAX, ownerUnit, lock, description = 'Card builder command' } = {}) {
  positive(memoryMax);
  const parts = [
    'systemd-run', '--user', '--scope', '--quiet',
    `--description=${description}`,
    `--unit=card-builder-command-${randomUUID()}.scope`,
    `--slice=${unitName(slice, 'slice')}`,
    `--property=MemoryMax=${memoryMax}`,
    '--property=MemorySwapMax=0',
    ...(ownerUnit
      ? [`--property=BindsTo=${unitName(ownerUnit, 'service')}`, `--property=Requisite=${unitName(ownerUnit, 'service')}`, `--property=PartOf=${unitName(ownerUnit, 'service')}`, `--property=After=${unitName(ownerUnit, 'service')}`]
      : []),
    '--', 'env', '-u', 'DBUS_SESSION_BUS_ADDRESS', '/bin/sh', '-c', command,
  ];
  const scoped = parts.map(quote).join(' ');
  return lock ? `flock --timeout ${LOCK_WAIT_SECONDS} ${quote(lock)} /bin/sh -c ${quote(scoped)}` : scoped;
}

// Everything outside the card's copy is mounted read only. Writes inside the
// copy and in /tmp work; a second checkout, an install into another tree, or a
// write to the user's home do not.
export function jailedCommand(command, folder) {
  const options = [
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--proc', '/proc',
    '--bind', folder, folder,
    '--bind', '/tmp', '/tmp',
    '--die-with-parent',
    '--', '/bin/sh', '-c', command,
  ];
  return ['bwrap', ...options].map(quote).join(' ');
}

export class BoundedLocalSandbox extends LocalSandbox {
  constructor({ slice = BUILDER_SLICE, sliceMemoryMax: expected = BUILDER_MEMORY_MAX, commandMemoryMax = COMMAND_MEMORY_MAX, ownerUnit, jail, lock = builderLock(), prepare = null, env, ...options }) {
    if (process.platform !== 'linux' || (options.isolation && options.isolation !== 'none')) {
      throw new Error('BoundedLocalSandbox requires Linux and the local isolation backend');
    }
    slice = unitName(slice, 'slice');
    ownerUnit = ownerUnit ? unitName(ownerUnit, 'service') : null;
    positive(expected);
    positive(commandMemoryMax);
    if (commandMemoryMax > expected) throw new RangeError('Command limit exceeds slice limit');
    if (jail !== undefined && (typeof jail !== 'string' || !jail.startsWith('/'))) throw new TypeError('Jail must be an absolute folder path');
    const actual = sliceMemoryMax(slice);
    if (actual !== expected) {
      throw new Error(`${slice} allows ${actual ?? 'no measured memory'}; set it to ${expected} before card commands can run`);
    }
    const runtimeDir = `/run/user/${process.getuid()}`;
    super({ ...options, env: { ...env, XDG_RUNTIME_DIR: runtimeDir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir}/bus` } });
    Object.assign(this, { slice, sliceMemoryMax: expected, commandMemoryMax, ownerUnit, jail: jail && existsSync(jail) ? jail : null, lock, prepare });
    const runCommand = this.executeCommand.bind(this);
    this.executeCommand = async (command, args = [], executeOptions = {}) => {
      const full = Array.isArray(args) && args.length > 0 ? `${command} ${args.join(' ')}` : command;
      if (isInstallerCommand(full)) throw new Error(INSTALLER_REFUSAL);
      if (typeof this.prepare === 'function') await this.prepare();
      return runCommand(command, args, executeOptions);
    };
  }

  wrapCommandForIsolation(command) {
    if (isInstallerCommand(command)) throw new Error(INSTALLER_REFUSAL);
    const slice = quote(this.slice);
    let inner = this.jail ? jailedCommand(command, this.jail) : command;
    if (this.lock && HEAVY_COMMAND.test(command)) {
      inner = `exec flock --timeout ${LOCK_WAIT_SECONDS} ${quote(this.lock)} /bin/sh -c ${quote(inner)}`;
    }
    const scoped = boundedCommand(inner, { slice: this.slice, memoryMax: this.commandMemoryMax, ownerUnit: this.ownerUnit });
    return {
      // The slice ceiling is asserted on every command: a run that starts from a
      // slice someone raised or removed refuses to work instead of assuming the
      // bound is still there.
      command: `test "$(systemctl --user show ${slice} --property=MemoryMax --value)" = ${quote(this.sliceMemoryMax)} && exec ${scoped}`,
      args: [],
    };
  }
}
