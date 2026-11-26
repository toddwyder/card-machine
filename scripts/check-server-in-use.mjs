#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { evaluateServerState, formatDryRun, formatReport, IN_USE_SPEC } from './server-in-use.mjs';

const execFileAsync = promisify(execFile);

const COLLECT_SCRIPT = `python3 - << 'PY'
import json, os, re, subprocess, urllib.request

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout

def parse_units(cmd):
    out = []
    for line in run(cmd).splitlines():
        parts = line.split(None, 4)
        if len(parts) >= 4:
            out.append({'name': parts[0], 'load': parts[1], 'active': parts[2], 'sub': parts[3]})
    return out

def unit_files_by_state(scope):
    cmd = ['systemctl', 'list-unit-files', '--state=enabled', '--no-legend', '--plain']
    if scope == 'user':
        cmd.insert(1, '--user')
    return [line.split()[0] for line in run(cmd).splitlines() if line.strip()]

def du_entries(base):
    if not os.path.isdir(base):
        return []
    items = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        try:
            out = run(['du', '-sm', path]).strip()
            mb = int(out.split()[0]) if out else 0
        except Exception:
            mb = 0
        items.append({'name': name, 'path': path, 'diskMb': mb, 'isDir': os.path.isdir(path)})
    return items

active_cards = []
runs_list = []
studio_reachable = False
studio_error = None
studio_url = os.environ.get('FLOW_STUDIO_URL', 'http://127.0.0.1:4112').rstrip('/')
studio_dir = os.environ.get('FLOW_STUDIO_DIR', '/home/ubuntu/card-machine/.artifacts/flow/studio')
try:
    with urllib.request.urlopen(f'{studio_url}/api/workflows/card-path/runs', timeout=3) as resp:
        if resp.status != 200:
            studio_error = f'HTTP {resp.status}'
        else:
            data = json.loads(resp.read().decode())
            runs = data.get('runs') if isinstance(data, dict) else None
            if not isinstance(runs, list):
                studio_error = 'Unexpected Studio response shape'
            else:
                studio_reachable = True
                ended = ('success', 'failed', 'canceled', 'cancelled', 'error', 'tripwire')
                for r in runs:
                    snap = r.get('snapshot') or {}
                    status = str(snap.get('status') or '').lower()
                    value = snap.get('value') or {}
                    initial = snap.get('initialState') or {}
                    context = snap.get('context') or {}
                    entered = (context.get('input') or {}) if isinstance(context, dict) else {}
                    card = value.get('card') or initial.get('card') or entered.get('card')
                    if card:
                        # Every run Studio still holds is listed, so a folder is only a finished run's
                        # when Studio says that card is over. Nothing is guessed from the folder name.
                        runs_list.append({'card': str(card), 'status': status, 'ended': status in ended})
                        if status in ended:
                            continue
                        # Anything Studio has not finished still needs its folders, whatever it is called now.
                        active_cards.append(str(card))
except Exception as exc:
    studio_error = str(exc)
    # Half a run list cannot be trusted to say which cards are running, so nothing is called ended.
    studio_reachable = False
    active_cards = []
    runs_list = []

ancestor_pids = set()
cur = os.getpid()
while cur > 1 and cur not in ancestor_pids:
    ancestor_pids.add(cur)
    try:
        stat = open(f'/proc/{cur}/stat').read()
        cur = int(stat[stat.rfind(')') + 2:].split()[1])
    except Exception:
        break

processes = []
ppid_of = {}
attached_pids = set()
for line in run(['ps', '-u', 'ubuntu', '-o', 'pid=,ppid=,rss=,args=']).splitlines():
    m = re.match(r'^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(.*)$', line)
    if not m:
        continue
    pid, ppid, rss_kb, cmd = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
    ppid_of[pid] = ppid
    service_unit = None
    try:
        cg = open(f'/proc/{pid}/cgroup').read()
        matches = re.findall(r'([a-zA-Z0-9_.@-]+\\.service)', cg)
        if matches and matches[-1] != 'user@1000.service':
            service_unit = matches[-1]
    except Exception:
        pass
    attached = False
    if pid != os.getpid():
        try:
            attached = os.readlink(f'/proc/{pid}/fd/0').startswith(('/dev/pts/', '/dev/tty'))
        except Exception:
            pass
    if attached:
        attached_pids.add(pid)
    in_use_op = False
    if re.search(r'\\bop daemon\\b', cmd):
        try:
            cwd = os.readlink(f'/proc/{pid}/cwd')
            in_use_op = cwd == '/home/ubuntu' or cwd == '/home/ubuntu/julia-builder'
        except Exception:
            pass
    processes.append({'pid': pid, 'ppid': ppid, 'rssKb': rss_kb, 'cmd': cmd, 'serviceUnit': service_unit, 'inUseOpDaemon': in_use_op, 'isSelfOrAncestor': pid in ancestor_pids, 'attachedToTerminal': attached})

operator_session = set(attached_pids)
for pid in list(ppid_of):
    walk = pid
    for _ in range(64):
        walk = ppid_of.get(walk)
        if not walk:
            break
        if walk in attached_pids:
            operator_session.add(pid)
            break
walk = None
for pid in attached_pids:
    walk = ppid_of.get(pid)
    while walk:
        operator_session.add(walk)
        walk = ppid_of.get(walk)
for proc in processes:
    proc['operatorSession'] = proc['pid'] in operator_session

checkouts = []
worktrees = []
seen_wt = set()
for name in sorted(os.listdir('/home/ubuntu')):
    if not (name.startswith('julia-') or name.startswith('card-machine')):
        continue
    p = os.path.join('/home/ubuntu', name)
    if os.path.isdir(p):
        out = run(['du', '-sm', p]).strip()
        mb = int(out.split()[0]) if out else 0
        checkouts.append({'path': p, 'diskMb': mb})
        for wline in run(['git', '-C', p, 'worktree', 'list', '--porcelain']).splitlines():
            if wline.startswith('worktree '):
                wp = wline.split(' ', 1)[1].strip()
                if wp not in seen_wt:
                    seen_wt.add(wp)
                    wout = run(['du', '-sm', wp]).strip() if os.path.exists(wp) else ''
                    wmb = int(wout.split()[0]) if wout else 0
                    worktrees.append({'path': wp, 'diskMb': wmb})

home_extras = []
for name in ('dist', '%ln'):
    p = os.path.join('/home/ubuntu', name)
    if os.path.exists(p):
        out = run(['du', '-sm', p]).strip()
        mb = int(out.split()[0]) if out else 0
        home_extras.append({'name': name, 'path': p, 'diskMb': mb})

UNIT_DIRS = ('/home/ubuntu/.config/systemd/user', '/etc/systemd/user', '/etc/systemd/system',
             '/usr/lib/systemd/system', '/lib/systemd/system', '/usr/lib/systemd/user')
unit_files = {}
for unit_dir in UNIT_DIRS:
    for root, dirs, files in os.walk(unit_dir):
        # A .wants folder only holds links to units that live elsewhere.
        dirs[:] = sorted(name for name in dirs if not name.endswith(('.wants', '.requires')))
        for name in files:
            if not name.endswith(('.service', '.timer')):
                continue
            entry = {'file': os.path.join(root, name), 'values': {}, 'scope': 'user' if unit_dir.endswith('systemd/user') else 'system'}
            try:
                for line in open(entry['file'], errors='replace'):
                    line = line.strip()
                    for key in ('ExecStart', 'WorkingDirectory'):
                        if line.startswith(key + '=') and line[len(key) + 1:].strip():
                            entry['values'].setdefault(key, []).append(line[len(key) + 1:].strip())
            except Exception:
                continue
            unit_files.setdefault(name, entry)

# A unit's address can also come from a drop-in, so its text counts as the unit's own.
# systemd appends ExecStart lines and replaces WorkingDirectory, and an empty assignment
# clears what came before, so the drop-ins are read in order and applied the same way.
# systemd reads the lowest-priority unit folder first, so the last value applied is the one it obeys.
for unit_dir in reversed(UNIT_DIRS):
    for root, dirs, _files in os.walk(unit_dir):
        for drop_in_dir in sorted(d for d in dirs if d.endswith('.d')):
            entry = unit_files.get(drop_in_dir[:-2])
            if not entry:
                continue
            try:
                confs = sorted(os.listdir(os.path.join(root, drop_in_dir)))
            except OSError:
                continue
            for conf in confs:
                if not conf.endswith('.conf'):
                    continue
                try:
                    for line in open(os.path.join(root, drop_in_dir, conf), errors='replace'):
                        line = line.strip()
                        for key in ('ExecStart', 'WorkingDirectory'):
                            if not line.startswith(key + '='):
                                continue
                            value = line[len(key) + 1:].strip()
                            if not value:
                                entry['values'][key] = []
                            elif key == 'WorkingDirectory':
                                entry['values'][key] = [value]
                            else:
                                entry['values'].setdefault(key, []).append(value)
                except Exception:
                    continue

unit_files = {
    name: dict({'file': entry['file'], 'scope': entry['scope']}, **{key: ' '.join(vals) for key, vals in entry['values'].items() if vals})
    for name, entry in unit_files.items()
    if any(entry['values'].values())
}

print(json.dumps({
    'studioReachable': studio_reachable,
    'unitFiles': unit_files,
    'enabledUnits': sorted(set(unit_files_by_state('user') + unit_files_by_state('system'))),
    'studioError': studio_error,
    'activeCards': active_cards,
    'runs': runs_list,
    'userUnits': parse_units(['systemctl', '--user', 'list-units', '--type=service,timer', '--all', '--no-legend', '--plain']),
    'systemUnits': parse_units(['systemctl', 'list-units', '--type=service,timer', '--all', '--no-legend', '--plain']),
    'processes': processes,
    'checkouts': checkouts,
    'worktrees': worktrees,
    'scratchEntries': du_entries('/home/ubuntu/.local/state/julia-scratch'),
    'scratchCards': du_entries('/home/ubuntu/.local/state/julia-scratch/cards'),
    'builderArtifacts': du_entries('/home/ubuntu/julia-builder/.artifacts'),
    'flowStudioDir': studio_dir,
    'flowStudioEntries': du_entries(studio_dir),
    'mastracodeEntries': du_entries('/home/ubuntu/.local/share/mastracode'),
    'homeExtras': home_extras,
}))
PY`;

