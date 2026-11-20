#!/usr/bin/env node
// The card checker. One table of checks runs over a draft card before Todd approves it, and the
// result is written at the end of the draft in plain words. No model is part of the check.
//
//   node scripts/check-agent-brief.mjs <draft.md> [--root <project dir>]
//
// The draft's first line is the Linear title and the rest is the card's description. Headings, the
// done-means lines and the Checked section all come from the card reader in machine/flow/task.mjs,
// so this script keeps no copy of a heading name.
//
// Whether a proof really shows its line true is Todd's call at approval and the fresh review's, not
// this script's. The script reads wording and structure only.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CARD_PARTS, CHECKED_HEADING, withoutChecked } from '../machine/flow/task.mjs';

const HEADING_LINE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const TITLE_LINE = /^#[ \t]+(.+?)[ \t]*$/;
const BULLET = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.+)$/;
const LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const CODE = /`([^`]+)`/g;
const SHINGLE = 10;

const OPENER = 'Read .agents/skills/poteto-mode/SKILL.md and follow it.';
const OPENER_LINE = /^[ \t]*Read \.agents\/skills\/poteto-mode\/SKILL\.md and follow it\.?[ \t]*$/i;
const REQUIRED_OPENER = /^[ \t]*Read \.agents\/skills\/poteto-mode\/SKILL\.md and follow it\.?[ \t]*$/gim;

const IMPERATIVE = new Set([
  'add', 'build', 'change', 'click', 'configure', 'create', 'delete', 'deploy', 'drop',
  'edit', 'ensure', 'expose', 'fix', 'implement', 'import', 'install', 'introduce', 'make',
  'modify', 'move', 'open', 'parse', 'refactor', 'remove', 'rename', 'replace', 'return',
  'run', 'set', 'store', 'support', 'update', 'use', 'wire', 'write',
]);

const IMPLEMENTATION = /\b(?:api|apis|argument|arguments|branch|class|classes|code|column|commit|component|components|constant|constants|controller|css|database|dependency|dependencies|deploy|deployment|endpoint|endpoints|file|files|function|functions|git|handler|html|implementation|interface|interfaces|javascript|json|merge|method|methods|middleware|migration|module|modules|next\.js|npm|package|parameter|parameters|parser|query|queries|react|refactor|regex|route|router|schema|schemas|script|sql|type|types|typescript|variable|variables|yaml)\b/i;

const NEGATION = /\b(?:no|not|never|none|nothing|without|cannot|can[’']?t|won[’']?t|isn[’']?t|aren[’']?t|doesn[’']?t|don[’']?t|didn[’']?t|shouldn[’']?t|mustn[’']?t|nor|neither|nowhere)\b/i;

const MODEL = new RegExp(
  `\\b(?:${[
    'claude', 'opus', 'sonnet', 'haiku', 'gpt', 'grok', 'deepseek', 'kimi', 'gemini', 'llama',
    'mistral', 'qwen', 'beam', 'sol',
    'anthropic/', 'openai/', 'commandcode/', 'reflection/', 'moonshotai/', 'opencode/', 'kilo/',
    ':free',
  ].join('|')})\\b`,
  'i',
);

// A proof resting on one of these shows nothing on the real surface.
const WEAK_EVIDENCE = [
  [/\b(?:status|pipeline|build|ci)\b[^.]{0,20}\b(?:green|passing|passes|passed|succeeds)\b/i, 'a passing status'],
  [/\bflag\b[^.]{0,20}\b(?:set|on|true|enabled)\b/i, 'a set flag'],
  [/\blog(?:s|ged)?\b[^.]{0,30}\b(?:line|lines|says|shows|prints)\b/i, 'a log line'],
  [/\bmocks?\b/i, 'a mock'],
  [/\bscreenshot\b[^.]{0,40}\bsettings?\b/i, 'a screenshot of a settings page'],
  [/\bsettings?\b[^.]{0,25}\b(?:read back|reads back|reads as|is on|is set|shows|stays)\b/i, 'a setting read back'],
];

// What a proof needs instead: a command, a path or a test it runs.
const RUNS_SOMETHING = /`[^`]*[./][^`]*`|\b(?:test|tests|suite|fixture|script|scripts|command|curl|playwright|browser|terminal|cli|runs?|ran|output|prints?|printed|calls?)\b/i;

const STOP_INSTRUCTION = /\bstop and ask\b|\bstops? and asks?\b|\bstop (?:the run|the build)\b|\bpause (?:the run )?(?:and|to) (?:ask|check with)\b|\bask (?:Todd|the operator) (?:before|first|whether)\b|\bwait for (?:Todd|the operator) to\b/i;
const RULE_HOME = /\b(?:AGENTS\.md|path-forward\.md|autonomous-run\.md|hillclimb\.md)\b/;
const ORDER_WORD = /\b(?:before|after|then|order|first|sequence)\b/i;
const CONCURRENT = /\b(?:race|races|concurrent\w*|simultaneous\w*|interleav\w*|at the same time|in parallel|at once|threads?|workers?|queue|queues)\b/i;
const FORMAL_VERIFICATION = /\b(?:TLA\+?|PlusCal|statechart|model[- ]?check\w*|formal (?:verification|model|proof)|invariant|Apalache|TLC|Alloy)\b/i;
const TODD_CLAIM = /\b(?:Todd|the operator)\b[^.]{0,40}\b(?:approved|approves|signed off|signs off|decided|decides|chose|chosen|confirmed|confirms|accepted|accepts)\b/i;
const TODD_POSSESSIVE = /\b(?:Todd|the operator)['’]s (?:approval|sign-off|decision|confirmation)\b/i;
const TODD_CONDITIONAL = /\b(?:when|once|after|until|if|before|by)\b[^.]{0,50}\b(?:Todd|the operator)\b|\bjudged by (?:Todd|the operator)\b/i;
const APPEARANCE = /\b(?:looks?|looking|appears?|visually|visual|style|styling|design|pretty|polished|spacing|font|colour|color|layout)\b/i;
const POINTER = /(?:`[^`]+`|\[[^\]]+\]\([^)]+\))[\s.;:,]*$/;

