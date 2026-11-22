import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { buildRunViewSnapshot } from '#lib/run-view-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const stoppedWaitingFixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'run-view-stopped-waiting.json'), 'utf8')
);

describe('Mission Control Run view', () => {
  beforeEach(async ({ app }) => {
    await app.open('/');
  });

  test('shows active stage heading largest, warnings, step states, helpers, and subscriptions', async ({
    browser,
    screen,
  }) => {
    const runSection = browser.locator('section[aria-label="Current run"]');
    const runHeading = browser.locator('section[aria-label="Current run"] h1');
    const warningAlerts = browser.locator('section[aria-label="Warnings"] [role="alert"]');
    const stepItems = browser.locator('ol[aria-label="Shipping steps"] li');
    const helpersSection = browser.locator('section[aria-label="Helpers"]');
    const subscriptionBars = browser.locator('section[aria-label="Left in each subscription"] [role="img"]');

    await expect(screen.getByRole('status')).toHaveText('Sample data');
    await expect(runHeading).toHaveText('Shipping');
    await expect(runSection).toContainText('Mission control Run view');
    await expect(runSection).toContainText('step 3 of 6');
    await expect(warningAlerts).toHaveCount(3);
    await expect(stepItems).toHaveCount(6);
    await expect(helpersSection).toContainText('Build helper');
    await expect(subscriptionBars).toHaveCount(3);

    const layout = await browser.evaluate(() => {
      const heading = document.querySelector('section[aria-label="Current run"] h1');
      const h1Size = heading ? parseFloat(getComputedStyle(heading).fontSize) : 0;
      let maxOther = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (el === heading || (heading && heading.contains(el))) continue;
        if (!(el.textContent || '').trim()) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size > maxOther) maxOther = size;
      }
      return {
        h1Largest: h1Size > maxOther,
        noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    expect(layout).toEqual({ h1Largest: true, noOverflow: true });
  });

  test('renders waiting_for_you state from /api/run-view', async ({ app, browser }) => {
    const snapshot = buildRunViewSnapshot({
      ...stoppedWaitingFixture.scenarios.waitingForYou,
      subscriptions: stoppedWaitingFixture.subscriptions,
    });
    await browser.route('**/api/run-view', async (route) => {
      await route.fulfill({ json: snapshot });
    });

    await app.open('/');

    const runSection = browser.locator('section[aria-label="Current run"]');
    const runHeading = browser.locator('section[aria-label="Current run"] h1');
    await expect(runSection).toContainText('Waiting for you', { timeout: 8000 });
    await expect(runHeading).toHaveText('After merge');
    await expect(browser.locator('section[aria-label="Warnings"]')).toContainText('Quota low');
  });
});