function runTarget(script, { local, sshHost, studioUrl }) {
  const env = studioUrl ? { ...process.env, FLOW_STUDIO_URL: studioUrl } : process.env;
  if (local) {
    return execFileSync('bash', ['-s'], { input: script, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env });
  }
  const remotePrefix = studioUrl ? `FLOW_STUDIO_URL=${JSON.stringify(studioUrl)} ` : '';
  return execFileSync('ssh', ['-o', 'BatchMode=yes', sshHost, `${remotePrefix}bash -s`], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function runTargetAsync(script, { local, sshHost, studioUrl }) {
  const env = studioUrl ? { ...process.env, FLOW_STUDIO_URL: studioUrl } : process.env;
  const cmd = local ? 'bash' : 'ssh';
  const args = local ? ['-s'] : ['-o', 'BatchMode=yes', sshHost, `${studioUrl ? `FLOW_STUDIO_URL=${JSON.stringify(studioUrl)} ` : ''}bash -s`];
  return await new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    child.stdin.end(script);
  });
}

function parseSnapshot(raw, extraActiveCards) {
  const snapshot = JSON.parse(raw);
  if (Array.isArray(extraActiveCards) && extraActiveCards.length > 0) {
    snapshot.activeCards = [...new Set([...(snapshot.activeCards ?? []), ...extraActiveCards])];
  }
  return snapshot;
}