const normalizedName = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The heading names come from the card reader; this script only maps a name to its part.
const PART_OF_NAME = new Map(CARD_PARTS.flatMap(([label, names]) => [label, ...names].map(name => [normalizedName(name), label])));
const KEPT_LABELS = CARD_PARTS.map(([label]) => label).join(', ');
const CHECKED_NAME = normalizedName(CHECKED_HEADING);

function textOf(line) {
  return line
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalize(text) {
  return textOf(String(text ?? '')).toLowerCase();
}

function words(text) {
  return normalize(text).split(' ').filter(Boolean);
}

function scanSections(rows, headings) {
  return headings.flatMap((heading, index) => {
    const part = PART_OF_NAME.get(heading.name);
    if (!part) return [];
    const end = headings.slice(index + 1).find(next => next.level <= heading.level);
    const body = rows.filter(row => row.line > heading.line && (!end || row.line < end.line));
    return [{ part, heading: heading.text, level: heading.level, headingLine: heading.line, rows: body }];
  });
}

function bulletsOf(section, stopAtSubheading = false) {
  const cut = stopAtSubheading ? section.rows.findIndex(row => HEADING_LINE.test(row.text)) : -1;
  const rows = cut >= 0 ? section.rows.slice(0, cut) : section.rows;
  return rows.flatMap(row => {
    const bullet = BULLET.exec(row.text);
    return bullet ? [{ text: bullet[1].trim(), line: row.line }] : [];
  });
}

function knownBullets(section) {
  const found = [];
  let unverifiedLevel = null;
  for (const row of section.rows) {
    const heading = HEADING_LINE.exec(row.text);
    if (heading) {
      const level = heading[1].length;
      if (unverifiedLevel !== null && level <= unverifiedLevel) unverifiedLevel = null;
      if (/unverified/.test(normalizedName(heading[2]))) unverifiedLevel = level;
      continue;
    }
    const bullet = BULLET.exec(row.text);
    if (!bullet) continue;
    const text = bullet[1].trim();
    found.push({ line: row.line, text, unverified: unverifiedLevel !== null || /^unverified\b/i.test(text) });
  }
  return found;
}

export function parseDraft(text) {
  const body = withoutChecked(text);
  const lines = body.split(/\r?\n/);
  const titleMatch = TITLE_LINE.exec(lines[0] ?? '');
  const offset = titleMatch ? 1 : 0;
  const rows = lines.slice(offset).map((line, index) => ({ text: line, line: index + offset + 1 }));
  const headings = rows.flatMap(row => {
    const match = HEADING_LINE.exec(row.text);
    return match ? [{ level: match[1].length, text: match[2].trim(), name: normalizedName(match[2]), line: row.line }] : [];
  });
  const sections = scanSections(rows, headings);
  const sectionOf = part => sections.find(section => section.part === part);
  const done = sectionOf('Done check');
  const proof = sectionOf('Proof');
  const known = sectionOf('What is already known');
  const opener = rows.find(row => row.text.trim());
  return {
    text: String(text ?? ''),
    body,
    title: titleMatch ? titleMatch[1] : '',
    description: rows.map(row => row.text).join('\n'),
    rows,
    headings,
    sections,
    opener: opener ? { text: opener.text.trim(), line: opener.line } : null,
    doneHeading: done?.heading ?? '',
    doneMeans: done ? bulletsOf(done, true) : [],
    proofs: proof ? bulletsOf(proof) : [],
    known: known ? knownBullets(known) : [],
  };
}

// Every card opens with this line (AGENTS.md), so the copied-text check leaves it out.
function shingles(wordsList, size) {
  const values = new Set();
  for (let index = 0; index + size <= wordsList.length; index += 1) {
    values.add(wordsList.slice(index, index + size).join(' '));
  }
  return values;
}

export function findCopiedText({ text, docs }) {
  const brief = String(text ?? '').replace(REQUIRED_OPENER, '');
  const briefWords = words(brief);
  const briefShingles = shingles(briefWords, SHINGLE);
  const findings = [];
  if (!briefShingles.size) return findings;
  for (const doc of docs) {
    const docShingles = shingles(words(doc.text), SHINGLE);
    for (const shingle of briefShingles) {
      if (docShingles.has(shingle)) {
        findings.push(`copies text from ${doc.file}: "${shingle}"`);
        break;
      }
    }
  }
  return findings;
}

function markdownFiles(root, except) {
  if (!existsSync(root)) return [];
  let files;
  try {
    files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    files = [];
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.md')) files.push(relative(root, path));
      }
    };
    visit(root);
  }
  return files.map(file => resolve(root, file)).filter(file => file !== except && existsSync(file));
}

