import { expect, gotoHydrated, test } from './fixtures';

test('theme: dark by default, the toggle switches to light and the choice persists', async ({ page }) => {
	await gotoHydrated(page, '/');
	const html = page.locator('html');
	await expect(html).toHaveClass(/\bdark\b/);

	await page.getByRole('button', { name: 'Toggle dark mode' }).click();
	await expect(html).not.toHaveClass(/\bdark\b/);

	await page.reload();
	await expect(html).not.toHaveClass(/\bdark\b/);
	await expect(html).toHaveClass(/\blight\b/);
});
