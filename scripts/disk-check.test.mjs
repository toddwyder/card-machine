import assert from 'node:assert/strict';
import test from 'node:test';
import { runDailyResourceCheck } from './disk-check.mjs';

function cleanSnapshot(overrides = {}) {
  return {
    studioReachable: true,
    activeCards: [],
    userUnits: [],
    systemUnits: [],
    processes: [],
    checkouts: [],
    worktrees: [],
    scratchEntries: [],
    scratchCards: [],
    builderArtifacts: [],
    flowStudioEntries: [],
    mastracodeEntries: [],
    homeExtras: [],
    ...overrides,
  };
}

test('does not alert when cleanup recovers leftovers and disk and memory are healthy', async () => {
  let step = 0;
  let cleaned = false;
  let alerted = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      if (step === 1) {
        return cleanSnapshot({
          processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
        });
      }
      return cleanSnapshot();
    },
    reclaim: () => ({ freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] }),
    clean: () => {
      cleaned = true;
    },
    statfs: () => ({ bavail: 20_000_000, bfree: 20_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => (cleaned ? 4096 : 512),
    sendAlert: async () => {
      alerted = true;
      return { comment: 'https://linear.app/julia-next/issue/JUL-276#c1' };
    },
  });

  assert.equal(cleaned, true);
  assert.equal(alerted, false);
  assert.equal(result.alert, false);
});

test('alerts on JUL-276 when disk or memory stays short after cleanup', async () => {
  let sentBody = '';
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => cleanSnapshot(),
    reclaim: () => ({ freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] }),
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 400,
    readLargestFolders: () => [{ path: '/var/log', bytes: 5_000_000_000 }],
    sendAlert: async body => {
      sentBody = body;
      return { comment: 'https://linear.app/julia-next/issue/JUL-276#c2' };
    },
  });

  assert.equal(result.alert, true);
  assert.equal(result.comment, 'https://linear.app/julia-next/issue/JUL-276#c2');
  assert.match(sentBody, /Disk:.*2\.0 GB available/);
  assert.match(sentBody, /Memory: 400 MB available/);
  assert.match(sentBody, /\/var\/log: 5\.0 GB/);
});

test('wakes Studio and keeps everything when it answers, instead of cleaning a silent server', async () => {
  let step = 0;
  let woken = false;
  let cleaned = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      if (step === 1) return cleanSnapshot({ studioReachable: false, studioError: 'Connection refused' });
      if (cleaned) return cleanSnapshot();
      return cleanSnapshot({
        processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
      });
    },
    wake: () => {
      woken = true;
      return true;
    },
    reclaim: () => ({ freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] }),
    clean: () => {
      cleaned = true;
    },
    statfs: () => ({ bavail: 20_000_000, bfree: 20_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(woken, true);
  assert.equal(cleaned, true);
  assert.equal(result.alert, false);
});

test('warns and removes nothing when Studio stays silent after a wake attempt', async () => {
  let cleaned = false;
  let step = 0;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      return cleanSnapshot({
        studioReachable: false,
        studioError: 'Connection refused',
        processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
      });
    },
    wake: () => false,
    reclaim: () => ({ freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] }),
    clean: () => {
      cleaned = true;
    },
    statfs: () => ({ bavail: 20_000_000, bfree: 20_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(cleaned, false);
  assert.equal(step, 1);
});

test('a card that starts between the cleanup and the reclaim keeps the caches', async () => {
  let step = 0;
  let reclaimed = false;
  await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      if (step === 1) {
        return cleanSnapshot({
          processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
        });
      }
      return cleanSnapshot({ activeCards: ['JUL-417'] });
    },
    reclaim: () => {
      reclaimed = true;
      return { freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] };
    },
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    readLargestFolders: () => [],
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(reclaimed, false, 'the answer taken just before reclaim is the one that counts');
});

test('waits for a quiet server before reclaiming while a card runs', async () => {
  let reclaimed = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => cleanSnapshot({ activeCards: ['JUL-417'] }),
    reclaim: () => {
      reclaimed = true;
      return { freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] };
    },
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    readLargestFolders: () => [],
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(reclaimed, false, 'a running card keeps its build caches and images');
  assert.match(result.problems.join('\n'), /Disk reclaim waited: a card is running/);
});

test('stops reclaiming when the second look says Studio went silent', async () => {
  let step = 0;
  let reclaimed = false;
  await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      if (step === 1) {
        return cleanSnapshot({
          processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
        });
      }
      return cleanSnapshot({ studioReachable: false, studioError: 'Connection refused' });
    },
    reclaim: () => {
      reclaimed = true;
      return { freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] };
    },
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    readLargestFolders: () => [],
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(reclaimed, false, 'a silent Studio means no reclaim at all');
});

test('a card that starts while the cleanup runs keeps the caches even when nothing needed cleaning', async () => {
  let step = 0;
  let reclaimed = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      return step === 1 ? cleanSnapshot() : cleanSnapshot({ activeCards: ['JUL-417'] });
    },
    reclaim: () => {
      reclaimed = true;
      return { freeBeforeBytes: 0, freeAfterBytes: 0, steps: [] };
    },
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    readLargestFolders: () => [],
    sendAlert: async () => ({ comment: 'unused' }),
  });

  assert.equal(reclaimed, false, 'reclaim reads a snapshot taken after the cleanup, not before it');
  assert.match(result.problems.join('\n'), /Disk reclaim waited: a card is running/);
});

test('a machine the check cannot read is reported instead of ending the run without an alert', async () => {
  let alerted = '';
  let cleaned = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      throw new Error('ssh: connect to host ovh port 22: Connection timed out');
    },
    reclaim: () => {
      throw new Error('reclaim must not run without a reading');
    },
    clean: () => {
      cleaned = true;
    },
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 4096,
    readLargestFolders: () => [],
    sendAlert: async body => {
      alerted = body;
      return { comment: 'unused' };
    },
  });

  assert.equal(cleaned, false);
  assert.equal(result.alert, true);
  assert.match(alerted, /could not read the machine/);
  assert.match(alerted, /Studio unreachable/);
});
