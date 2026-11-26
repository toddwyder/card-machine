import { fileIsHeld } from './disk-reclaim.mjs';

export const IN_USE_SPEC = {
  userUnits: new Map([
    ['card-machine-studio.service', 'Card Machine Mastra Studio on :4112, which hosts the Run view'],
    ['card-machine-run-view.service', 'The Run view Todd opens at /control over Tailscale, on :4314'],
    ['card-machine-self-studio.service', 'Card Machine Studio started by the self-studio wrapper'],
    ['memory-watch.service', 'Server memory and cgroup recorder that the run start reads'],
    ['datasette-viewer.service', 'Datasette read-only viewer on :8801 opened by Todd'],
    ['julia-disk-check.timer', 'Daily server resource check alerting Todd on JUL-276'],
    ['julia-disk-check.service', 'Daily server resource check service'],
    ['dbus.service', 'Ubuntu user D-Bus session bus'],
    ['dbus.socket', 'Ubuntu user D-Bus socket'],
    ['gnome-keyring-daemon.service', 'Ubuntu user keyring daemon'],
    ['at-spi-dbus-bus.service', 'Ubuntu accessibility bus'],
    ['gpg-agent.service', 'Ubuntu GnuPG agent'],
    ['dirmngr.service', 'Ubuntu GnuPG certificate manager'],
    ['keyboxd.service', 'Ubuntu GnuPG keybox daemon'],
    ['pk-debconf-helper.service', 'Ubuntu debconf helper'],
    ['gcr-ssh-agent.service', 'Ubuntu GCR SSH agent'],
    ['snapd.session-agent.service', 'Ubuntu snapd session agent'],
    ['systemd-tmpfiles-clean.timer', 'Ubuntu daily user tmpfiles cleanup timer'],
    ['systemd-tmpfiles-clean.service', 'Ubuntu daily user tmpfiles cleanup service'],
    ['launchpadlib-cache-clean.timer', 'Ubuntu Launchpadlib cache cleanup timer'],
    ['launchpadlib-cache-clean.service', 'Ubuntu Launchpadlib cache cleanup service'],
  ]),
  systemUnits: new Map([
    ['tailscaled.service', 'Tailscale network daemon'],
  ]),
  checkouts: new Map([
    ['/home/ubuntu/card-machine', 'card-machine-studio.service FLOW_REPO, julia-disk-check.service and the operator checkout'],
    ['/home/ubuntu/card-machine-project', 'card-machine-studio.service FLOW_PROJECT_REPO, the target project checkout runs copy'],
    ['/home/ubuntu/julia-flow-repo', 'Checkout the skill-update and update-report units run from (JUL-412, JUL-413)'],
    ['/home/ubuntu/julia-dashboard', 'Dashboard folder kept for JUL-410'],
    ['/home/ubuntu/julia-mastra', 'Parent repository for the julia-dashboard worktree'],
  ]),
  scratchFixed: new Map([
    ['cards', 'Container for active card worktrees (empty when no card is running)'],
    ['com.agilebits.op.1000', '1Password CLI daemon runtime socket for active services'],
    ['node-compile-cache', 'Node.js compile cache used by active services'],
  ]),
  flowStudioFixed: new Map([
    ['state.db', 'Studio workflow state database'],
    ['state.db-wal', 'Studio workflow state WAL'],
    ['state.db-shm', 'Studio workflow state SHM'],
    ['trace.duckdb', 'Studio observability trace database'],
    ['trace.duckdb.wal', 'Studio observability trace WAL'],
    ['trace.duckdb.tmp', 'Studio observability trace temp dir'],
    ['build', 'Studio scratch subfolder'],
    ['landing', 'Studio scratch subfolder'],
    ['reports', 'Studio scratch subfolder'],
    ['retro', 'Studio scratch subfolder'],
    ['interrupted', 'Studio heartbeat that tells a restart which run is still going'],
  ]),
  mastracodeFixed: new Map([
    ['mastra.db', 'Datasette read-only viewer database (datasette-viewer.service)'],
    ['mastra.db-wal', 'Datasette database WAL'],
    ['mastra.db-shm', 'Datasette database SHM'],
    ['settings.json', 'Mastra Code configuration'],
    ['auth.json', 'Mastra Code provider credentials'],
    ['mastra-vectors.db', 'Mastra Code vector store'],
    ['mastra-vectors.db-wal', 'Mastra Code vector store write-ahead log'],
    ['mastra-vectors.db-shm', 'Mastra Code vector store shared memory'],
    ['observability.duckdb', 'Mastra Code observability store'],
    ['observability.duckdb.wal', 'Mastra Code observability write-ahead log'],
    ['observability.duckdb.tmp', 'Mastra Code observability temp dir'],
    ['locks', 'Mastra Code lock directory'],
    ['patches', 'Mastra Code patch directory'],
  ]),
  homeDisallowed: new Set(['dist', '%ln']),
};

