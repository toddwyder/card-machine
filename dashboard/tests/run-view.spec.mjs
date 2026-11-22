import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildRunViewSnapshot } from '#lib/run-view-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const stoppedWaitingFixture = JSON.parse(
  readFileSync(join(here, 'fixtures', 'run-view-stopped-waiting.json'), 'utf8')
);

function attachErrorCollectors(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err));
  });
  return { consoleErrors, pageErrors };
}

test.describe('Mission Control Run view', () => {
  test('showcase fixture: hierarchy, estimate wording, step states, warnings, helpers, quotas, and captures', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachErrorCollectors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Fixture header shows Sample data (not Live)
    const headerStatus = page.locator('header [role="status"]');
    await expect(headerStatus).toHaveText('Sample data');

    // Card title, current stage, step counter, Card so far + estimate wording
    const runSection = page.locator('section[aria-label="Current run"]');
    await expect(runSection).toContainText('Mission control Run view');
    await expect(runSection).toContainText('Card so far');
    await expect(runSection).toContainText('step 3 of 6');
    await expect(runSection).toContainText(/estimate/i);
    await expect(runSection.locator('h1')).toHaveText('Shipping');

    // Current stage heading is strictly the largest text on the page
    const fontCheck = await page.evaluate(() => {
      const heading = document.querySelector('section[aria-label="Current run"] h1');
      if (!heading) return { ok: false, reason: 'missing h1' };
      const h1Size = parseFloat(getComputedStyle(heading).fontSize);
      let maxOther = 0;
      let maxOtherText = '';
      for (const el of document.querySelectorAll('body *')) {
        if (el === heading || heading.contains(el)) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size > maxOther) {
          maxOther = size;
          maxOtherText = text.slice(0, 40);
        }
      }
      return { ok: h1Size > maxOther, h1Size, maxOther, maxOtherText };
    });
    expect(fontCheck.ok, JSON.stringify(fontCheck)).toBe(true);

    // Three showcase warnings visible: stuck, quota_low, burning_fast (naming agent)
    const warningsSection = page.locator('section[aria-label="Warnings"]');
    const alerts = warningsSection.locator('[role="alert"]');
    await expect(alerts).toHaveCount(3);
    await expect(warningsSection).toContainText('Run looks stuck');
    await expect(warningsSection).toContainText('Quota low');
    await expect(warningsSection).toContainText('ChatGPT has 14% left.');
    await expect(warningsSection).toContainText('Burning tokens fast');
    await expect(warningsSection).toContainText('Build helper');

    const warningStyles = await alerts.evaluateAll((nodes) =>
      nodes.map((el) => ({
        text: (el.textContent || '').trim(),
        borderStyle: getComputedStyle(el).borderStyle,
      }))
    );
    expect(warningStyles.find((w) => w.text.includes('Run looks stuck'))?.borderStyle).toBe('dashed');
    expect(warningStyles.find((w) => w.text.includes('Quota low'))?.borderStyle).toBe('solid');
    expect(warningStyles.find((w) => w.text.includes('Burning tokens fast'))?.borderStyle).toBe('solid');

    // Step states in Shipping: passed, passed_with_notes, stuck, sent_back (Round 2), given_up
    const stepItems = page.locator('ol[aria-label="Shipping steps"] li');
    await expect(stepItems).toHaveCount(6);

    const stepDetails = await stepItems.evaluateAll((nodes) =>
      nodes.map((li) => {
        const svgPaths = Array.from(li.querySelectorAll('svg path, svg circle')).map(
          (el) => el.getAttribute('d') || el.getAttribute('cx') || ''
        );
        const nameSpan = li.querySelector('span:nth-of-type(2)');
        const style = getComputedStyle(li);
        const nameStyle = nameSpan ? getComputedStyle(nameSpan) : null;
        return {
          text: (li.textContent || '').trim(),
          borderStyle: style.borderStyle,
          svgSignature: svgPaths.join('|'),
          textDecoration: nameStyle ? nameStyle.textDecorationLine : '',
        };
      })
    );

    const byPrefix = (prefix) => stepDetails.find((s) => s.text.startsWith(prefix));
    const passed = byPrefix('Verify the change independently');
    const passedNotes = byPrefix('Pick the verified pull request to land');
    const stuck = byPrefix('Re-check the verdict still fits the code');
    const sentBack = byPrefix('Merge and read the result back');
    const givenUp = byPrefix('Leave it alone while it lands');

    expect(passed).toBeTruthy();
    expect(passedNotes).toBeTruthy();
    expect(stuck).toBeTruthy();
    expect(sentBack).toBeTruthy();
    expect(givenUp).toBeTruthy();

    // Non-colour distinctions
    expect(passedNotes.text).toContain('(notes)');
    expect(stuck.borderStyle).toBe('dashed');
    expect(sentBack.borderStyle).toBe('dotted');
    expect(sentBack.text).toContain('Round 2');
    expect(givenUp.textDecoration).toContain('line-through');

    // Distinct SVG icon shapes across passed, stuck, sent_back, given_up
    const distinctIcons = new Set([
      passed.svgSignature,
      stuck.svgSignature,
      sentBack.svgSignature,
      givenUp.svgSignature,
    ]);
    expect(distinctIcons.size).toBe(4);

    // Helpers: 3 helpers (working, stuck, done) with actions newest-first
    const helpersSection = page.locator('section[aria-label="Helpers"]');
    await expect(helpersSection).toContainText('Shipping helper');
    await expect(helpersSection).toContainText('Build helper');
    await expect(helpersSection).toContainText('Execute helper');

    const shippingHelperCard = helpersSection.locator('> ul > li', { hasText: 'Shipping helper' });
    await expect(shippingHelperCard).toContainText('Working');
    const shippingActionPlay = await shippingHelperCard.locator('ol li svg path').first().getAttribute('d');
    expect(shippingActionPlay).toContain('15.25');

    const buildHelperCard = helpersSection.locator('> ul > li', { hasText: 'Build helper' });
    await expect(buildHelperCard).toContainText('Stuck');
    const buildActions = await buildHelperCard.locator('ol li').allTextContents();
    expect(buildActions.map((s) => s.trim())).toEqual([
      'Ran command',
      'Edited RunView.module.css',
      'Read RunView.jsx',
    ]);

    const execHelperCard = helpersSection.locator('> ul > li', { hasText: 'Execute helper' });
    await expect(execHelperCard).toContainText('Done');
    const execActions = await execHelperCard.locator('ol li').allTextContents();
    expect(execActions.map((s) => s.trim())).toEqual([
      'Wrote run-view.spec.mjs',
      'Read run-view-model.js',
    ]);

    // Subscriptions: ok (62%), low <= 20% (14% dashed ring), unknown (never 0%)
    const quotaSection = page.locator('section[aria-label="Left in each subscription"]');
    await expect(quotaSection).toContainText('CommandCode');
    await expect(quotaSection).toContainText('62%');
    await expect(quotaSection).toContainText('resets Tue 14:00');

    await expect(quotaSection).toContainText('ChatGPT');
    await expect(quotaSection).toContainText('14%');
    await expect(quotaSection).toContainText('resets in 2h');
    const chatgptTrackOutline = await quotaSection
      .locator('[role="img"][aria-label="ChatGPT 14 percent left"]')
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(chatgptTrackOutline).toBe('dashed');

    const claudeRow = quotaSection.locator('li', { hasText: 'Claude' });
    await expect(claudeRow).toContainText('unknown');
    await expect(claudeRow).not.toContainText('0%');
    const claudeTrackBorder = await quotaSection
      .locator('[role="img"][aria-label="Claude quota unknown"]')
      .evaluate((el) => getComputedStyle(el).borderStyle);
    expect(claudeTrackBorder).toBe('dashed');

    // Zero horizontal overflow at laptop (1440x900)
    const desktopOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(desktopOverflow.scrollWidth).toBeLessThanOrEqual(desktopOverflow.clientWidth);

    if (process.env.CAPTURE_DIR) {
      mkdirSync(process.env.CAPTURE_DIR, { recursive: true });
      await page.evaluate(() => document.fonts?.ready);
      await page.screenshot({
        path: join(process.env.CAPTURE_DIR, 'desktop.png'),
        fullPage: true,
      });
    }

    // Zero horizontal overflow at phone (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    const mobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(mobileOverflow.scrollWidth).toBeLessThanOrEqual(mobileOverflow.clientWidth);

    if (process.env.CAPTURE_DIR) {
      await page.evaluate(() => document.fonts?.ready);
      await page.screenshot({
        path: join(process.env.CAPTURE_DIR, 'mobile.png'),
        fullPage: true,
      });
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('running step state, stopped warning, waiting_for_you, and idle with lastRun via /api/run-view', async ({ page }) => {
    const { consoleErrors, pageErrors } = attachErrorCollectors(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    const snapshots = {
      running: buildRunViewSnapshot({
        ...stoppedWaitingFixture.scenarios.running,
        subscriptions: stoppedWaitingFixture.subscriptions,
      }),
      stopped: buildRunViewSnapshot({
        ...stoppedWaitingFixture.scenarios.stopped,
        subscriptions: stoppedWaitingFixture.subscriptions,
      }),
      waiting: buildRunViewSnapshot({
        ...stoppedWaitingFixture.scenarios.waitingForYou,
        subscriptions: stoppedWaitingFixture.subscriptions,
      }),
      idle: buildRunViewSnapshot({
        now: stoppedWaitingFixture.now,
        sourceStatus: 'fixture',
        rawRun: null,
        rawLastRun: stoppedWaitingFixture.rawLastRun,
        subscriptions: stoppedWaitingFixture.subscriptions,
      }),
    };

    let activeKey = 'running';
    await page.route('**/api/run-view', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshots[activeKey]),
      });
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // 1. Running step state (6th step state: PlayIcon + "now" tag)
    const runningStep = page.locator('ol[aria-label="Shipping steps"] li', {
      hasText: 'Re-check the verdict still fits the code',
    });
    await expect(runningStep).toContainText('now', { timeout: 8000 });
    const playPath = await runningStep.locator('svg path').first().getAttribute('d');
    expect(playPath).toContain('15.25');

    // 2. Stopped warning (4th warning kind)
    activeKey = 'stopped';
    const warningsSection = page.locator('section[aria-label="Warnings"]');
    await expect(warningsSection).toContainText('Run stopped', { timeout: 8000 });
    await expect(warningsSection).toContainText('Tests failed twice on the build check.');

    // 3. Waiting for you
    activeKey = 'waiting';
    const runSection = page.locator('section[aria-label="Current run"]');
    await expect(runSection).toContainText('Waiting for you', { timeout: 8000 });
    await expect(runSection.locator('h1')).toHaveText('After merge');

    // 4. Idle with lastRun one-line result
    activeKey = 'idle';
    await expect(runSection.locator('h1')).toHaveText('No card running right now', { timeout: 8000 });
    await expect(runSection).toContainText('Last run:');
    await expect(runSection).toContainText('Mission control Run view');
    await expect(runSection).toContainText(/estimate/i);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
