import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

const url = process.env.JULIA_PREVIEW_URL;

if (!url) throw new Error('JULIA_PREVIEW_URL is required to check a deployed site');

// Vercel Authentication stays on, so every request carries the project's
// Protection Bypass for Automation secret. The secret lives in a 0600 file on the
// server because the e2e run reads it here, not from a checked-in value.
const bypassFile = process.env.CARD_VERCEL_BYPASS_FILE ?? join(homedir(), '.config', 'julia', 'vercel-protection-bypass');

function protectionBypass(): string | undefined {
  const fromEnv = process.env.JULIA_PROTECTION_BYPASS?.trim();
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(bypassFile, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

const bypass = protectionBypass();
const headers = bypass ? { 'x-vercel-protection-bypass': bypass } : undefined;

// Kept out of e2e.config.ts on purpose: the default suite drives a local app, this
// one drives an already-deployed address so a checker can run it against a PR preview.
export default {
  tests: ['tests/julia-live.preview.ts'],
  output: process.env.JULIA_E2E_OUTPUT ?? '.e2e/deployed/preview',
  targets: [
    {
      engine: web({ headers }),
      app: { url: url.endsWith('/') ? url : `${url}/` },
    },
  ],
} satisfies E2EConfig;
