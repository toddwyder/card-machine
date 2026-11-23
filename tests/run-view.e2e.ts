import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { appendModelCall, NOW, prepare } from '../dashboard/tests/flow-fixture.mjs';

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

describe('Mission control Run view', () => {
  test('folds the screen at the pinned instant', async ({ app, screen, browser }) => {
    await prepare({ scene: 'running' });
    await openRunView(app, screen);
    const read = await snapshot(browser);
    expect(read.observedAt).toBe(NOW);
  });

  test('shows stage, steps, tokens, estimate, and helper cards on a laptop', async ({ app, screen, browser }) => {
    await prepare({ scene: 'running' });
    await browser.setViewport({ width: 1280, height: 720 });
    await openRunView(app, screen);

    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Mission control's Run view/ })).toBeVisible();
    await expect(panel.getByText(/Running · /)).toBeVisible();

    const stage = panel.getByText('Build the slices', { exact: true });
    await expect(stage).toBeVisible();
    const { stageSize, titleSize } = await browser.evaluate(() => {
      const panelNode = document.querySelector('[aria-label="The running card"]');
      const stageNode = Array.from(panelNode.querySelectorAll('*')).find(el => el.textContent === 'Build the slices' && el.children.length === 0);
      const titleNode = panelNode.querySelector('h1, h2, h3');
      return {
        stageSize: parseFloat(getComputedStyle(stageNode).fontSize),
        titleSize: parseFloat(getComputedStyle(titleNode).fontSize),
      };
    });
    expect(stageSize).toBeGreaterThan(24);
    expect(stageSize).toBeGreaterThan(titleSize);

    await expect(panel.getByText(/\d+ k tokens/)).toBeVisible();
    await expect(panel.getByText(/about \$|not priced yet/)).toBeVisible();
    await expect(panel.getByText('Architect the shape').first()).toBeVisible();

    const read = await snapshot(browser);
    const helpers = browser.locator('article[data-state]');
    await expect(helpers).toHaveCount(read.run.helpers.length);
    for (const helper of read.run.helpers) {
      await expect(screen.getByText(helper.name, { exact: true })).toBeVisible();
      const shown = await browser.evaluate(name => {
        const cards = Array.from(document.querySelectorAll('article[data-state]'));
        const match = cards.find(c => c.textContent.includes(name));
        if (!match) return null;
        return Array.from(match.querySelectorAll('ul li[data-state] > span:first-of-type'), el => el.innerText);
      }, helper.name);
      expect(shown).toEqual(helper.actions.map(action => action.name));
    }

    const { steps } = read.run;
    const row = browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"]`);
    await expect(row.getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const pillTexts = await browser.evaluate(label => {
      const ol = document.querySelector(`ol[aria-label="${label}"]`);
      return Array.from(ol.querySelectorAll('li'), el => el.innerText);
    }, `The run's ${steps.total} steps`);
    expect(pillTexts).toEqual(steps.list.map(step => step.short));

    const current = browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"] [aria-current="step"]`);
    await expect(current).toHaveAttribute('data-state', 'in_progress');
    expect(await styleOf(browser, '[aria-current="step"]', 'backgroundColor')).toBe('rgb(220, 235, 203)');
    const skipped = browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"] li[data-state="skipped"]`);
    await expect(skipped).toHaveCount(steps.list.filter(step => step.status === 'skipped').length);
    if (await skipped.count()) {
      expect(await styleOf(browser, 'li[data-state="skipped"]', 'borderTopStyle')).toBe('dotted');
      expect(await styleOf(browser, 'li[data-state="skipped"] span', 'textDecorationLine')).toBe('line-through');
    }

    await app.screenshot('laptop-running');
  });

  test('renders waiting_for_you, stuck, burning_fast, stopped, and ended_unknown by shape', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'uat' });
    await openRunView(app, screen);
    const uatRead = await snapshot(browser);
    expect(uatRead.run.status).toBe('waiting_for_you');
    await expect(browser.locator('main')).toContainText('Waiting for you');
    await app.screenshot('waiting-for-you');

    await prepare({ scene: 'stuck' });
    await openRunView(app, screen);
    const stuck = browser.locator('[data-kind="stuck"]');
    await expect(stuck).toBeVisible();
    expect(await styleOf(browser, '[data-kind="stuck"]', 'borderTopStyle')).toBe('dashed');
    await expect(stuck).toContainText(/Nothing has happened .* minutes/);
    await expect(browser.locator('svg[data-state="stuck"]').first()).toBeVisible();
    await app.screenshot('stuck');

    await prepare({ scene: 'burning' });
    await openRunView(app, screen);
    const burning = browser.locator('[data-kind="burning_fast"]');
    await expect(burning).toBeVisible();
    expect(await styleOf(browser, '[data-kind="burning_fast"]', 'borderTopStyle')).toBe('dotted');
    await expect(burning).toContainText(/Feature Refactoring 1 used .* tokens in one model call\./);
    await app.screenshot('burning-fast');

    await prepare({ scene: 'stopped' });
    await openRunView(app, screen);
    const stopped = browser.locator('[data-kind="stopped"]');
    await expect(stopped).toBeVisible();
    expect(await styleOf(browser, '[data-kind="stopped"]', 'borderTopStyle')).toBe('solid');
    expect(await styleOf(browser, '[data-kind="stopped"]', 'borderTopColor')).toBe('rgb(163, 33, 45)');
    expect(await styleOf(browser, '[data-kind="stopped"] p span', 'textDecorationLine')).toBe('line-through');
    await app.screenshot('stopped');

    await prepare({ scene: 'ended-unknown' });
    await openRunView(app, screen);
    const ended = browser.locator('[data-kind="ended_unknown"]');
    await expect(ended).toBeVisible();
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

  test('shows finished and quiet states and updates tokens live', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 1280, height: 720 });

    await prepare({ scene: 'finished' });
    await openRunView(app, screen);
    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel.getByText(/Finished · /)).toBeVisible();
    const sentBackOutline = await browser.evaluate(() => {
      const panelNode = document.querySelector('[aria-label="The running card"]');
      const sentBack = Array.from(panelNode.querySelectorAll('li')).find(li => li.textContent.includes('Send it back to the builder'));
      return sentBack ? getComputedStyle(sentBack).borderTopStyle : null;
    });
    expect(sentBackOutline).toBe('dotted');
    await app.screenshot('finished');

    await prepare({ scene: 'quiet' });
    await openRunView(app, screen);
    await expect(screen.getByRole('region', { name: 'Nothing running' })).toBeVisible();
    await expect(screen.getByText('Nothing is running right now')).toBeVisible();
    await app.screenshot('nothing-running');

    await prepare({ scene: 'running' });
    await openRunView(app, screen);
    const livePanel = screen.getByRole('region', { name: 'The running card' });
    const before = await livePanel.getByText(/\d+ k tokens/).textContent();
    appendModelCall({ inputTokens: 240000 });
    await expect(livePanel.getByText(/\d+ k tokens/)).not.toHaveText(before, { timeout: 15000 });
  });

  test('stacks warnings, panel, helpers, and bars on a 390px phone with no overflow', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });

    await prepare({ scene: 'stuck' });
    await openRunView(app, screen);

    await expect(screen.getByText('Build the slices', { exact: true })).toBeVisible();
    const { stageSize, titleSize } = await browser.evaluate(() => {
      const panelNode = document.querySelector('[aria-label="The running card"]');
      const stageNode = Array.from(panelNode.querySelectorAll('*')).find(el => el.textContent === 'Build the slices' && el.children.length === 0);
      const titleNode = panelNode.querySelector('h1, h2, h3');
      return {
        stageSize: parseFloat(getComputedStyle(stageNode).fontSize),
        titleSize: parseFloat(getComputedStyle(titleNode).fontSize),
      };
    });
    expect(stageSize).toBeGreaterThan(titleSize);

    const boxes = await browser.evaluate(() => {
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

    const overflow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await app.screenshot('phone-stuck');

    await prepare({ scene: 'running', readings: 'normal' });
    await browser.reload();
    const panel = screen.getByRole('region', { name: 'The running card' });
    await expect(panel).toBeVisible();
    const { steps } = await snapshot(browser).then(read => read.run);
    await expect(browser.locator(`[aria-label="The running card"] ol[aria-label="The run's ${steps.total} steps"]`).getByRole('listitem')).toHaveCount(steps.total);
    await expect(panel.getByText(`step ${steps.index} of ${steps.total}`, { exact: true })).toBeVisible();
    const narrow = await browser.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(narrow).toBeLessThanOrEqual(1);
    await app.screenshot('phone-running');
  });
});
