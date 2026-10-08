import { expect, test } from './fixtures';

/**
 * Every reaction appears once, in its tier section, on its reactor page. The expected count comes from
 * the same server's API, so the check holds for the seeded fixture and for production after SDE updates.
 */
const REACTORS = [
	{ reactor: 'composite', heading: 'Composite Reactions' },
	{ reactor: 'biochemical', heading: 'Biochemical Reactions' },
	{ reactor: 'hybrid', heading: 'Hybrid Reactions' }
] as const;

for (const { reactor, heading } of REACTORS) {
	test(`/${reactor} lists every ${reactor} reaction of /api/v2/reactions @smoke`, async ({
		page,
		request
	}) => {
		const response = await request.get(`/api/v2/reactions?reactor=${reactor}`);
		expect(response.ok()).toBe(true);
		const count = ((await response.json()) as unknown[]).length;
		expect(count).toBeGreaterThan(0);

		await page.goto(`/${reactor}`);
		await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
		await expect(page.getByTestId('reaction-row')).toHaveCount(count);
	});
}
