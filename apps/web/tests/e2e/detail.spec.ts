import { expect, gotoHydrated, test } from './fixtures';

const PATH = '/composite/titanium-carbide';

test('detail: a composite reaction page loads', async ({ page }) => {
	const response = await page.goto(PATH);
	expect(response?.status()).toBe(200);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Titanium Carbide');
	await expect(page.locator('[data-metric="Profit / slot / day"] dd')).not.toBeEmpty();
	await expect(page.locator('article[data-step]')).toHaveCount(1);
});

test('detail: the full chain view shows every chain step', async ({ page }) => {
	await gotoHydrated(page, PATH);
	await page
		.getByRole('navigation', { name: 'Calculation view' })
		.getByRole('link', { name: 'Full chain' })
		.click();
	await expect(page).toHaveURL(/[?&]view=chain\b/);
	await expect(page.getByRole('link', { name: 'Full chain' })).toHaveAttribute('aria-current', 'page');
	const steps = page.locator('article[data-step]');
	await expect(steps.first()).toBeVisible();
	expect(await steps.count()).toBeGreaterThan(1);
	await expect(page.getByRole('heading', { name: /^Step 1 of \d+ · / })).toBeVisible();
});

test('detail: price and volume history shows the charts', async ({ page }) => {
	await gotoHydrated(page, PATH);
	const history = page.locator('section#history');
	await expect(history.getByRole('heading', { name: 'Price and volume history' })).toBeVisible();
	for (const key of ['outputValue', 'volume']) {
		const figure = history.locator(`figure[data-chart="${key}"]`);
		await expect(figure).toBeVisible();
		// The chart library is loaded on the client and draws an SVG into the figure.
		await expect(figure.locator('svg').first()).toBeVisible();
	}
});