export function collectSnapshot(options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  const studioUrl = options.studioUrl ?? process.env.FLOW_STUDIO_URL;
  const raw = runTarget(COLLECT_SCRIPT, { local, sshHost, studioUrl });
  return parseSnapshot(raw, options.extraActiveCards);
}

export async function collectSnapshotAsync(options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  const studioUrl = options.studioUrl ?? process.env.FLOW_STUDIO_URL;
  const raw = await runTargetAsync(COLLECT_SCRIPT, { local, sshHost, studioUrl });
  return parseSnapshot(raw, options.extraActiveCards);
}

// A delete target can come from the Studio run form, so it is quoted, never interpolated.
const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

export function buildCleanScript(evaluation) {
  // Only an answer from Studio counts. A state with no answer is not a licence to delete.
  if (evaluation.studioReachable !== true) {
    return "echo 'Studio unreachable: keeping everything until Studio answers' >&2";
  }
  if (evaluation.leftovers.length === 0) return '';

// A unit file outside this account's own folder belongs to root, so the file needs sudo
  // while the user session is still the one that has to let go of the unit.
  const removeUserUnitFile = (item) => {
    const file = item.file ?? `/home/ubuntu/.config/systemd/user/${item.name}`;
    const sudo = item.file && !item.file.startsWith('/home/ubuntu/.config/systemd/user/') ? 'sudo -n ' : '';
    return `${sudo}rm -f ${shellQuote(file)} 2>/dev/null || true`;
  };

  const commands = [];

  const killedPids = [];
  for (const item of evaluation.leftovers) {
    switch (item.kind) {
      case 'process':
        if (item.pid) {
          const pid = Number(item.pid);
          commands.push(`kill -9 ${pid} 2>/dev/null || true`);
          killedPids.push(pid);
        }
        break;
      case 'user-unit':
        if (IN_USE_SPEC.userUnits.has(item.name) || IN_USE_SPEC.systemUnits.has(item.name)) {
          commands.push(`echo ${shellQuote(`refusing to delete protected unit ${item.name}`)} >&2`);
          break;
        }
        commands.push(`systemctl --user disable --now ${shellQuote(item.name)} 2>/dev/null || true`);
        commands.push(removeUserUnitFile(item));
        break;
      case 'system-unit':
        if (IN_USE_SPEC.systemUnits.has(item.name)) {
          commands.push(`echo ${shellQuote(`refusing to delete protected unit ${item.name}`)} >&2`);
          break;
        }
        commands.push(`sudo -n systemctl disable --now ${shellQuote(item.name)} 2>/dev/null || true`);
        commands.push(`sudo -n rm -f ${shellQuote(item.file ?? `/etc/systemd/system/${item.name}`)} 2>/dev/null || true`);
        break;
      case 'old-setup-unit':
        if (IN_USE_SPEC.userUnits.has(item.name) || IN_USE_SPEC.systemUnits.has(item.name)) {
          commands.push(`echo ${shellQuote(`refusing to delete protected unit ${item.name}`)} >&2`);
          break;
        }
        if (item.scope === 'user') {
          commands.push(`systemctl --user disable --now ${shellQuote(item.name)} 2>/dev/null || true`);
          commands.push(removeUserUnitFile(item));
        } else if (item.scope === 'system') {
          commands.push(`sudo -n systemctl disable --now ${shellQuote(item.name)} 2>/dev/null || true`);
          commands.push(`sudo -n rm -f ${shellQuote(item.file ?? `/etc/systemd/system/${item.name}`)} 2>/dev/null || true`);
        }
        break;
      case 'worktree':
      case 'checkout':
      case 'scratch':
      case 'scratch-card':
      case 'builder-artifact':
      case 'flow-studio-card':
      case 'mastracode':
      case 'home-extra':
        commands.push(`rm -rf ${shellQuote(item.name)}`);
        break;
      default:
        break;
    }
  }

  if (commands.some(c => c.includes('systemctl --user'))) {
    commands.push('systemctl --user daemon-reload');
    commands.push('systemctl --user reset-failed');
  }
  if (commands.some(c => c.includes('sudo -n systemctl'))) {
    commands.push('sudo -n systemctl daemon-reload');
  }
  commands.push('git -C /home/ubuntu/julia-builder worktree prune 2>/dev/null || true');
  commands.push('git -C /home/ubuntu/julia-flow-repo worktree prune 2>/dev/null || true');
  commands.push('git -C /home/ubuntu/julia-mastra worktree prune 2>/dev/null || true');

  if (killedPids.length > 0) {
    commands.push(`for _i in $(seq 1 20); do alive=0; for p in ${killedPids.join(' ')}; do kill -0 "$p" 2>/dev/null && alive=1; done; [ "$alive" -eq 0 ] && break; sleep 0.1; done`);
  }

  // The same folder can be found by two scans (a worktree that is also a card copy); it is removed once.
  return [...new Set(commands)].join('\n');
}

