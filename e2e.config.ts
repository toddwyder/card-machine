import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const port = Number(process.env.E2E_PORT ?? 4315);

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.APP_URL ?? `http://127.0.0.1:${port}/control/`,
        command: {
          executable: 'node',
          args: ['dashboard/tests/start-server.mjs'],
          env: { PORT: String(port) },
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
