import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const app = {
  url: 'http://127.0.0.1:4399',
  readyUrl: 'http://127.0.0.1:4399/api/run-view',
  command: {
    executable: 'node',
    args: ['./node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '{port}'],
    env: {
      RUN_VIEW_FIXTURE_FILE: './tests/fixtures/run-view-showcase.json',
    },
    log: '.e2e/logs/app.log',
    reuseExisting: true,
  },
};

export default {
  tests: 'tests/**/*.e2e.ts',
  trace: 'on',
  targets: [
    {
      name: 'desktop',
      engine: web({ viewport: { width: 1440, height: 900 } }),
      app,
    },
    {
      name: 'mobile',
      engine: web({ viewport: { width: 390, height: 844 } }),
      app,
    },
  ],
} satisfies E2EConfig;