function classifyProcess(proc, activeCards) {
  const cmd = proc.cmd ?? '';
  if (proc.isSelfOrAncestor) {
    return { allowed: true, usedBy: 'Current inspection/cleanup process chain' };
  }
  if (proc.serviceUnit && (IN_USE_SPEC.userUnits.has(proc.serviceUnit) || IN_USE_SPEC.systemUnits.has(proc.serviceUnit))) {
    return { allowed: true, usedBy: proc.serviceUnit };
  }
  if (/^\/usr\/lib\/systemd\/systemd --user\b/.test(cmd) || /^\(sd-pam\)$/.test(cmd)) {
    return { allowed: true, usedBy: 'Ubuntu user systemd session' };
  }
  if (/^\/usr\/bin\/dbus-daemon --session\b/.test(cmd) || /gnome-keyring-daemon|at-spi-bus-launcher|at-spi2-registryd/.test(cmd)) {
    return { allowed: true, usedBy: 'Ubuntu user session infrastructure' };
  }
  if (/^sshd: ubuntu@/.test(cmd) || /check-server-in-use/.test(cmd) || /^(?:-?bash|ps -u ubuntu|python3 -)(?:\s|$)/.test(cmd)) {
    if (!/for id in JUL-/.test(cmd)) {
      return { allowed: true, usedBy: 'Current SSH inspection session' };
    }
  }
  if (proc.operatorSession) {
    return { allowed: true, usedBy: 'Part of a terminal session a person is using' };
  }
  if (/\bop daemon\b/.test(cmd) && proc.inUseOpDaemon) {
    return { allowed: true, usedBy: '1Password daemon for active Studio/dashboard services' };
  }
  if (activeCards.length > 0 && activeCards.some(card => cmd.includes(card))) {
    return { allowed: true, usedBy: `Active Studio card (${activeCards.join(', ')})` };
  }
  return { allowed: false, usedBy: null };
}

const OLD_SETUP_PATHS = ['/home/ubuntu/julia-dashboard', '/home/ubuntu/julia-flow-repo', '/home/ubuntu/julia-builder'];

const UNITS_OWNED_ELSEWHERE = new Map([
  ['julia-skills-update.service', 'Skill updates, owned by JUL-412'],
  ['julia-skills-update.timer', 'Skill updates, owned by JUL-412'],
  ['julia-update-report.service', 'Update report, owned by JUL-413'],
  ['julia-update-report.timer', 'Update report, owned by JUL-413'],
]);

