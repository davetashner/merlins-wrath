import { expect, test } from '@playwright/test';
import { parseIssues } from '../scripts/backlog/parse.ts';
import { renderPage } from '../scripts/backlog/render.ts';

// mw-e00.11 AC-6: the generated backlog.html works offline with no console errors.
const jsonl = [
  { id: 'mw-e09', title: 'E09 — Stealth', issue_type: 'epic', description: '## Outcome\nSneak.' },
  {
    id: 'mw-e09.1',
    title: 'Light and shadow',
    status: 'closed',
    labels: ['milestone:m1'],
    dependencies: [{ issue_id: 'mw-e09.1', depends_on_id: 'mw-e09', type: 'parent-child' }],
  },
  {
    id: 'mw-e09.2',
    title: 'Footstep noise',
    status: 'open',
    labels: ['milestone:m1'],
    acceptance_criteria: '- AC-1 [unit] Given boots, then noise.',
    dependencies: [
      { issue_id: 'mw-e09.2', depends_on_id: 'mw-e09', type: 'parent-child' },
      { issue_id: 'mw-e09.2', depends_on_id: 'mw-e09.1', type: 'blocks' },
    ],
  },
  {
    id: 'mw-e09.3',
    title: 'Guards hear <b>things</b>',
    status: 'open',
    labels: ['milestone:m2'],
    dependencies: [{ issue_id: 'mw-e09.3', depends_on_id: 'mw-e09', type: 'parent-child' }],
  },
]
  .map((r) => JSON.stringify(r))
  .join('\n');

const html = renderPage({
  issues: parseIssues(jsonl),
  prStatus: [],
  github: 'off',
  now: new Date('2026-09-27T00:00:00Z'),
  sha: 'abcdef1234567',
});

test('AC-6: renders offline, tabs switch by click and keyboard, zero console errors', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('request', (req) => requests.push(req.url()));
  await context.setOffline(true);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.setContent(html);

  const upcoming = page.getByRole('tab', { name: /Upcoming/ });
  const completed = page.getByRole('tab', { name: /Completed/ });
  await expect(upcoming).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-upcoming .row')).toHaveCount(2);
  await expect(page.locator('#panel-completed')).toBeHidden();
  await expect(page.getByText('Guards hear <b>things</b>')).toBeVisible();

  await completed.click();
  await expect(completed).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-completed')).toBeVisible();
  await expect(page.locator('#panel-upcoming')).toBeHidden();

  await completed.press('ArrowLeft');
  await expect(upcoming).toBeFocused();
  await expect(upcoming).toHaveAttribute('aria-selected', 'true');
  await upcoming.press('End');
  await expect(completed).toHaveAttribute('aria-selected', 'true');
  await completed.press('Home');
  await expect(upcoming).toHaveAttribute('aria-selected', 'true');

  // The acceptance criteria start collapsed; a dependency link jumps to the other tab and opens it.
  const row = page.locator('#mw-e09\\.2');
  await expect(row.getByText('Given boots, then noise.')).toBeHidden();
  await row.locator('summary').click();
  await expect(row.getByText('Given boots, then noise.')).toBeVisible();
  await row.getByRole('link', { name: 'mw-e09.1' }).click();
  await expect(completed).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mw-e09\\.1 details')).toHaveAttribute('open', '');

  // Search filters rows and updates the tab counts.
  await upcoming.click();
  await page.getByLabel('Search').fill('guards');
  await expect(page.locator('#panel-upcoming .row:visible')).toHaveCount(1);
  await expect(upcoming).toContainText('1 of 2');
  await page.getByLabel('Search').fill('nothing matches this');
  await expect(
    page.locator('#panel-upcoming').getByText('No items match these filters.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
