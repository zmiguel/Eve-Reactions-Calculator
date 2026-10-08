import { expect, gotoHydrated, test } from './fixtures';

const DETAIL = '/composite/titanium-carbide';

test('settings: an anonymous change persists across reload and changes the profit', async ({ page }) => {
	await page.goto(DETAIL);
	const profit = page.locator('[data-metric="Profit"] dd');
	await expect(profit).not.toBeEmpty();
	const before = (await profit.textContent())!.trim();

	await gotoHydrated(page, '/settings');
	await expect(page.locator('[data-sync-status]')).toContainText('Saved in this browser');
	const brokerFee = page.getByLabel('Broker fee %', { exact: true });
	await expect(brokerFee).toHaveValue('1.5');
	await brokerFee.fill('5');
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

	await page.reload();
	await expect(page.getByLabel('Broker fee %', { exact: true })).toHaveValue('5');

	await page.goto(DETAIL);
	await expect(profit).not.toBeEmpty();
	await expect(profit).not.toHaveText(before);
});
