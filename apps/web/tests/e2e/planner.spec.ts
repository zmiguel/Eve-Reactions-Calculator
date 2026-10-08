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
