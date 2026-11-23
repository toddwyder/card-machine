import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { studioUnit } from './interrupted.mjs';

export const MEMORY_WATCH_MAX_AGE_MS = 45_000;
const STUDIO_UNIT_PATTERN = /^card-machine-(self-)?studio\.service$/;
const BYTES_PER_MIB = 1024 * 1024;

export function defaultMemoryWatchDir(env = process.env, home = homedir()) {
  const configured = env.FLOW_MEMORY_WATCH_DIR?.trim();
  return configured && configured !== 'off' ? configured : join(home, '.local/state/memory-watch');
}

export function isMemoryWatchEnabled({ env = process.env, unit = studioUnit() } = {}) {
  const configured = env.FLOW_MEMORY_WATCH_DIR?.trim();
  if (configured === 'off') return false;
  if (configured) return true;
  return Boolean(unit && STUDIO_UNIT_PATTERN.test(unit));
}

function jsonlFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .sort()
    .map(name => join(dir, name));
}

function parseSample(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed.t !== 'string' || !Number.isFinite(parsed.mem?.avail)) return null;
    const ms = Date.parse(parsed.t);
    return Number.isFinite(ms) ? { ...parsed, ms } : null;
  } catch {
    return null;
  }
}

function readSamples(file) {
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseSample)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function checkMemoryRecord({
  dir = defaultMemoryWatchDir(),
  now = Date.now(),
  maxAgeMs = MEMORY_WATCH_MAX_AGE_MS,
} = {}) {
  const files = jsonlFiles(dir);
  if (files.length === 0) {
    return { ok: false, reason: `Memory record is stopped: no memory-watch samples found in ${dir}.` };
  }
  const latestFile = files.at(-1);
  const samples = readSamples(latestFile);
  const latest = samples.at(-1);
  if (!latest) {
    return { ok: false, reason: `Memory record is stopped: no valid samples in ${latestFile}.` };
  }
  const ageMs = now - latest.ms;
  if (ageMs > maxAgeMs) {
    const ageSeconds = Math.round(ageMs / 1000);
    return {
      ok: false,
      reason: `Memory record is stopped: last sample in ${latestFile} was at ${latest.t} (${ageSeconds}s ago).`,
    };
  }
  return {
    ok: true,
    dir,
    latestAt: latest.t,
    availableMb: Math.floor(latest.mem.avail / BYTES_PER_MIB),
  };
}

export function lowestFreeRam({
  dir = defaultMemoryWatchDir(),
  since,
  until = new Date().toISOString(),
} = {}) {
  const sinceMs = typeof since === 'number' ? since : Date.parse(since);
  const untilMs = typeof until === 'number' ? until : Date.parse(until);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) return null;

  const matching = jsonlFiles(dir)
    .flatMap(readSamples)
    .filter(sample => sample.ms >= sinceMs && sample.ms <= untilMs);

  if (matching.length === 0) return null;
  const min = matching.reduce((best, sample) => (sample.mem.avail < best.mem.avail ? sample : best), matching[0]);
  return {
    lowestMb: Math.floor(min.mem.avail / BYTES_PER_MIB),
    at: min.t,
    samples: matching.length,
  };
}

export function resolveMemoryWatch(memoryWatch) {
  if (memoryWatch !== undefined) return memoryWatch;
  if (!isMemoryWatchEnabled()) return null;
  return {
    check: () => checkMemoryRecord(),
    lowest: options => lowestFreeRam(options),
  };
}
