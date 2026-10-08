import { expect, test } from './fixtures';

test('footer shows the store code and the CCP/Fenris notice @smoke', async ({ page }) => {
	await page.goto('/');
	const footer = page.getByRole('contentinfo');
	await expect(footer).toContainText('oxed');
	await expect(footer).toContainText('Fenris Creations');
});

test('external links open in a new tab and keep the referrer @smoke', async ({ page }) => {
	for (const path of ['/', '/composite', '/about', '/settings', '/planner']) {
		await page.goto(path);
		const links = await page.locator('a[href^="http"]').evaluateAll((anchors) =>
			anchors
				.filter((a) => new URL((a as HTMLAnchorElement).href).origin !== location.origin)
				.map((a) => ({
					href: a.getAttribute('href'),
					target: a.getAttribute('target'),
					rel: a.getAttribute('rel')
				}))
		);
		expect(links.length, path).toBeGreaterThan(0);
		for (const link of links) {
			expect(link.target, `${path} ${link.href}`).toBe('_blank');
			expect(link.rel ?? '', `${path} ${link.href}`).not.toContain('noreferrer');
		}
	}
});
