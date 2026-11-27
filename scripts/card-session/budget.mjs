// The card's dollar ledger.
//
// Mastra's stock TokenCostControl counts one observability database: one agent
// run's worth of calls, in one process. A card run here is a lead session, its
// helpers, the goal judge, and a second checker process in its own worktree, so
// no stock option covers the whole card. Each process keeps its own count in
// its own DuckDB and writes the total here; every guard reads the other side's
// total before it allows another model call.
//
// The official limit is still a threshold checked before a call, not a hard
// ceiling: one more agent run can finish over it. That is the same overshoot
// docs/agents/cost-guard.md records for the stock guard.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STATE_ROOT } from './worktree.mjs';

export const DEFAULT_LIMIT_USD = 4;
export const MINUTE = 60_000;

const round = value => Number((Number(value) || 0).toFixed(6));

export function resolveLimit(env = process.env) {
  const raw = env.CARD_LIMIT_DOLLARS ?? env.FLOW_CARD_LIMIT_DOLLARS;
  if (raw === undefined || raw === '') return DEFAULT_LIMIT_USD;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`CARD_LIMIT_DOLLARS must be a positive number, got ${raw}`);
  return value;
}

export function ledgerPath(card) {
  return join(STATE_ROOT, 'cards', card, 'ledger.json');
}

export function readLedger(path) {
  try {
    const ledger = JSON.parse(readFileSync(path, 'utf8'));
    return {
      card: ledger.card ?? null,
      limitUsd: Number(ledger.limitUsd) || 0,
      leadUsd: Number(ledger.leadUsd) || 0,
      checkerUsd: Number(ledger.checkerUsd) || 0,
      updatedAt: ledger.updatedAt ?? null,
    };
  } catch {
    return { card: null, limitUsd: 0, leadUsd: 0, checkerUsd: 0, updatedAt: null };
  }
}

export function beginLedger(card, limitUsd) {
  const path = ledgerPath(card);
  mkdirSync(dirname(path), { recursive: true });
  const ledger = { card, limitUsd, leadUsd: 0, checkerUsd: 0, updatedAt: new Date().toISOString() };
  writeLedger(path, ledger);
  return { path, ledger };
}

export function writeLedger(path, ledger) {
  const next = { ...ledger, updatedAt: new Date().toISOString() };
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, path);
  return next;
}

// A session's own spend is added to whatever earlier sessions of the same side
// already committed, so a retried checker cannot reuse spent money.
export function beginSession(path, field) {
  return round(readLedger(path)[field]);
}

export function commitSession(path, field, baselineUsd, usd) {
  const ledger = readLedger(path);
  const total = round(baselineUsd + round(usd));
  return writeLedger(path, { ...ledger, [field]: Math.max(ledger[field], total) });
}

export function remainingForLead(ledger) {
  return round(ledger.limitUsd - ledger.checkerUsd);
}

export function remainingForChecker(ledger) {
  return round(ledger.limitUsd - ledger.leadUsd - ledger.checkerUsd);
}

// TokenCostControl rejects a non-positive maxCost and then checks nothing, so a
// spent ledger must trip the guard rather than fail open.
function positive(value) {
  return value > 0 ? value : 0.000001;
}

export function makeCardCostControl(Base, { path, field, limitUsd }) {
  // The guard reads the running total of this session before every model call,
  // so it writes a session high-water mark plus the earlier sessions' committed
  // total. Accumulating each reading would count the same money many times.
  const baseline = beginSession(path, field);
  let peak = 0;

  const budget = () => {
    const ledger = readLedger(path);
    const limit = ledger.limitUsd || limitUsd;
    return field === 'leadUsd'
      ? positive(limit - ledger.checkerUsd - baseline)
      : positive(limit - ledger.leadUsd - baseline);
  };

  class CardCostControl extends Base {
    async queryCost(scopeFilter) {
      const usage = await super.queryCost(scopeFilter);
      if (typeof usage?.estimatedCost === 'number' && Number.isFinite(usage.estimatedCost)) {
        peak = Math.max(peak, usage.estimatedCost);
        commitSession(path, field, baseline, peak);
      }
      return usage;
    }
  }

  const control = new CardCostControl({
    maxCost: budget,
    scope: 'resource',
    window: '365d',
    includeBreakdown: true,
    message: 'Card dollar limit reached ({usage}/{limit}); stopping this session.',
  });
  control.sessionBaseline = baseline;
  return control;
}

export function cardFromPullRequest({ title = '', body = '', headRefName = '' } = {}) {
  const text = [headRefName, title, body].join('\n');
  return text.match(/\bJUL-\d+\b/i)?.[0]?.toUpperCase() ?? null;
}
