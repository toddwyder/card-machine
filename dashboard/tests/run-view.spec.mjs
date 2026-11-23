// Drives the Run view through every state a run can be in, on the built app, against logs the
// machine's own writer produced. Every state is asserted by shape as well as colour, and each one
// leaves a picture in dashboard/docs/run-view-proof for the pull request.

import { expect, test } from '@playwright/test';
import { appendModelCall, prepare } from './flow-fixture.mjs';

const SHOTS = 'docs/run-view-proof';
const API = '/control/api/run-view';

async function openRunView(page) {
  await page.goto('/control/');
  await expect(page.locator('header')).toContainText('Mission control');
}

async function snapshot(page) {
  const response = await page.request.get(API);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function warning(page, kind) {
  return page.locator(`[data-kind="${kind}"]`);
}

const borderTopStyle = locator => locator.evaluate(node => getComputedStyle(node).borderTopStyle);
const borderTopColour = locator => locator.evaluate(node => getComputedStyle(node).borderTopColor);

// The words the Run view puts under a failed reading, by reason. The reason itself is one of
// four short values the server picks; anything else reads as "reading failed".
const REASON_WORDS = {
  'no stored sign-in': 'No sign-in is stored for this subscription.',
  'sign-in expired': 'The stored sign-in has expired.',
  'reading failed': 'The server could not read this subscription.',
  'timed out': 'The reading took too long to answer.',
};

test.describe('the Run view on a laptop', () => {
  test('shows where a running card is, what it used, and each helper', async ({ page }) => {
    await prepare({ scene: 'running' });
    await openRunView(page);

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Mission control's Run view/ })).toBeVisible();
    await expect(panel.getByText(/Running · /)).toBeVisible();

    // The stage the machine is in is the largest thing on the page.
    const stage = page.getByText('Build the slices', { exact: true });
    await expect(stage).toBeVisible();
    const stageSize = await stage.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const titleSize = await panel.getByRole('heading').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(stageSize).toBeGreaterThan(24);
    expect(stageSize).toBeGreaterThan(titleSize);

    // Tokens and a labelled dollar estimate.
    await expect(panel.getByText(/\d+ k tokens/)).toBeVisible();
    await expect(panel.getByText(/about \$|not priced yet/)).toBeVisible();

    // The step inside the stage, from the task list the machine wrote.
    await expect(panel.getByRole('paragraph').filter({ hasText: 'Architect the shape' })).toBeVisible();

    // One card per helper, each with the actions it has taken.
    const read = await snapshot(page);
    const helpers = page.locator('article[data-state]');
    await expect(helpers).toHaveCount(read.run.helpers.length);
    for (const helper of read.run.helpers) {
      const card = page.locator('article', { hasText: helper.name });
      await expect(card).toBeVisible();
      for (const action of helper.actions) {
        await expect(card.getByText(action.name, { exact: true })).toBeVisible();
      }
    }

    // The run's steps in one row, counted from the same list the step's name comes from.
    const { steps } = read.run;
    const row = panel.locator(`ol[aria-label="The run's ${steps.total} steps"]`);
    await expect(row.getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const pills = row.getByRole('listitem');
    expect(await pills.allInnerTexts()).toEqual(steps.list.map(step => step.short));

    // The step in hand is filled in; the one the run skipped keeps a dotted edge and a struck name.
    const current = row.locator('[aria-current="step"]');
    await expect(current).toHaveAttribute('data-state', 'in_progress');
    expect(await current.evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(220, 235, 203)');
    await expect(current).toContainText(steps.list[steps.index - 1].short);
    const skipped = row.locator('li[data-state="skipped"]');
    await expect(skipped).toHaveCount(steps.list.filter(step => step.status === 'skipped').length);
    if (await skipped.count()) {
      expect(await skipped.first().evaluate(node => getComputedStyle(node).borderTopStyle)).toBe('dotted');
      expect(await skipped.first().locator('span').evaluate(node => getComputedStyle(node).textDecorationLine)).toBe('line-through');
    }

    await page.screenshot({ path: `${SHOTS}/laptop.png`, fullPage: true });
  });

  test('lists each helper card newest action first', async ({ page }) => {
    await prepare({ scene: 'running' });
    await openRunView(page);
    const read = await snapshot(page);
    for (const helper of read.run.helpers.filter(item => item.actions.length > 1)) {
      const card = page.locator('article', { hasText: helper.name });
      const shown = await card.locator('ul li[data-state] > span:first-of-type').allInnerTexts();
      expect(shown).toEqual(helper.actions.map(action => action.name));
    }
  });

  test('says it is waiting for Todd while the acceptance gate holds the run', async ({ page }) => {
    await prepare({ scene: 'uat' });
    await openRunView(page);

    const read = await snapshot(page);
    expect(read.run.status).toBe('waiting_for_you');
    expect(read.run.stage.status).toBe('waiting');
    await expect(page.locator('main')).toContainText('Waiting for you');
    await expect(warning(page, 'stuck')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/waiting-for-you.png`, fullPage: true });
  });

  test('draws stuck as a dashed box and says how long it has been quiet', async ({ page }) => {
    await prepare({ scene: 'stuck' });
    await openRunView(page);

    const stuck = warning(page, 'stuck');
    await expect(stuck).toBeVisible();
    expect(await borderTopStyle(stuck)).toBe('dashed');
    await expect(stuck).toContainText(/Nothing has happened .* minutes/);
    await expect(page.locator('svg[data-state="stuck"]').first()).toBeVisible();

    // The helpers the machine stopped hearing from read as stuck by border as well as colour.
    const stuckHelper = page.locator('article[data-state="stuck"]').first();
    if (await stuckHelper.count()) expect(await borderTopStyle(stuckHelper)).toBe('dashed');

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Stuck · /)).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/stuck.png`, fullPage: true });
  });

  test('draws a burning model call as a dotted warning that names the agent', async ({ page }) => {
    await prepare({ scene: 'burning' });
    await openRunView(page);

    const burning = warning(page, 'burning_fast');
    await expect(burning).toBeVisible();
    expect(await borderTopStyle(burning)).toBe('dotted');
    await expect(burning).toContainText(/Feature Refactoring 1 used .* tokens in one model call\./);

    await page.screenshot({ path: `${SHOTS}/burning-fast.png`, fullPage: true });
  });

  test('draws a stopped run as a solid red warning with the title struck through', async ({ page }) => {
    await prepare({ scene: 'stopped' });
    await openRunView(page);

    const stopped = warning(page, 'stopped');
    await expect(stopped).toBeVisible();
    expect(await borderTopStyle(stopped)).toBe('solid');
    expect(await borderTopColour(stopped)).toBe('rgb(163, 33, 45)');
    await expect(stopped).toContainText(/The run stopped at .Check the build./);

    const struck = page.locator('[data-kind="stopped"] p span').first();
    expect(await struck.evaluate(node => getComputedStyle(node).textDecorationLine)).toBe('line-through');
    await expect(page.locator('svg[data-state="failed"]').first()).toBeVisible();

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Stopped · /)).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/stopped.png`, fullPage: true });
  });

  test('says a run that reached its last stage ended, without inventing a result', async ({ page }) => {
    await prepare({ scene: 'ended-unknown' });
    await openRunView(page);

    const ended = warning(page, 'ended_unknown');
    await expect(ended).toBeVisible();
    expect(await borderTopStyle(ended)).toBe('dashed');
    await expect(ended).toContainText('The machine reached its last stage without saying whether the run finished or stopped.');

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Ended, result unknown · /)).toBeVisible();
    // A dashed mark on the run line, not the working ring: the run is over.
    const runMark = panel.locator('p[data-run-state="ended_unknown"] svg');
    await expect(runMark).toHaveAttribute('data-state', 'stuck');

    // Once the run is known to be over the clock stops climbing.
    const runLine = panel.locator('p[data-run-state="ended_unknown"]');
    const before = await runLine.textContent();
    await page.waitForTimeout(2500);
    expect(await runLine.textContent()).toBe(before);

    await page.screenshot({ path: `${SHOTS}/ended-unknown.png`, fullPage: true });
  });

  test("draws a low window as a ringed bar, matched to that window's own reading", async ({ page }) => {
    await prepare({ scene: 'running', readings: 'low' });
    await openRunView(page);

    const quotaLow = warning(page, 'quota_low');
    await expect(quotaLow).toBeVisible();
    expect(await borderTopStyle(quotaLow)).toBe('solid');
    await expect(quotaLow).toContainText(/Claude: 11% of this 5-hour window left\./);

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

    await page.screenshot({ path: `${SHOTS}/quota-low.png`, fullPage: true });
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

  test('says nothing is running and how the last run ended', async ({ page }) => {
    await prepare({ scene: 'quiet' });
    await openRunView(page);

    await expect(page.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(page.getByText('Nothing is running right now')).toBeVisible();
    await expect(page.getByText('The last run finished.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'The running card' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/nothing-running.png`, fullPage: true });
  });

  test('shows a finished run as finished with no warnings', async ({ page }) => {
    await prepare({ scene: 'finished' });
    await openRunView(page);

    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Finished · /)).toBeVisible();
    await expect(page.locator('[data-kind]')).toHaveCount(0);
    await expect(panel.getByText('Hold at the end of the run')).toBeVisible();
    // A stage the run was sent back through keeps the dotted edge, not just a colour.
    const sentBack = panel.locator('li', { hasText: 'Send it back to the builder' });
    expect(await borderTopStyle(sentBack)).toBe('dotted');
    // Every task ticked, drawn as a filled mark.
    await expect(page.locator('svg[data-state="done"]').first()).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/finished.png`, fullPage: true });
  });

  test('keeps up without a refresh when the machine spends more tokens', async ({ page }) => {
    await prepare({ scene: 'running' });
    await openRunView(page);
    const panel = page.getByRole('region', { name: 'The running card' });
    const before = await panel.getByText(/\d+ k tokens/).innerText();

    appendModelCall({ inputTokens: 240000 });
    await expect(panel.getByText(/\d+ k tokens/)).not.toHaveText(before, { timeout: 15000 });
  });
});

test.describe('the Run view on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stacks the stage and the helper cards and puts the warnings first', async ({ page }) => {
    await prepare({ scene: 'stuck' });
    await openRunView(page);

    const stage = page.getByText('Build the slices', { exact: true });
    await expect(stage).toBeVisible();
    const stageSize = await stage.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const titleSize = await page.getByRole('heading', { name: /Mission control's Run view/ }).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(stageSize).toBeGreaterThan(titleSize);

    // The warning sits above the run panel, and the panel above the helpers.
    const boxes = await page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      return {
        warning: box('[data-kind="stuck"]'),
        panel: box('[aria-label="The running card"]'),
        helpers: box('article[data-state]'),
      };
    });
    expect(boxes.warning).toBeGreaterThan(-1);
    expect(boxes.warning).toBeLessThan(boxes.panel);
    expect(boxes.panel).toBeLessThan(boxes.helpers);

    // Nothing runs off the side of the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await prepare({ scene: 'running', readings: 'normal' });
    await page.reload();
    const panel = page.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();

    // The step row and its count survive the narrow screen, and still count the machine's list.
    const { steps } = await snapshot(page).then(read => read.run);
    await expect(panel.locator(`ol[aria-label="The run's ${steps.total} steps"]`).getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(narrow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${SHOTS}/phone.png`, fullPage: true });
  });

  test('reads an ended run by its dashes on a narrow screen too', async ({ page }) => {
    await prepare({ scene: 'ended-unknown' });
    await openRunView(page);

    const ended = warning(page, 'ended_unknown');
    await expect(ended).toBeVisible();
    expect(await borderTopStyle(ended)).toBe('dashed');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
