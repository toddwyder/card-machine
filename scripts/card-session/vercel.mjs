import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Deployments keep Vercel Authentication on, so every request the checker and the
// live-site check make carries this project's Protection Bypass for Automation
// secret. It lives in a 0600 file because it grants read access to the deployment.
export const BYPASS_HEADER = 'x-vercel-protection-bypass';
export const BYPASS_FILE = join(homedir(), '.config', 'julia', 'vercel-protection-bypass');

export function protectionBypass(env = process.env) {
  const fromEnv = env.VERCEL_PROTECTION_BYPASS?.trim();
  if (fromEnv) return fromEnv;

  try {
    return readFileSync(BYPASS_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function bypassHeaders(env = process.env) {
  const secret = protectionBypass(env);
  return secret ? { [BYPASS_HEADER]: secret } : {};
}
