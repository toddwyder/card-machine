// Starts the built app against the fixture run, for the browser spec. Playwright waits on the
// Run view's address before handing control to the spec.

import { spawn } from 'node:child_process';
import { buildFixture, FLOW_DIR, NOW, SUBSCRIPTIONS_FILE } from './flow-fixture.mjs';

const PORT = Number(process.env.PORT ?? 4314);
const URL_UNDER_TEST = `http://127.0.0.1:${PORT}/control`;

buildFixture();

const app = spawn('npx', ['next', 'start', '--hostname', '127.0.0.1', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  // The app reads the clock at the same instant the scene wrote its times from, so the words on
  // the screen (a run's minutes, an action's age) do not move between two runs of the same spec.
  // The zone is pinned for the same reason: a subscription's reset date is a calendar day, so the
  // machine's own zone would otherwise decide whether it reads 23 Nov or 24 Nov in the pictures.
  env: { ...process.env, TZ: 'UTC', FLOW_DIR, RUN_VIEW_SUBSCRIPTIONS_FILE: SUBSCRIPTIONS_FILE, RUN_VIEW_NOW: String(NOW), NODE_ENV: 'production' },
  stdio: 'inherit',
});

app.on('exit', code => process.exit(code ?? 0));

const ready = async () => {
  for (let tryCount = 0; tryCount < 120; tryCount += 1) {
    try {
      const response = await fetch(URL_UNDER_TEST, { redirect: 'manual' });
      if (response.ok) return;
    } catch {
      // The server is still coming up.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`the app did not answer on ${URL_UNDER_TEST}`);
};

await ready();
process.stdout.write(`Run view ready on ${URL_UNDER_TEST}\n`);