function docsOf(ctx) {
  if (!ctx.docs) {
    ctx.docs = markdownFiles(ctx.root, ctx.file).map(path => ({ file: relative(ctx.root, path), text: readFileSync(path, 'utf8') }));
  }
  return ctx.docs;
}

const PATH_LIKE = /^(?:\.{0,2}\/)?[\w.@+-]+(?:\/[\w.@+-]*)+\/?$|^[\w.@+-]+\.(?:mjs|cjs|js|mts|ts|tsx|jsx|md|json|ya?ml|sh|toml|txt|ini)$/i;

function pathInSpan(span) {
  for (const token of span.split(/\s+/).filter(Boolean)) {
    const cleaned = token.replace(/^[(`'"<]+/, '').replace(/[)`'"<>,.;:]+$/, '');
    if (!cleaned || cleaned.startsWith('-')) continue;
    if (PATH_LIKE.test(cleaned)) return cleaned;
  }
  return null;
}

function resolveReference(target, ctx) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return { kind: 'url', url: target };
  const path = target.replace(/[#?].*$/, '').replace(/:\d+$/, '').replace(/^\.\//, '');
  if (!path) return null;
  // A span such as free/paid reads as a choice, not a path: with no extension and no directory
  // that exists, the card is not naming a file.
  const readsAsProse = !/\.[\w]+$/.test(path) && !path.startsWith('/') && !directoryExists(path, ctx);
  if (readsAsProse) return null;
  for (const base of [ctx.root, ctx.machineRoot]) {
    if (base && existsSync(resolve(base, path))) return { kind: 'file', path };
  }
  return { kind: 'missing', path };
}

function directoryExists(path, ctx) {
  const head = path.split('/')[0];
  return [ctx.root, ctx.machineRoot].some(base => base && existsSync(resolve(base, head)));
}

const passed = (details = []) => ({ status: 'passed', details });
const failed = (details = []) => ({ status: 'failed', details });
const unchecked = (details = []) => ({ status: 'not checked', details });

function proceduralFinding(criterion) {
  const first = normalize(textOf(criterion.text)).split(' ')[0];
  return IMPERATIVE.has(first) ? `${criterion.id} is procedural ("${first} ..."); write the observed outcome instead` : null;
}

function implementationFinding(criterion) {
  const implementation = IMPLEMENTATION.exec(textOf(criterion.text));
  return implementation ? `${criterion.id} uses the implementation word "${implementation[0]}"; describe what Todd sees instead` : null;
}

function negationFinding(criterion) {
  const negation = NEGATION.exec(textOf(criterion.text));
  return negation ? `${criterion.id} uses the negation "${negation[0]}"; state the positive behavior instead` : null;
}

function modelFinding(criterion) {
  // Matched against the raw text, because plain drops the slash from a provider address such as commandcode/reflection/beam.
  const model = MODEL.exec(String(criterion.text ?? ''));
  return model ? `${criterion.id} names the model "${model[0]}"; name a kind of model, such as a free model, and leave the specific one in the pstack models file` : null;
}

export function checkCriterion(criterion) {
  return [proceduralFinding, implementationFinding, negationFinding, modelFinding]
    .map(apply => apply(criterion))
    .filter(Boolean);
}


// One row per check, in the order Todd reads them. A row that cannot judge says so instead of
// failing, and the last line of the section says whether the card is ready.
export const CHECKS = [
  {
    id: 'copied-text',
    title: 'No text is copied from the repository docs',
    // A file that holds this very draft is the draft, not a doc it copies from.
    run: async (draft, ctx) => {
      const self = new Set([words(draft.body).join(' '), words(draft.description).join(' ')]);
      const docs = docsOf(ctx).filter(doc => !self.has(words(doc.text).join(' ')));
      const findings = findCopiedText({ text: draft.description, docs });
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'done-means',
    title: 'The card lists its done-means lines under a heading the card reader keeps',
    run: async draft => (draft.doneMeans.length
      ? passed([`${draft.doneMeans.length} ${draft.doneMeans.length === 1 ? 'line reads' : 'lines read'} as done-means lines`])
      : failed([`no done-means lines; list them under ${KEPT_LABELS.split(', ')[1]} or another name the card reader keeps`])),
  },
  {
    id: 'outcome-form',
    title: 'Done-means lines describe an outcome, not a step',
    run: async draft => {
      const findings = draft.doneMeans.map(line => proceduralFinding({ id: `line ${line.line}`, text: line.text })).filter(Boolean);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'implementation-words',
    title: 'Done-means lines name no implementation detail',
    run: async draft => {
      const findings = draft.doneMeans.map(line => implementationFinding({ id: `line ${line.line}`, text: line.text })).filter(Boolean);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'negations',
    title: 'Done-means lines carry no negation',
    run: async draft => {
      const findings = draft.doneMeans.map(line => negationFinding({ id: `line ${line.line}`, text: line.text })).filter(Boolean);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'five-lines',
    title: 'At most five done-means lines',
    run: async draft => {
      if (draft.doneMeans.length <= 5) return passed();
      return failed([`${draft.doneMeans.length} done-means lines; the sixth starts on line ${draft.doneMeans[5].line}`]);
    },
  },
  {
    id: 'proof-count',
    title: 'One proof for each done-means line, in the same order',
    run: async draft => {
      if (draft.doneMeans.length === draft.proofs.length) return passed();
      const bare = draft.doneMeans.slice(draft.proofs.length);
      const extra = draft.proofs.slice(draft.doneMeans.length);
      const details = [`${draft.doneMeans.length} done-means lines but ${draft.proofs.length} proofs`];
      if (bare.length) details.push(`line ${bare[0].line} has no proof`);
      if (extra.length) details.push(`the proof on line ${extra[0].line} answers no done-means line`);
      return failed(details);
    },
  },
  {
    id: 'proof-evidence',
    title: 'Each proof says what runs, and rests on more than a status, flag, log, mock or setting',
    run: async draft => {
      const findings = [];
      for (const proof of draft.proofs) {
        const weak = WEAK_EVIDENCE.find(([pattern]) => pattern.test(proof.text));
        if (weak && !RUNS_SOMETHING.test(proof.text)) {
          findings.push(`line ${proof.line} rests on ${weak[1]}; run the real thing and show what it prints`);
        } else if (!RUNS_SOMETHING.test(proof.text)) {
          findings.push(`line ${proof.line} says nothing runs there; name the command or the test that shows the line true`);
        }
      }
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'opener',
    title: 'The first line of the card is the poteto-mode line',
    run: async draft => {
      if (draft.opener && OPENER_LINE.test(draft.opener.text)) return passed();
      return failed([`line ${draft.opener?.line ?? 2} reads "${draft.opener?.text ?? ''}"; the first line is "${OPENER}"`]);
    },
  },
  {
    id: 'references',
    title: 'Every file, script, skill and link the card names resolves',
    run: async (draft, ctx) => {
      const findings = [];
      const pending = [];
      for (const row of draft.rows) {
        const targets = [
          ...[...row.text.matchAll(LINK)].map(match => match[2]),
          ...[...row.text.matchAll(CODE)].map(match => pathInSpan(match[1])).filter(Boolean),
        ];
        for (const target of targets) {
          const reference = resolveReference(target, ctx);
          if (!reference) continue;
          if (reference.kind === 'missing') {
            findings.push(`line ${row.line}: ${reference.path} is in neither the project nor the machine`);
          } else if (reference.kind === 'url') {
            const answer = await ctx.fetchLink(reference.url);
            if (answer.status === 'missing') findings.push(`line ${row.line}: ${reference.url} answers 404`);
            else if (answer.status !== 'ok') pending.push(`line ${row.line}: ${reference.url} gave no clear answer (${answer.reason ?? 'no answer'})`);
          }
        }
      }
      if (findings.length) return failed(findings);
      if (pending.length) return unchecked(pending);
      return passed();
    },
  },
  {
    id: 'headings',
    title: 'Every heading is one the card reader keeps',
    run: async draft => {
      const findings = [];
      let openLevel = null;
      for (const heading of draft.headings) {
        if (openLevel !== null && heading.level <= openLevel) openLevel = null;
        if (PART_OF_NAME.has(heading.name)) {
          openLevel = heading.level;
          continue;
        }
        if (openLevel !== null) continue;
        findings.push(`line ${heading.line}: "${heading.text}" is not a heading the card reader keeps; use ${KEPT_LABELS}`);
      }
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'stop-and-ask',
    title: 'No line tells the agent to stop and ask, and an event-order line names formal verification',
    run: async draft => {
      const findings = [];
      for (const row of draft.rows) {
        if (STOP_INSTRUCTION.test(row.text) && !RULE_HOME.test(row.text)) {
          findings.push(`line ${row.line} tells the agent when to stop and ask; stop rules live in AGENTS.md, docs/plans/path-forward.md and the pstack autonomous-run and hillclimb playbooks`);
        }
      }
      draft.doneMeans.forEach((line, index) => {
        if (!ORDER_WORD.test(line.text) || !CONCURRENT.test(line.text)) return;
        const proof = draft.proofs[index];
        if (proof && FORMAL_VERIFICATION.test(proof.text)) return;
        findings.push(`line ${line.line} orders events in product code, so its proof names a TLA+ or statechart run; line ${proof?.line ?? line.line} names none`);
      });
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'todd-approval',
    title: "No line claims Todd's approval or decision",
    run: async draft => {
      const findings = draft.rows
        .filter(row => (TODD_CLAIM.test(row.text) || TODD_POSSESSIVE.test(row.text)) && !TODD_CONDITIONAL.test(row.text))
        .map(row => `line ${row.line} claims a decision Todd has given; state the rule the card needs instead`);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'model-names',
    title: 'No line names a specific model',
    run: async draft => {
      const findings = draft.rows
        .filter(row => {
          const stripped = row.text.replace(/\]\([^)]*\)/g, ']').replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
          return MODEL.test(stripped);
        })
        .map(row => `line ${row.line} names a specific model; name a kind of model, such as a free model, and leave the specific one in the pstack models file`);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'known-pointers',
    title: 'Each line of what the card already knows ends with its source',
    run: async draft => {
      const findings = draft.known
        .filter(line => !line.unverified && !POINTER.test(line.text))
        .map(line => `line ${line.line} ends without a pointer; add the path or link that proves it, or move it under Unverified`);
      return findings.length ? failed(findings) : passed();
    },
  },
  {
    id: 'appearance',
    title: 'At most one done-means line is judged by appearance',
    run: async draft => {
      const found = draft.doneMeans.filter(line => APPEARANCE.test(line.text));
      if (found.length <= 1) return passed();
      return failed([`${found.length} done-means lines are judged by appearance (lines ${found.map(line => line.line).join(' and ')}); a card carries at most one`]);
    },
  },
];

export async function checkDraft(draft, ctx) {
  const results = [];
  for (const check of CHECKS) {
    const outcome = await check.run(draft, ctx);
    results.push({ id: check.id, title: check.title, status: outcome.status, details: outcome.details ?? [] });
  }
  return results;
}

const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);

export function renderChecked(results) {
  const failures = results.filter(result => result.status === 'failed').length;
  const pending = results.filter(result => result.status === 'not checked').length;
  const lines = results.map(({ title, status, details }) => {
    const label = status === 'not checked' ? 'Not checked' : status === 'failed' ? 'Failed' : 'Passed';
    const detail = details.length ? ` ${details.map(sentence).join(' ')}` : '';
    return `- ${label}: ${title}.${detail}`;
  });
  const verdict = failures
    ? `${failures} of ${results.length} checks failed, so the card is not ready.`
    : pending
      ? `All ${results.length - pending} checks passed and ${pending} could not be checked; Todd judges those.`
      : `All ${results.length} checks passed.`;
  return [`## ${CHECKED_HEADING}`, '', ...lines, '', verdict].join('\n');
}

export function writeChecked(text, results) {
  return `${withoutChecked(text).trimEnd()}\n\n${renderChecked(results)}\n`;
}

export const MACHINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function defaultFetchLink(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (response.status === 404) return { status: 'missing' };
    if (response.status >= 200 && response.status < 400) return { status: 'ok' };
    return { status: 'unreachable', reason: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'unreachable', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export function contextFor({ root = process.cwd(), machineRoot = MACHINE_ROOT, fetchLink = defaultFetchLink, file } = {}) {
  return { root: resolve(root), machineRoot, fetchLink, file, docs: null };
}

function parseArgs(args) {
  const options = { root: '.', file: null, text: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--root') options.root = args[(index += 1)];
    else if (arg === '--text') options.text = args[(index += 1)];
    else options.file = arg;
  }
  return options;
}

async function main(args) {
  const options = parseArgs(args);
  if (!options.file && options.text === null) {
    console.error('usage: node scripts/check-agent-brief.mjs <draft.md> [--root <dir>]');
    return 2;
  }
  const file = options.file ? resolve(options.file) : null;
  const text = options.text ?? readFileSync(file, 'utf8');
  const results = await checkDraft(parseDraft(text), contextFor({ root: options.root, file }));
  if (file) writeFileSync(file, writeChecked(text, results));
  console.log(renderChecked(results));
  return results.some(result => result.status === 'failed') ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => {
    if (code) process.exitCode = code;
  }, error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
