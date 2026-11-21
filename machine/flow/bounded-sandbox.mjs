// Commands that card agents run belong to a builder slice with a fixed memory
// ceiling, and each command gets its own scope inside that slice. A runaway
// install or test run dies at the ceiling instead of taking Studio and the rest
// of the server with it. Measured on this server: `npm ci` reached 3.8 GB and an
// `npm test`-style run reached 2.5 GB, while Studio peaks near 1.6 GB.
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
export const BUILDER_MEMORY_MAX = 2700 * 1024 * 1024;
export const COMMAND_MEMORY_MAX = BUILDER_MEMORY_MAX;

// Commands that install dependencies or build a tree. They take the shared lock
// so a card's install and another card's test never overlap.
export const HEAVY_COMMAND = /(?:^|[\s;&|()])(?:npm\s+(?:ci|install|add|update|test|run)|npx\s+(?:next|playwright)|bun\s+(?:install|add|test|run)|pnpm\s+(?:install|add|test|run)|yarn(?:\s|$)|next\s+build|node\s+--test|playwright\s+test)/;

export const LOCK_WAIT_SECONDS = 1800;

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
    '--', '/bin/sh', '-c', command,
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
  constructor({ slice = BUILDER_SLICE, sliceMemoryMax: expected = BUILDER_MEMORY_MAX, commandMemoryMax = COMMAND_MEMORY_MAX, ownerUnit, jail, lock = builderLock(), env, ...options }) {
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
    Object.assign(this, { slice, sliceMemoryMax: expected, commandMemoryMax, ownerUnit, jail: jail && existsSync(jail) ? jail : null, lock });
  }

  wrapCommandForIsolation(command) {
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
