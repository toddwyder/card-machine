// Drives the Run view through every state a session can be in, on the built app, against the
// files a real run leaves behind: the record Start writes, the session's own to-do list in a real
// `state.db`, and the saved subscriptions and Ready cards. Every state is asserted by shape as
// well as colour, and each one leaves a picture in dashboard/docs/run-view-proof for the pull
// request. The fixture writes its times and `tests/start-server.mjs` pins the app's clock to the
// same instant, so the pictures repeat instead of carrying the minute the suite happened to run
// in. The browser's zone is pinned to UTC as well, because a subscription's reset date is a
// calendar day.

import { expect, test } from '@playwright/test';
import { NOW, prepare } from './flow-fixture.mjs';

const SHOTS = 'docs/run-view-proof';
const API = '/control/api/run-view';

test.use({ timezoneId: 'UTC' });

// The pin that keeps the committed pictures stable is one environment line in
// `tests/start-server.mjs`. Without it the screen still looks right and only the files change, so
// this asks the server what instant it folded at and fails when that line is gone.
test('folds the screen at the instant the proof pictures are pinned to', async ({ page }) => {
  await prepare({ scene: 'running' });
  const read = await snapshot(page);
  expect(read.observedAt, 'the screen was not folded at the pinned instant: RUN_VIEW_NOW is missing from tests/start-server.mjs, so every committed picture in docs/run-view-proof would drift on each run').toBe(NOW);
});

async function openRunView(page) {
  await page.goto('/control/');
  await expect(page.locator('header')).toContainText('Mission control');
}

async function snapshot(page) {
  const response = await page.request.get(API);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

// Every picture is taken the same way. The scene and the app read one fixed instant (see
// `NOW` in the fixture), and a settled transition keeps the bytes the same on a rerun.
async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: 'disabled' });
}

function warning(page, kind) {
  return page.locator(`[data-kind="${kind}"]`);
}

const borderTopStyle = locator => locator.evaluate(node => getComputedStyle(node).borderTopStyle);
const borderTopColour = locator => locator.evaluate(node => getComputedStyle(node).borderTopColor);
const backgroundColour = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor);

// The words the Run view puts under a failed reading, by reason. The reason itself is one of
// four short values the server picks; anything else reads as "reading failed".
const REASON_WORDS = {
  'no stored sign-in': 'No sign-in is stored for this subscription.',
  'sign-in expired': 'The stored sign-in has expired.',
  'reading failed': 'The server could not read this subscription.',
  'timed out': 'The reading took too long to answer.',
};

