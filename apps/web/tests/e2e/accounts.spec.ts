import { SEED_PILOT, SEED_PILOT_TWO, devLogin, expect, freshContext, test } from './fixtures';

/** `SEED_STRUCTURE_HUBS` in `scripts/seed-local.ts`. */
const SEED_MARKET = 'Seed Market (private)';
const SHARED_HUB_ID = 'structure-1042508032148';

test('accounts: settings follow the account into a fresh browser', async ({ page, browser, baseURL }) => {
	await devLogin(page, SEED_PILOT, '/settings');
	await expect(page.locator('[data-sync-status]')).toContainText('Synced to your account');
	// A value no other spec uses, different on every run, so a stale account cannot pass by accident.
	const facilityTax = (2 + Math.floor(Math.random() * 400) / 100).toFixed(2);
	await page.getByLabel('Facility tax %', { exact: true }).fill(facilityTax);
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

	const other = await freshContext(browser, baseURL);
	try {
		const otherPage = await other.newPage();
		await otherPage.goto('/settings');
		await expect(otherPage.getByLabel('Facility tax %', { exact: true })).toHaveValue('1');
		await devLogin(otherPage, SEED_PILOT, '/settings');
		await expect(otherPage.getByLabel('Facility tax %', { exact: true })).toHaveValue(
			String(Number(facilityTax))
		);
	} finally {
		await other.close();
	}
});

test('accounts: the owner can select the private Seed Market hub', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/settings');
	const outputHub = page.getByLabel('Output hub', { exact: true });
	await expect(outputHub.getByRole('option', { name: SEED_MARKET, exact: true })).toHaveCount(1);
	await outputHub.selectOption({ label: SEED_MARKET });
	await page.getByRole('button', { name: 'Save settings' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('Output hub', { exact: true }).locator('option:checked')).toHaveText(
		SEED_MARKET
	);
});

test('accounts: the private Seed Market hub is not offered to anyone else', async ({ page }) => {
	await page.goto('/settings');
	const options = () => page.getByLabel('Output hub', { exact: true }).getByRole('option');
	await expect(options().first()).toBeAttached();
	await expect(options().filter({ hasText: /^Seed Market\b/ })).toHaveCount(0);

	await devLogin(page, SEED_PILOT_TWO, '/settings');
	await expect(page.locator('[data-sync-status]')).toContainText('Synced to your account');
	await expect(options().first()).toBeAttached();
	await expect(options().filter({ hasText: /^Seed Market\b/ })).toHaveCount(0);
});

test('accounts: the admin approves the pending shared hub', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/admin/hubs');
	const pending = page.locator(`[data-pending="${SHARED_HUB_ID}"]`);
	await expect(pending).toContainText('Seed Shared Market');
	const share = page.locator(`[data-hub="${SHARED_HUB_ID}"] [data-share]`);
	await expect(share).toHaveText('pending');

	await pending.getByRole('button', { name: 'Approve' }).click();
	// The e2e server runs without the updater worker, so the notice also says the refresh is pending.
	await expect(page.getByRole('status').filter({ hasText: 'Seed Shared Market is public.' })).toBeVisible();
	await expect(pending).toHaveCount(0);
	await expect(share).toHaveText('approved');

	await page.reload();
	await expect(page.locator(`[data-hub="${SHARED_HUB_ID}"]`)).toContainText('Seed Shared Market');
	await expect(share).toHaveText('approved');
});

test('accounts: a non-admin gets 404 on /admin', async ({ page }) => {
	await devLogin(page, SEED_PILOT_TWO);
	for (const path of ['/admin', '/admin/hubs']) {
		const response = await page.goto(path);
		expect(response?.status()).toBe(404);
	}
});