export function cleanLeftovers(evaluation, options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  const script = buildCleanScript(evaluation, options);
  if (!script) return;
  runTarget(script, { local, sshHost });
}

export async function cleanLeftoversAsync(evaluation, options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  const script = buildCleanScript(evaluation, options);
  if (!script) return;
  await runTargetAsync(script, { local, sshHost });
}

function parseArgs(argv) {
  const out = { clean: false, json: false, dryRun: false, local: process.platform === 'linux', sshHost: 'ovh' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--clean') out.clean = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--local') out.local = true;
    else if (arg === '--ssh' && argv[i + 1]) {
      out.local = false;
      out.sshHost = argv[++i];
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  let evaluation = evaluateServerState(collectSnapshot(args));
  if (args.dryRun) {
    const { planReclaim, readFreeBytes } = await import('./disk-reclaim.mjs');
    const reclaim = planReclaim().map(step => ({ what: step.what, sizeMb: step.sizeMb }));
    const report = formatDryRun(evaluation, { freeBytes: readFreeBytes(), reclaim });
    console.log(args.json ? JSON.stringify({ evaluation, reclaim }, null, 2) : report);
    process.exitCode = 0;
  } else {
    if (args.clean && !evaluation.ok) {
      cleanLeftovers(evaluation, args);
      evaluation = evaluateServerState(collectSnapshot(args));
    }
    console.log(args.json ? JSON.stringify(evaluation, null, 2) : formatReport(evaluation));
    process.exitCode = evaluation.ok ? 0 : 1;
  }
}