export function oldSetupUnits(snapshot) {
  const active = new Set((snapshot.userUnits ?? [])
    .concat(snapshot.systemUnits ?? [])
    .filter(unit => unit.active === 'active' || unit.sub === 'running' || unit.sub === 'waiting')
    .map(unit => unit.name));
  for (const name of snapshot.enabledUnits ?? []) active.add(name);
  const userNames = new Set((snapshot.userUnits ?? []).map(unit => unit.name));
  const found = new Map();
  for (const [name, definition] of Object.entries(snapshot.unitFiles ?? {})) {
    // A unit the in-use list names is used now; its address has to be moved by the card that owns it.
    if (IN_USE_SPEC.userUnits.has(name) || IN_USE_SPEC.systemUnits.has(name)) continue;
    const timer = name.replace(/\.service$/, '.timer');
    if (!active.has(name) && !active.has(timer)) continue;
    const text = `${definition.ExecStart ?? ''} ${definition.WorkingDirectory ?? ''}`;
    // Whole paths only: /home/ubuntu/julia-dashboard-2 is not the old dashboard.
    // systemd accepts quoted values, so the quotes are dropped before the path is compared.
    const tokens = text.split(/[\s:=]+/).map(token => token.replace(/^["']|["']$/g, ''));
    const path = OLD_SETUP_PATHS.find(candidate => tokens.some(token => token === candidate || token.startsWith(`${candidate}/`)));
    if (!path) continue;
    found.set(name, { path, scope: definition.scope ?? (userNames.has(name) ? 'user' : 'system'), file: definition.file });
  }
  return found;
}

// A card's folder is named after the card, cleaned the way the copy step cleans it.
const cardFolderNames = card => [String(card), String(card).replace(/[^\w.-]+/g, '-')];

// A folder belongs to a finished run when its name is a card Studio says is over. Guessing from the
// shape of a name caught folders a running build made, such as NODE-22 or PG-16.
const endedFolderNames = snapshot => new Set((snapshot.runs ?? [])
  .filter(run => run.ended && run.card)
  .flatMap(run => cardFolderNames(run.card)));

const namesEndedCard = (path, endedNames) => path.split('/').some(segment => endedNames.has(segment));

const pathMentionsCard = (path, cards) => {
  const segments = path.split('/');
  return cards.find(card => cardFolderNames(card).some(name => segments.includes(name))) ?? null;
};

export function evaluateServerState(snapshot) {
  // Only an answer from Studio counts as reachable. A snapshot without the key cannot say a build is idle.
  const studioReachable = snapshot.studioReachable === true;
  const studioError = snapshot.studioError ?? null;
  const activeCards = [...new Set(snapshot.activeCards ?? [])].sort();
  const activeSet = new Set(activeCards.flatMap(cardFolderNames));
  const endedNames = endedFolderNames(snapshot);
  const kept = [];
  const leftovers = [];
  const fromOldSetup = oldSetupUnits(snapshot);

  for (const [name, hit] of fromOldSetup) {
    const ownedElsewhere = UNITS_OWNED_ELSEWHERE.get(name);
    if (ownedElsewhere) {
      kept.push({ kind: 'user-unit', name, rssMb: 0, diskMb: 0, usedBy: ownedElsewhere });
    } else if (activeCards.length > 0) {
      kept.push({
        kind: 'old-setup-unit',
        name,
        rssMb: 0,
        diskMb: 0,
        usedBy: `A card is running (${activeCards.join(', ')}); a unit is not stopped under it`,
      });
    } else {
      leftovers.push({
        kind: 'old-setup-unit',
        name,
        scope: hit.scope,
        file: hit.file,
        rssMb: 0,
        diskMb: 0,
        reason: `Runs from the old setup (${hit.path})`,
      });
    }
  }

  for (const unit of snapshot.userUnits ?? []) {
    if (fromOldSetup.has(unit.name)) continue;
    const ownedElsewhere = UNITS_OWNED_ELSEWHERE.get(unit.name);
    if (ownedElsewhere) {
      kept.push({ kind: 'user-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: ownedElsewhere });
      continue;
    }
    const allowedReason = IN_USE_SPEC.userUnits.get(unit.name);
    if (allowedReason) {
      kept.push({ kind: 'user-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: allowedReason });
      continue;
    }
    const failed = unit.active === 'failed' || unit.sub === 'failed';
    const suspect = failed || unit.active === 'active' || unit.sub === 'running' || unit.sub === 'waiting'
      || unit.name.startsWith('julia-') || unit.name.startsWith('jul');
    if (!suspect) continue;
    if (activeCards.length > 0) {
      kept.push({
        kind: 'user-unit',
        name: unit.name,
        rssMb: 0,
        diskMb: 0,
        usedBy: `A card is running (${activeCards.join(', ')}); a unit is not stopped under it`,
      });
      continue;
    }
    leftovers.push({
      kind: 'user-unit',
      name: unit.name,
      file: snapshot.unitFiles?.[unit.name]?.file,
      rssMb: 0,
      diskMb: 0,
      reason: failed ? 'Failed transient/user unit' : 'Not in active user unit allowlist',
    });
  }

  for (const unit of snapshot.systemUnits ?? []) {
    if (fromOldSetup.has(unit.name)) continue;
    const ownedElsewhere = UNITS_OWNED_ELSEWHERE.get(unit.name);
    if (ownedElsewhere) {
      kept.push({ kind: 'system-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: ownedElsewhere });
      continue;
    }
    const allowedReason = IN_USE_SPEC.systemUnits.get(unit.name);
    if (allowedReason) {
      kept.push({ kind: 'system-unit', name: unit.name, rssMb: 0, diskMb: 0, usedBy: allowedReason });
    } else if (unit.name.startsWith('julia-') || unit.name.startsWith('jul') || unit.name.includes('mastra')) {
      // A system service the machine itself needs is never ours to stop, whatever its state.
      if (activeCards.length > 0) {
        kept.push({
          kind: 'system-unit',
          name: unit.name,
          rssMb: 0,
          diskMb: 0,
          usedBy: `A card is running (${activeCards.join(', ')}); a unit is not stopped under it`,
        });
        continue;
      }
      leftovers.push({
        kind: 'system-unit',
        name: unit.name,
        file: snapshot.unitFiles?.[unit.name]?.file,
        rssMb: 0,
        diskMb: 0,
        reason: 'Not in active system unit allowlist',
      });
    }
  }

  for (const proc of snapshot.processes ?? []) {
    const rssMb = Math.round(((proc.rssKb ?? 0) / 1024) * 10) / 10;
    const verdict = classifyProcess(proc, activeCards);
    if (verdict.allowed) {
      kept.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, usedBy: verdict.usedBy });
    } else if (!studioReachable) {
      kept.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, usedBy: 'Studio unreachable; preserving potential card process' });
    } else if (activeCards.length > 0) {
      // A card's commands run in transient scopes that carry no card name, so none of them is a leftover while a card runs.
      kept.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, usedBy: `A card is running (${activeCards.join(', ')}); its commands are not leftovers` });
    } else {
      leftovers.push({ kind: 'process', name: `${proc.pid} ${proc.cmd}`, pid: proc.pid, rssMb, diskMb: 0, reason: 'Orphaned or non-service process' });
    }
  }

  for (const checkout of snapshot.checkouts ?? []) {
    const allowedReason = IN_USE_SPEC.checkouts.get(checkout.path);
    const card = pathMentionsCard(checkout.path, activeCards);
    if (allowedReason) {
      kept.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, usedBy: allowedReason });
    } else if (card) {
      kept.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, usedBy: `Checkout of active Studio card ${card}` });
    } else if (activeCards.length > 0 && !namesEndedCard(checkout.path, endedNames)) {
      // A clone a running card made to verify its own work is indistinguishable from a stray one until the card ends.
      kept.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, usedBy: `A card is running (${activeCards.join(', ')}); a clone may be its verification` });
    } else {
      leftovers.push({ kind: 'checkout', name: checkout.path, rssMb: 0, diskMb: checkout.diskMb ?? 0, reason: 'Extra checkout outside in-use list' });
    }
  }

  for (const wt of snapshot.worktrees ?? []) {
    const isDashboard = wt.path === '/home/ubuntu/julia-dashboard';
    const isMainRepo = IN_USE_SPEC.checkouts.has(wt.path);
    const card = pathMentionsCard(wt.path, activeCards);
    // A worktree a running card checks its own work out into need not carry the card's name.
    const runningCard = Boolean(card) || !studioReachable
      || (activeCards.length > 0 && !namesEndedCard(wt.path, endedNames));
    if (isDashboard || isMainRepo || runningCard) {
      kept.push({
        kind: 'worktree',
        name: wt.path,
        rssMb: 0,
        diskMb: wt.diskMb ?? 0,
        usedBy: card
          ? (studioReachable ? `Active Studio card ${card}` : `Studio unreachable; preserving card worktree ${card}`)
          : (IN_USE_SPEC.checkouts.get(wt.path) ?? (activeCards.length > 0
            ? `A card is running (${activeCards.join(', ')}); a worktree may be its verification`
            : 'Registered main checkout')),
      });
    } else {
      leftovers.push({ kind: 'worktree', name: wt.path, rssMb: 0, diskMb: wt.diskMb ?? 0, reason: 'Leftover git worktree not tied to an active card' });
    }
  }

  for (const entry of snapshot.scratchEntries ?? []) {
    const allowedReason = IN_USE_SPEC.scratchFixed.get(entry.name);
    const card = pathMentionsCard(entry.path, activeCards);
    if (allowedReason) {
      kept.push({ kind: 'scratch', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: allowedReason });
    } else if (card) {
      kept.push({ kind: 'scratch', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: `Working copy of active Studio card ${card}` });
    } else if (activeCards.length > 0 && !endedNames.has(entry.name)) {
      kept.push({
        kind: 'scratch',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: `A card is running (${activeCards.join(', ')}); its build may use this scratch folder`,
      });
    } else {
      leftovers.push({ kind: 'scratch', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Leftover scratch file or directory' });
    }
  }

  for (const cardEntry of snapshot.scratchCards ?? []) {
    const card = pathMentionsCard(cardEntry.path, activeCards) ?? (activeSet.has(cardEntry.name) ? cardEntry.name : null);
    if (card || !studioReachable) {
      kept.push({
        kind: 'scratch-card',
        name: cardEntry.path,
        rssMb: 0,
        diskMb: cardEntry.diskMb ?? 0,
        usedBy: studioReachable ? `Active Studio card ${card ?? cardEntry.name}` : `Studio unreachable; preserving card copy ${cardEntry.name}`,
      });
    } else {
      leftovers.push({ kind: 'scratch-card', name: cardEntry.path, rssMb: 0, diskMb: cardEntry.diskMb ?? 0, reason: 'Inactive, finished, paused, or abandoned card copy' });
    }
  }

  for (const entry of snapshot.builderArtifacts ?? []) {
    const card = pathMentionsCard(entry.path, activeCards);
    if (card) {
      kept.push({ kind: 'builder-artifact', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: `Run folder of active Studio card ${card}` });
    } else if (activeCards.length > 0) {
      kept.push({
        kind: 'builder-artifact',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: `A card is running (${activeCards.join(', ')}); its run folder is not a leftover`,
      });
    } else {
      leftovers.push({ kind: 'builder-artifact', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Stale artifact in julia-builder/.artifacts (Studio uses FLOW_REPO)' });
    }
  }

  for (const entry of snapshot.flowStudioEntries ?? []) {
    const allowedReason = IN_USE_SPEC.flowStudioFixed.get(entry.name);
    if (allowedReason) {
      // The Run view serves this folder, so nothing in it is a leftover: a trace database under a running
      // viewer is data in use, and the tool that writes it reuses the file.
      kept.push({ kind: 'flow-studio', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, usedBy: allowedReason });
    } else if (pathMentionsCard(entry.path, activeCards) || activeSet.has(entry.name) || !studioReachable) {
      kept.push({
        kind: 'flow-studio-card',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: studioReachable ? `Active Studio card ${entry.name}` : `Studio unreachable; preserving Studio card folder ${entry.name}`,
      });
    } else if (activeCards.length > 0 && !endedNames.has(entry.name)) {
      // A new kind of folder can appear in the Studio directory; while a card runs, none of it is touched.
      // A folder named after some other card is that card's finished run, so it still goes.
      kept.push({
        kind: 'flow-studio',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: `A card is running (${activeCards.join(', ')}); the Studio folder is not pruned`,
      });
    } else {
      leftovers.push({ kind: 'flow-studio-card', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Finished or abandoned Studio card run folder' });
    }
  }

  for (const entry of snapshot.mastracodeEntries ?? []) {
    const allowedReason = IN_USE_SPEC.mastracodeFixed.get(entry.name);
    // A session that has the file open is using it, whatever the file is called. A folder can be written
    // without any of its files being held open at the moment of the scan, so folders stay too.
    const held = !allowedReason && (entry.isDir === true || fileIsHeld(entry.path));
    // A file a running session has not opened yet looks unused at the moment of the scan.
    const cardRunning = !allowedReason && activeCards.length > 0;
    if (allowedReason || held || cardRunning) {
      kept.push({
        kind: 'mastracode',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: allowedReason ?? (entry.isDir === true
          ? 'Mastra Code folder a live session may be writing into'
          : cardRunning
            ? `A card is running (${activeCards.join(', ')}); a session may open this file`
            : 'A live Mastra Code session holds this file open'),
      });
    } else {
      leftovers.push({ kind: 'mastracode', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Unused Mastra Code trace, backup, or vector database' });
    }
  }

  for (const entry of snapshot.homeExtras ?? []) {
    if (!IN_USE_SPEC.homeDisallowed.has(entry.name)) continue;
    if (activeCards.length > 0) {
      kept.push({
        kind: 'home-extra',
        name: entry.path,
        rssMb: 0,
        diskMb: entry.diskMb ?? 0,
        usedBy: `A card is running (${activeCards.join(', ')}); its build may be writing here`,
      });
      continue;
    }
    leftovers.push({ kind: 'home-extra', name: entry.path, rssMb: 0, diskMb: entry.diskMb ?? 0, reason: 'Stray build or scratch output in /home/ubuntu' });
  }

  if (!studioReachable) {
    for (const item of leftovers.splice(0)) {
      const { reason, ...rest } = item;
      kept.push({ ...rest, usedBy: `Studio unreachable; keeping this ${item.kind} until Studio answers` });
    }
  }

  const sum = (items, key) => Math.round(items.reduce((acc, item) => acc + (item[key] ?? 0), 0) * 10) / 10;
  return {
    ok: leftovers.length === 0 && studioReachable,
    studioReachable,
    studioError,
    activeCards,
    kept,
    leftovers,
    summary: {
      keptRssMb: sum(kept, 'rssMb'),
      keptDiskMb: sum(kept, 'diskMb'),
      leftoverRssMb: sum(leftovers, 'rssMb'),
      leftoverDiskMb: sum(leftovers, 'diskMb'),
    },
  };
}

export function formatReport(evaluation) {
  const activeLabel = evaluation.studioReachable === false
    ? `unknown (Studio unreachable${evaluation.studioError ? `: ${evaluation.studioError}` : ''}; preserving card work)`
    : (evaluation.activeCards.length > 0 ? evaluation.activeCards.join(', ') : 'none');
  const lines = [
    `Server in-use check: ${evaluation.ok ? 'PASS' : 'FAIL'} (active cards: ${activeLabel})`,
    `Kept: ${evaluation.kept.length} items (${evaluation.summary.keptRssMb} MB RSS, ${evaluation.summary.keptDiskMb} MB disk)`,
    `Leftovers: ${evaluation.leftovers.length} items (${evaluation.summary.leftoverRssMb} MB RSS, ${evaluation.summary.leftoverDiskMb} MB disk)`,
  ];
  if (evaluation.leftovers.length > 0) {
    lines.push('', 'Leftovers (not in use):');
    for (const item of evaluation.leftovers) {
      lines.push(`- [${item.kind}] ${item.name} (${item.rssMb} MB RSS, ${item.diskMb} MB disk): ${item.reason}`);
    }
  }
  return lines.join('\n');
}

export function formatDryRun(evaluation, { freeBytes = null, projectedFreeBytes = null, reclaim = [] } = {}) {
  const gb = bytes => (bytes / 1_000_000_000).toFixed(2);
  const lines = [formatReport(evaluation), '', 'Kept:'];
  for (const item of evaluation.kept) {
    lines.push(`- [${item.kind}] ${item.name}: ${item.usedBy}`);
  }
  if (evaluation.leftovers.length > 0) {
    lines.push('', 'Would delete:');
    for (const item of evaluation.leftovers) {
      lines.push(`- [${item.kind}] ${item.name}: ${item.diskMb} MB disk, ${item.rssMb} MB RSS`);
    }
  }
  for (const entry of reclaim) {
    lines.push(`- [reclaim] ${entry.what}: ${entry.sizeMb} MB`);
  }
  if (freeBytes !== null) {
    const reclaimMb = reclaim.reduce((acc, entry) => acc + (entry.sizeMb ?? 0), 0);
    const projected = projectedFreeBytes ?? freeBytes + reclaimMb * 1_000_000;
    lines.push(
      '',
      `Free now: ${gb(freeBytes)} GB`,
      `Projected free after this cleanup: ${gb(projected)} GB`,
    );
  }
  return lines.join('\n');
}
