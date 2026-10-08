import type { Page } from '@playwright/test';
import { expect, gotoHydrated, test } from './fixtures';

/** The ranked-list card under an `h3` heading (`RankedList.svelte`). */
const rankedList = (page: Page, title: string) =>
	page.getByRole('heading', { level: 3, name: title, exact: true }).locator('xpath=..');

/** A reactor board on the home page (`ReactorBoard.svelte`). */
const board = (page: Page, reactor: string) => page.locator(`[data-board="${reactor}"]`);

test('home: SEO title without em dash @smoke', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle('Home | EVE Reactions Calculator');
	expect(await page.title()).not.toContain('—');
});

test('home: a board per reactor, with listed products @smoke', async ({ page }) => {
	await page.goto('/');
	const section = page.locator('section[aria-labelledby="boards-title"]');
	for (const title of ['Composite', 'Biochemical', 'Hybrid'])
		await expect(section.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible();
	await expect(section.getByTestId('board-row').first()).toBeVisible();
});

test('home: composite board switches between buy inputs and full chain @smoke', async ({ page }) => {
	await gotoHydrated(page, '/');
	const composite = board(page, 'composite');
	const single = composite.getByRole('tab', { name: 'Buy inputs' });
	const chain = composite.getByRole('tab', { name: 'Full chain' });
	await expect(single).toHaveAttribute('aria-selected', 'true');
	await expect(composite.getByRole('tabpanel')).toBeVisible();

	await chain.click();
	await expect(chain).toHaveAttribute('aria-selected', 'true');
	await expect(single).toHaveAttribute('aria-selected', 'false');
	const first = composite.getByTestId('board-row').first().getByRole('link');
	await expect(first).toHaveAttribute('href', /view=chain/);

	await single.click();
	await expect(single).toHaveAttribute('aria-selected', 'true');
});

test('home: input price lists are shown @smoke', async ({ page }) => {
	await page.goto('/');
	for (const title of ['Rising', 'Falling']) await expect(rankedList(page, title)).toBeVisible();
});
