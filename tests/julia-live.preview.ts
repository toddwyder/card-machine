import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The e2e default discovery glob is tests/**/*.e2e.ts on purpose: this file is named
// .preview.ts so only e2e.preview.config.ts picks it up.

const expectedCommit = process.env.JULIA_COMMIT;

test('the deployed site answers, serves the checkout, and shows Julia', async ({ app, screen, browser }) => {
  await app.open('/');

  const health = await browser.evaluate(async () => {
    const response = await fetch('/api/health', { headers: { 'x-health-probe': 'card-e2e' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });

  expect(health.status).toBe('ok');
  if (expectedCommit) expect(health.commit).toBe(expectedCommit);

  await expect(screen.getByRole('main')).toContainText('Julia');
  await expect(screen.getByRole('main')).toContainText('what are we cooking today?');
});