test.describe('the Run view on a laptop', () => {
  test('shows where a live card is, what it used, and the steps it wrote', async ({ page }) => {
    await prepare({ scene: 'running' });
    await openRunView(page);

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: "Todd presses Start on a card" })).toBeVisible();
    await expect(panel.getByText(/Running · /)).toBeVisible();

    // The stage the session follows is the largest thing on the page.
    const stage = panel.getByRole('heading', { name: 'Feature', exact: true });
    await expect(stage).toBeVisible();
    const stageSize = await stage.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const titleSize = await panel.getByRole('heading').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(stageSize).toBeGreaterThan(24);
    expect(stageSize).toBeGreaterThan(titleSize);

    // Tokens and a labelled dollar estimate: no price is invented for a run.
    await expect(panel.getByText('84 k tokens')).toBeVisible();
    await expect(panel.getByText('not priced yet')).toBeVisible();
    await expect(panel).not.toContainText('about $');

    // The session's own to-do list, in playbook order, with the step in hand filled in.
    const read = await snapshot(page);
    const { steps } = read.run;
    expect(steps.total).toBe(8);
    expect(steps.index).toBe(2);
    const row = panel.locator(`ol[aria-label="The run's ${steps.total} steps"]`);
    await expect(row.getByRole('listitem')).toHaveCount(steps.total);
    expect(await row.getByRole('listitem').allInnerTexts()).toEqual(steps.list.map(step => step.short));
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();

    const current = row.locator('[aria-current="step"]');
    await expect(current).toHaveAttribute('data-state', 'in_progress');
    await expect(current).toHaveAttribute('data-number', '2');
    expect(await backgroundColour(current)).toBe('rgb(220, 235, 203)');
    await expect(current).toContainText('Architect the shape');

    // Feature's last step is the playbook's final act.
    await expect(row.getByRole('listitem').last()).toContainText('Opening a PR');

    // Start cannot appear on a screen that is already running a card.
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);
    expect(read.readyCards.cards).toEqual([]);

    await shot(page, 'laptop');
  });

  test('says a session has not named its playbook yet, and still draws the run', async ({ page }) => {
    await prepare({ scene: 'no-todo' });
    await openRunView(page);

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/Running · /)).toBeVisible();
    await expect(panel.getByText('The session has not named its playbook yet.')).toBeVisible();
    await expect(panel.locator('h2')).toHaveCount(0);
    // Nothing is guessed at: with no to-do list there are no steps to count.
    await expect(panel.locator('ol[aria-label^="The run\'s"]')).toHaveCount(0);

    await shot(page, 'no-todo');
  });

  test('moves the marker and the stage when the session changes playbook', async ({ page }) => {
    await prepare({ scene: 'running' });
    await openRunView(page);
    const featurePanel = page.getByRole('region', { name: 'The running card' });
    await expect(featurePanel.getByRole('heading', { name: 'Feature', exact: true })).toBeVisible();
    const featureNumber = Number(await featurePanel.locator('[aria-current="step"]').getAttribute('data-number'));

    await prepare({ scene: 'shipping' });
    await page.reload();
    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByRole('heading', { name: 'Shipping', exact: true })).toBeVisible();
    const current = panel.locator('[aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Open the pull request');
    const shippingNumber = Number(await current.getAttribute('data-number'));
    expect(shippingNumber).toBeGreaterThan(featureNumber);

    const read = await snapshot(page);
    expect(read.run.stage).toBe('Shipping');
    expect(read.run.steps.index).toBe(shippingNumber);

    await shot(page, 'shipping');
  });

  test('shows every ended run as quiet, with its last result and no Start', async ({ page }) => {
    const scenes = [
      { scene: 'finished', sentence: 'The last run finished.' },
      { scene: 'stopped', sentence: 'The last run stopped.' },
      { scene: 'ended-unknown', sentence: 'The last run ended_unknown.' },
    ];
    for (const { scene, sentence } of scenes) {
      await prepare({ scene });
      await openRunView(page);

      await expect(page.getByRole('region', { name: 'Nothing running' })).toBeVisible();
      await expect(page.getByText('Nothing is running right now')).toBeVisible();
      await expect(page.getByText(sentence)).toBeVisible();
      await expect(page.getByRole('region', { name: 'The running card' })).toHaveCount(0);
      // A saved empty queue means there is no card to offer, so no Start can appear either.
      await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);

      if (scene === 'stopped') {
        const stopped = warning(page, 'stopped');
        await expect(stopped).toBeVisible();
        expect(await borderTopStyle(stopped)).toBe('solid');
        expect(await borderTopColour(stopped)).toBe('rgb(163, 33, 45)');
        await expect(stopped).toContainText('The run stopped at “Build the slices”.');
        const struck = stopped.locator('p span').first();
        expect(await struck.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe('line-through');
      }
      if (scene === 'ended-unknown') {
        const ended = warning(page, 'ended_unknown');
        await expect(ended).toBeVisible();
        expect(await borderTopStyle(ended)).toBe('dashed');
        await expect(ended).toContainText('The run ended without saying whether it finished or stopped.');
      }

      await shot(page, scene);
    }
  });

  test('draws stuck as a dashed box and says how long the session has been quiet', async ({ page }) => {
    await prepare({ scene: 'stuck' });
    await openRunView(page);

    const stuck = warning(page, 'stuck');
    await expect(stuck).toBeVisible();
    expect(await borderTopStyle(stuck)).toBe('dashed');
    await expect(stuck).toContainText('Nothing has happened in the run for 8 minutes.');
    await expect(page.locator('svg[data-state="stuck"]').first()).toBeVisible();

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Stuck · /)).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Feature', exact: true })).toBeVisible();

    await shot(page, 'stuck');
  });

  test('draws one model call over the limit as a dotted warning that names the tokens', async ({ page }) => {
    await prepare({ scene: 'burning' });
    await openRunView(page);

    const burning = warning(page, 'burning_fast');
    await expect(burning).toBeVisible();
    expect(await borderTopStyle(burning)).toBe('dotted');
    await expect(burning).toContainText('One model call used 240,000 tokens.');

    await shot(page, 'burning-fast');
  });

  test("draws a low window as a ringed bar, matched to that window's own reading", async ({ page }) => {
    await prepare({ scene: 'running', readings: 'low' });
    await openRunView(page);

    const quotaLow = warning(page, 'quota_low');
    await expect(quotaLow).toBeVisible();
    expect(await borderTopStyle(quotaLow)).toBe('solid');
    await expect(quotaLow).toContainText('Claude: 11% of this 5-hour window left.');

    const read = await snapshot(page);
    for (const subscription of read.subscriptions) {
      const row = page.locator(`li[data-subscription="${subscription.id}"]`);
      await expect(row).toBeVisible();
      if (subscription.status !== 'fresh') {
        await expect(row).toContainText('Reading failed, unknown');
        // The caption says which failure it was, so an expired sign-in reads differently from a blip.
        await expect(row).toContainText(REASON_WORDS[subscription.reason]);
        continue;
      }
      for (const window of subscription.windows) {
        const bar = row.locator(`[data-window="${window.window}"]`);
        await expect(bar).toContainText(`${window.percentLeft}% left`);
        await expect(bar).toContainText('refills');
        expect(await bar.getByRole('img').evaluate(node => getComputedStyle(node).outlineStyle)).toBe(window.low ? 'dashed' : 'none');
      }
    }

    await shot(page, 'quota-low');
  });

  test('tells an expired sign-in from no sign-in at all', async ({ page }) => {
    await prepare({ scene: 'running', readings: 'stale' });
    await openRunView(page);

    for (const id of ['claude', 'commandcode']) {
      const row = page.locator(`li[data-subscription="${id}"]`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('Reading failed, unknown');
    }
    await expect(page.locator('li[data-subscription="claude"]')).toContainText('The stored sign-in has expired.');
    await expect(page.locator('li[data-subscription="commandcode"]')).toContainText('No sign-in is stored for this subscription.');
  });

  test('offers a Start on each Ready card while nothing runs', async ({ page }) => {
    await prepare({ scene: 'idle' });
    await openRunView(page);

    const quiet = page.getByRole('region', { name: 'Nothing running' });
    await expect(quiet).toBeVisible();
    await expect(quiet.getByText('Nothing is running right now')).toBeVisible();
    await expect(quiet.getByText('The machine is idle. Start a Ready card and its run appears here by itself.')).toBeVisible();

    const cards = quiet.locator('ul > li');
    await expect(cards).toHaveCount(2);
    for (const [identifier, title] of [['JUL-407', 'Mission control shows the Run view'], ['JUL-361', 'A card can be started from Mission control']]) {
      const card = cards.filter({ hasText: identifier });
      await expect(card).toContainText(title);
      const start = card.getByRole('button', { name: 'Start' });
      await expect(start).toBeVisible();
      // Start's shape is asserted, never its action: clicking it would boot a paid session.
      await expect(start).toHaveAttribute('type', 'button');
      expect(await start.evaluate(node => getComputedStyle(node).borderRadius)).toBe('999px');
      expect(await backgroundColour(start)).toBe('rgb(29, 59, 39)');
    }

    await shot(page, 'ready-cards');
  });

  test('says the queue is empty instead of offering a Start it cannot back', async ({ page }) => {
    await prepare({ scene: 'empty' });
    await openRunView(page);

    await expect(page.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(page.getByText('No card is Ready right now.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);

    await shot(page, 'empty-queue');
  });

  test('says it could not read the Ready cards rather than looking empty', async ({ page }) => {
    await prepare({ scene: 'unreadable' });
    await openRunView(page);

    await expect(page.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(page.getByText('Could not read the Ready cards.')).toBeVisible();
    await expect(page.getByText('No card is Ready right now.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0);

    await shot(page, 'ready-unreadable');
  });
});

test.describe('the Run view on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('puts the warnings first, stacks the panel, and keeps the step row on a narrow screen', async ({ page }) => {
    await prepare({ scene: 'stuck' });
    await openRunView(page);

    const stage = page.getByRole('heading', { name: 'Feature', exact: true });
    await expect(stage).toBeVisible();
    const stageSize = await stage.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const titleSize = await page.getByRole('heading', { name: "Todd presses Start on a card" }).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(stageSize).toBeGreaterThan(titleSize);

    // The warning sits above the run panel, and the panel above the subscriptions.
    const boxes = await page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      return {
        warning: box('[data-kind="stuck"]'),
        panel: box('[aria-label="The running card"]'),
        quota: box('[aria-labelledby="quota-heading"]'),
      };
    });
    expect(boxes.warning).toBeGreaterThan(-1);
    expect(boxes.warning).toBeLessThan(boxes.panel);
    expect(boxes.panel).toBeLessThan(boxes.quota);

    // Nothing runs off the side of the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await prepare({ scene: 'running', readings: 'normal' });
    await page.reload();
    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();

    // The step row and its count survive the narrow screen, and still count the session's list.
    const { steps } = await snapshot(page).then(read => read.run);
    await expect(panel.locator(`ol[aria-label="The run's ${steps.total} steps"]`).getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(narrow).toBeLessThanOrEqual(1);

    await shot(page, 'phone');
  });

  test('reads an ended run by its dashes on a narrow screen too', async ({ page }) => {
    await prepare({ scene: 'ended-unknown' });
    await openRunView(page);

    const ended = warning(page, 'ended_unknown');
    await expect(ended).toBeVisible();
    expect(await borderTopStyle(ended)).toBe('dashed');
    await expect(page.getByText('The last run ended_unknown.')).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
