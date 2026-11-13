import { expect, test } from './fixtures';

test('a page whose build files are gone reloads once and starts', async ({ page }) => {
	// Every request for the app entry fails during the first load, as after a deploy (old files are deleted);
	// the reload gets it.
	let documents = 0;
	page.on('request', (request) => {
		if (request.resourceType() === 'document') documents++;
	});
	await page.route('**/_app/immutable/entry/app.*.js', (route) =>
		documents === 1 ? route.fulfill({ status: 404, body: 'Not found' }) : route.continue()
	);

	await page.goto('/');
	const html = page.locator('html');
	await expect(html).toHaveAttribute('data-app-started', '');
	expect(documents).toBe(2);

	// Started: the theme toggle works.
	await expect(html).toHaveClass(/\bdark\b/);
	await page.getByRole('button', { name: 'Toggle dark mode' }).click();
	await expect(html).not.toHaveClass(/\bdark\b/);
});
