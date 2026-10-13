import { expect, gotoHydrated, test } from './fixtures';

test('planner: adding a target shows the plan', async ({ page }) => {
	await gotoHydrated(page, '/planner');
	await expect(page.locator('[data-results]')).toHaveCount(0);

	await page.getByRole('button', { name: '+ Add target' }).click();
	await expect(page.getByRole('list', { name: 'Targets' }).getByRole('listitem')).toHaveCount(1);

	const results = page.locator('[data-results]');
	await expect(results.getByRole('heading', { name: 'Reactions to run' })).toBeVisible();
	await expect(results.locator('[data-plan-reaction]').first()).toBeVisible();
	await expect(results.getByText('Shopping list per cycle', { exact: true })).toBeVisible();
	await expect(results.getByRole('button', { name: 'Copy multibuy' }).first()).toBeVisible();
});

test('planner: an anonymous visitor has no My inventory switch', async ({ page }) => {
	await gotoHydrated(page, '/planner');
	// The pasted lists are the only stock source (their fields sit in collapsed sections).
	await expect(page.getByLabel('Stock', { exact: true })).toBeAttached();
	await expect(page.getByLabel('Owned formulas', { exact: true })).toBeAttached();
	await expect(page.getByRole('button', { name: 'My inventory' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Pasted lists' })).toHaveCount(0);
	await expect(page.locator('[data-inventory-summary]')).toHaveCount(0);
});
