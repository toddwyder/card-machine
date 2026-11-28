import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { NOW, prepare, recordSpend } from '../dashboard/tests/flow-fixture.mjs';

const REASON_WORDS = {
  'no stored sign-in': 'No sign-in is stored for this subscription.',
  'sign-in expired': 'The stored sign-in has expired.',
  'reading failed': 'The server could not read this subscription.',
  'timed out': 'The reading took too long to answer.',
};

async function openRunView(app, screen) {
  await app.open('/control/');
  await expect(screen.getByRole('banner')).toContainText('Mission control');
}

async function snapshot(browser) {
  return browser.evaluate(async () => {
    const response = await fetch('/control/api/run-view');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

async function styleOf(browser, selector, prop) {
  return browser.evaluate(
    ({ sel, key }) => {
      const node = document.querySelector(sel);
      return node ? getComputedStyle(node)[key] : null;
    },
    { sel: selector, key: prop },
  );
}

// The spend line in the panel reads like this, so a test can name the number it expects without
// repeating the screen's own formatting rules.
function spendText(tokens) {
  if (!tokens) return 'no tokens yet';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)} M tokens`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)} k tokens`;
  return `${tokens} tokens`;
}

describe('Mission control Run view', () => {
  test('folds the screen at the pinned instant', async ({ app, screen, browser }) => {
    await prepare({ scene: 'running' });
    await openRunView(app, screen);
    const read = await snapshot(browser);
    expect(read.observedAt).toBe(NOW);
  });

  test('shows the stage, its steps, and the spend the session left behind on a laptop', async ({ app, screen, browser }) => {
    await prepare({ scene: 'running' });
    await browser.setViewport({ width: 1280, height: 720 });
    await openRunView(app, screen);

    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    const read = await snapshot(browser);
    const { run } = read;
    const { steps } = run;

    await expect(panel.getByRole('heading', { name: run.title })).toBeVisible();
    await expect(panel.getByText(/Running · /)).toBeVisible();

    // The stage is a playbook's name, and the biggest text in the panel.
    expect(run.stage).toBe('Feature');
    await expect(panel.getByRole('heading', { name: run.stage })).toBeVisible();
    const { stageSize, titleSize } = await browser.evaluate(stage => {
      const panelNode = document.querySelector('[aria-label="The running card"]');
      const stageNode = Array.from(panelNode.querySelectorAll('*')).find(el => el.textContent === stage && el.children.length === 0);
      const titleNode = panelNode.querySelector('h1');
      return {
        stageSize: parseFloat(getComputedStyle(stageNode).fontSize),
        titleSize: parseFloat(getComputedStyle(titleNode).fontSize),
      };
    }, run.stage);
    expect(stageSize).toBeGreaterThan(24);
    expect(stageSize).toBeGreaterThan(titleSize);

    // The step in hand, in the session's own words.
    await expect(panel.getByText(run.step, { exact: true }).first()).toBeVisible();
    await expect(panel.getByText(new RegExp(spendText(run.usage.tokens).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
    await expect(panel.getByText(/about \$|not priced yet/)).toBeVisible();

    // Helper cards are gone: the session's own steps are the whole picture of what it is doing.
    expect(await browser.locator('article[data-state]').count()).toBe(0);
    expect(await browser.evaluate(() => document.body.innerText.includes('Helpers'))).toBe(false);

    const rowSelector = `[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"]`;
    const row = browser.locator(rowSelector);
    await expect(row.getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const pillTexts = await browser.evaluate(label => {
      const ol = document.querySelector(`ol[aria-label="${label}"]`);
      return Array.from(ol.querySelectorAll('li'), el => el.innerText);
    }, `The run's ${steps.total} steps`);
    expect(pillTexts).toEqual(steps.list.map(step => step.short));

    const current = browser.locator(`${rowSelector} [aria-current="step"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute('data-state', 'in_progress');
    expect(await styleOf(browser, '[aria-current="step"]', 'backgroundColor')).toBe('rgb(220, 235, 203)');
    const skipped = browser.locator(`${rowSelector} li[data-state="skipped"]`);
    await expect(skipped).toHaveCount(steps.list.filter(step => step.status === 'skipped').length);

    await app.screenshot('laptop-running');
  });

  test('names the playbook the list has moved on to', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'shipping' });
    await openRunView(app, screen);
    const read = await snapshot(browser);
    expect(read.run.stage).toBe('Shipping');
    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel.getByRole('heading', { name: 'Shipping' })).toBeVisible();
    await expect(panel.getByText(`step ${read.run.steps.index} of ${read.run.steps.total}`, { exact: true })).toBeVisible();
    await expect(
      browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${read.run.steps.total} steps"]`).getByRole('listitem'),
    ).toHaveCount(read.run.steps.total);
    await app.screenshot('shipping');

    // A session that has opened but has not written its to-do list yet gets no guessed stage.
    await prepare({ scene: 'no-todo' });
    await openRunView(app, screen);
    await expect(screen.getByText('The session has not named its playbook yet.')).toBeVisible();
    expect(await browser.locator('ol[aria-label^="The run\'s"]').count()).toBe(0);
    await app.screenshot('no-steps-yet');
  });

  test('draws each warning state by its own shape', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'stuck' });
    await openRunView(app, screen);
    let read = await snapshot(browser);
    let warning = browser.locator('[data-kind="stuck"]');
    await expect(warning).toBeVisible();
    expect(await styleOf(browser, '[data-kind="stuck"]', 'borderTopStyle')).toBe('dashed');
    await expect(warning).toContainText(read.warnings.find(w => w.kind === 'stuck').text);
    await expect(warning).toContainText(/Nothing has happened in the run for \d+ minutes\./);
    await expect(browser.locator('svg[data-state="stuck"]').first()).toBeVisible();
    await app.screenshot('stuck');

    await prepare({ scene: 'burning' });
    await openRunView(app, screen);
    read = await snapshot(browser);
    warning = browser.locator('[data-kind="burning_fast"]');
    await expect(warning).toBeVisible();
    expect(await styleOf(browser, '[data-kind="burning_fast"]', 'borderTopStyle')).toBe('dotted');
    await expect(warning).toContainText(read.warnings.find(w => w.kind === 'burning_fast').text);
    await expect(warning).toContainText(/One model call used [\d,]+ tokens\./);
    await app.screenshot('burning-fast');

    await prepare({ scene: 'stopped' });
    await openRunView(app, screen);
    read = await snapshot(browser);
    warning = browser.locator('[data-kind="stopped"]');
    await expect(warning).toBeVisible();
    expect(await styleOf(browser, '[data-kind="stopped"]', 'borderTopStyle')).toBe('solid');
    expect(await styleOf(browser, '[data-kind="stopped"]', 'borderTopColor')).toBe('rgb(163, 33, 45)');
    // An ended run leaves the panel and keeps only its last result, so the warning carries the words.
    await expect(warning).toContainText(read.warnings.find(w => w.kind === 'stopped').text);
    await expect(warning).toContainText('The run stopped at “');
    expect(await styleOf(browser, '[data-kind="stopped"] p span', 'textDecorationLine')).toBe('line-through');
    await app.screenshot('stopped');

    await prepare({ scene: 'ended-unknown' });
    await openRunView(app, screen);
    await expect(browser.locator('[data-kind="ended_unknown"]')).toBeVisible();
    expect(await styleOf(browser, '[data-kind="ended_unknown"]', 'borderTopStyle')).toBe('dashed');
    await app.screenshot('ended-unknown');
  });

  test('renders subscription bars matching readings and unknown on failed readings', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'running', readings: 'low' });
    await openRunView(app, screen);

    const quotaLow = browser.locator('[data-kind="quota_low"]');
    await expect(quotaLow).toBeVisible();
    expect(await styleOf(browser, '[data-kind="quota_low"]', 'borderTopStyle')).toBe('solid');
    await expect(quotaLow).toContainText(/Claude: 11% of this 5-hour window left\./);

    const read = await snapshot(browser);
    for (const subscription of read.subscriptions) {
      const row = browser.locator(`li[data-subscription="${subscription.id}"]`);
      await expect(row).toBeVisible();
      if (subscription.status !== 'fresh') {
        await expect(row).toContainText('Reading failed, unknown');
        await expect(row).toContainText(REASON_WORDS[subscription.reason]);
        continue;
      }
      for (const win of subscription.windows) {
        const bar = browser.locator(`li[data-subscription="${subscription.id}"] [data-window="${win.window}"]`);
        await expect(bar).toContainText(`${win.percentLeft}% left`);
        await expect(bar).toContainText('refills');
        const outline = await styleOf(
          browser,
          `li[data-subscription="${subscription.id}"] [data-window="${win.window}"] [role="img"]`,
          'outlineStyle',
        );
        expect(outline).toBe(win.low ? 'dashed' : 'none');
      }
    }
    await app.screenshot('quota-low');

    await prepare({ scene: 'running', readings: 'stale' });
    await openRunView(app, screen);
    await expect(browser.locator('li[data-subscription="claude"]')).toContainText('Reading failed, unknown');
    await expect(browser.locator('li[data-subscription="claude"]')).toContainText('The stored sign-in has expired.');
    await expect(browser.locator('li[data-subscription="commandcode"]')).toContainText('Reading failed, unknown');
    await expect(browser.locator('li[data-subscription="commandcode"]')).toContainText('No sign-in is stored for this subscription.');
  });

  test('shows a finished run, the idle screen, and the spend changing live', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'finished' });
    await openRunView(app, screen);
    // A finished run leaves the panel behind and keeps its last result on the idle screen.
    await expect(screen.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(screen.getByText('The last run finished.')).toBeVisible();
    const finished = await snapshot(browser);
    expect(finished.run).toBe(null);
    expect(finished.lastResult.status).toBe('finished');
    // Start shows again once nothing is running.
    await expect(screen.getByRole('button', { name: 'Start', exact: true }))
      .toHaveCount(finished.readyCards.cards.length);
    await app.screenshot('finished');

    await prepare({ scene: 'idle' });
    await openRunView(app, screen);
    await expect(screen.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(screen.getByText('Nothing is running right now')).toBeVisible();
    const idle = await snapshot(browser);
    await expect(screen.getByRole('button', { name: 'Start', exact: true })).toHaveCount(idle.readyCards.cards.length);
    await app.screenshot('nothing-running');

    await prepare({ scene: 'running' });
    await openRunView(app, screen);
    const livePanel = screen.getByRole('region', { name: 'The running card' });
    const before = await livePanel.getByText(/\d+ k tokens/).textContent();
    const live = await snapshot(browser);
    recordSpend(live.run.usage.tokens + 96000);
    await expect(livePanel.getByText(/\d+ k tokens/)).not.toHaveText(before, { timeout: 15000 });
  });

  test('stacks warnings, panel, and bars on a 390px phone with no overflow', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });

    await prepare({ scene: 'stuck' });
    await openRunView(app, screen);

    const stuck = await snapshot(browser);
    await expect(screen.getByText(stuck.run.stage, { exact: true })).toBeVisible();
    const { stageSize, titleSize } = await browser.evaluate(stage => {
      const panelNode = document.querySelector('[aria-label="The running card"]');
      const stageNode = Array.from(panelNode.querySelectorAll('*')).find(el => el.textContent === stage && el.children.length === 0);
      const titleNode = panelNode.querySelector('h1');
      return {
        stageSize: parseFloat(getComputedStyle(stageNode).fontSize),
        titleSize: parseFloat(getComputedStyle(titleNode).fontSize),
      };
    }, stuck.run.stage);
    expect(stageSize).toBeGreaterThan(titleSize);

    const boxes = await browser.evaluate(() => {
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

    const overflow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await app.screenshot('phone-stuck');

    await prepare({ scene: 'running', readings: 'normal' });
    await browser.reload();
    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    const { steps } = await snapshot(browser).then(read => read.run);
    await expect(
      browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"]`).getByRole('listitem'),
    ).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const narrow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(narrow).toBeLessThanOrEqual(1);
    await app.screenshot('phone-running');
  });
});
