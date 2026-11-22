// Drives the built Run view against the fixture run: the stage reads as the biggest thing, every
// state and warning carries its own shape, each helper lists its actions newest first, and the
// page keeps up when the run's log grows.

import { test, expect } from '@playwright/test';
import { appendEvent } from './flow-fixture.mjs';

const SHOTS = 'test-results/screenshots';

async function fontSize(page, text) {
  return page.locator(`text=${text}`).first().evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
}

test('the running card, its stage and its spend read at a glance', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Mission control's Run view");
  const stage = await fontSize(page, 'Build the slices');
  expect(stage).toBeGreaterThan(24);
  expect(stage).toBeGreaterThan(await fontSize(page, "Mission control's Run view"));

  await expect(page.getByText(/Running · \d/)).toBeVisible();
  await expect(page.getByText(/tokens/).first()).toBeVisible();
  await expect(page.getByText(/estimate/).first()).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${SHOTS}/laptop.png`, fullPage: true });
});

test('each helper lists its actions newest first, one row per call', async ({ page, request }) => {
  await page.goto('./');
  const snapshot = await (await request.get('./api/run-view')).json();

  for (const helper of snapshot.run.helpers) {
    const card = page.locator('article', { hasText: helper.name }).first();
    await expect(card.getByRole('heading', { level: 3 })).toHaveText(helper.name);
    const rows = card.locator('ul li');
    const shown = (await rows.allInnerTexts()).map(text => text.split('\n')[0]);
    const expected = helper.actions.map(action => action.name);
    expect(shown.slice(0, expected.length)).toEqual(expected);
    const times = helper.actions.map(action => action.at);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  }
});

test('every state and every warning carries its own shape', async ({ page }) => {
  await page.goto('./');

  for (const state of ['done', 'working', 'pending']) {
    await expect(page.locator(`svg[data-state="${state}"]`).first()).toBeVisible();
  }
  const shapes = await page.locator('svg[data-state]').evaluateAll(nodes =>
    [...new Set(nodes.map(node => `${node.dataset.state}:${node.innerHTML.length}`))],
  );
  expect(new Set(shapes.map(shape => shape.split(':')[1])).size).toBeGreaterThan(2);

  const low = page.locator('[data-kind="quota_low"]');
  await expect(low).toBeVisible();
  await expect(low).toHaveCSS('border-top-style', 'solid');
  await expect(low.getByText('Quota low')).toBeVisible();

  await expect(page.locator('[data-state="unknown"]')).toContainText('unknown');

  const borders = await page.locator('[data-kind]').evaluateAll(nodes =>
    nodes.map(node => `${node.dataset.kind}:${getComputedStyle(node).borderTopStyle}`),
  );
  expect(new Set(borders).size).toBe(borders.length);
});

test('each subscription shows one bar per window it read, with that window’s own number', async ({ page, request }) => {
  await page.goto('./');
  const snapshot = await (await request.get('./api/run-view')).json();
  const fresh = snapshot.subscriptions.filter(subscription => subscription.status === 'fresh');
  expect(fresh.length).toBeGreaterThan(0);

  for (const subscription of fresh) {
    const row = page.locator(`li[data-subscription="${subscription.id}"]`);
    const bars = row.locator('[data-window]');
    await expect(bars).toHaveCount(subscription.windows.length);
    for (const window of subscription.windows) {
      const bar = row.locator(`[data-window="${window.window}"]`);
      await expect(bar).toContainText(`${window.percentLeft}% left`);
      await expect(bar).toContainText('refills');
      const outline = await bar.locator('[role="img"]').evaluate(node => getComputedStyle(node).outlineStyle);
      expect(outline).toBe(window.low ? 'dashed' : 'none');
    }
  }
});

test('the page keeps up when the run log grows', async ({ page }) => {
  await page.goto('./');
  const spend = page.getByText(/tokens/).first();
  const before = await spend.innerText();

  appendEvent({ id: 'spec-model-1', at: Date.now(), kind: 'model', agent: 'flow-build', model: 'commandcode/moonshotai/Kimi-K3.1-Pro', inputTokens: 240000, outputTokens: 1200, cachedInputTokens: 0 });

  await expect(spend).not.toHaveText(before, { timeout: 15_000 });
});

test('the phone stacks the same screen and keeps the stage biggest', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  const stage = await fontSize(page, 'Build the slices');
  expect(stage).toBeGreaterThan(24);
  expect(stage).toBeGreaterThan(await fontSize(page, "Mission control's Run view"));

  const warnings = await page.locator('[data-kind]').first().boundingBox();
  const panel = await page.locator('section[aria-label="The running card"]').boundingBox();
  expect(warnings.y).toBeLessThan(panel.y);

  await page.screenshot({ path: `${SHOTS}/phone.png`, fullPage: true });
});
