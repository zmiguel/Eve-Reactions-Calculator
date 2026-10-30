import type { Locator, Page } from '@playwright/test';
import { SEED_PILOT, devLogin, expect, test } from './fixtures';

/**
 * Inventory of the seed pilot (`SEED_INVENTORY` in `scripts/seed-local.ts`): the places on
 * `/account/inventory`, the connections (add, sync, remove) on `/account/connections`. The tests share it
 * and change it (selection, removal), so they run in order; each leaves the seeded selection as it found
 * it, and the last one removes the connections. No other spec reads the inventory. Never `@smoke`: they
 * write. No retries: a serial group retries from its first test, which would find the connections removed.
 */
test.describe.configure({ mode: 'serial', retries: 0 });

const JITA = 'Jita IV - Moon 4 - Caldari Navy Assembly Plant';
const JITA_ID = 60003760;
/** `SEED_STRUCTURE_HUBS[0]`: Seed Market, holding the Silicon Diborite. */
const SEED_MARKET_ID = 1044752365771;
const TITANIUM_CARBIDE = 'Titanium Carbide';

/** Full ISK value of a `title` such as `1,234,567.89 ISK`. */
function iskTitle(title: string | null): number {
	const value = Number((title ?? '').replace(/ ISK$/, '').replaceAll(',', ''));
	expect(Number.isFinite(value), `ISK title "${title}"`).toBe(true);
	return value;
}

const personal = (page: Page) => page.getByRole('article', { name: SEED_PILOT.name, exact: true });
const corporation = (page: Page) => page.getByRole('article', { name: 'Seed Corp', exact: true });
const place = (source: Locator, locationId: number, bucket: string) =>
	source.locator(`[data-place="${locationId}"] [data-bucket="${bucket}"]`).getByRole('checkbox');
const summaryItem = (page: Page, name: string) =>
	page
		.locator('[data-group] tbody tr')
		.filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) });
const notice = (page: Page) => page.locator('[data-notice]');
const totalValue = async (page: Page) =>
	iskTitle(await page.locator('[data-total]').locator('..').getAttribute('title'));

/** The planner's row of the final reaction in "Reactions to run". */
const planRow = (page: Page, name: string) =>
	page
		.locator('[data-results] [data-plan-reaction]')
		.filter({ has: page.locator('[data-field="name"]', { hasText: new RegExp(`^${name}$`) }) });

/** Adds `lines` lines of `product` as the first target. */
async function addTarget(page: Page, product: string, lines: number) {
	await page.getByRole('button', { name: '+ Add target' }).click();
	await page.getByLabel('Product of target 1', { exact: true }).selectOption({ label: product });
	const linesInput = page.getByLabel('Lines of target 1', { exact: true });
	await linesInput.fill(String(lines));
	await linesInput.press('Tab');
	await expect(linesInput).toHaveValue(String(lines));
}

test('inventory: an anonymous visitor is sent to log in', async ({ request }) => {
	for (const path of ['/account/inventory', '/account/connections']) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status()).toBe(303);
		expect(response.headers()['location']).toBe(
			`/auth/login?purpose=login&returnTo=${encodeURIComponent(path)}`
		);
	}
});

test('account: every account page has the tabs with the current one marked', async ({ page }) => {
	const tabs = [
		'/account',
		'/account/connections',
		'/account/inventory',
		'/account/tracking',
		'/account/structures'
	];
	await devLogin(page, SEED_PILOT, '/account');
	for (const path of tabs) {
		if (path !== '/account') await page.goto(path);
		const links = page.getByRole('navigation', { name: 'Account pages' }).getByRole('link');
		await expect(links).toHaveCount(tabs.length);
		for (const [i, href] of tabs.entries()) {
			await expect(links.nth(i)).toHaveAttribute('href', href);
			if (href === path) await expect(links.nth(i)).toHaveAttribute('aria-current', 'page');
			else await expect(links.nth(i)).not.toHaveAttribute('aria-current');
		}
	}
});

test('inventory: the page lists both connections with their places', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/account/inventory');
	await expect(personal(page)).toContainText('Personal assets');
	await expect(personal(page).locator('[data-status]')).toContainText('Up to date');
	await expect(personal(page).locator(`[data-place="${JITA_ID}"]`)).toContainText(JITA);
	await expect(personal(page).locator(`[data-place="${SEED_MARKET_ID}"]`)).toContainText('Seed Market');
	await expect(place(personal(page), JITA_ID, 'hangar')).toBeChecked();
	await expect(place(personal(page), SEED_MARKET_ID, 'hangar')).toBeChecked();
	await expect(place(personal(page), SEED_MARKET_ID, 'jobs')).not.toBeChecked();
	await expect(personal(page).locator(`[data-place="${SEED_MARKET_ID}"] [data-bucket="jobs"]`)).toContainText(
		'Industry jobs'
	);

	await expect(corporation(page)).toContainText('Corporation assets');
	await expect(corporation(page).locator(`[data-place="${JITA_ID}"]`)).toContainText(JITA);
	const moonGoo = corporation(page).locator('[data-bucket="div1"]');
	const fuel = corporation(page).locator('[data-bucket="div2"]');
	await expect(moonGoo).toContainText('Moon goo');
	await expect(fuel).toContainText('Fuel');
	await expect(moonGoo.getByRole('checkbox')).toBeChecked();
	await expect(fuel.getByRole('checkbox')).not.toBeChecked();

	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(1);
	await expect(summaryItem(page, 'Cobalt')).toHaveCount(1);
	// The formulas of the selected hangar (2), not the one in an industry job.
	await expect(page.locator('[data-group="formulas"] tbody tr')).toContainText(['Titanium Carbide']);
});

test('inventory: unticking a hangar drops its items from the summary', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/account/inventory');
	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(1);
	const before = await totalValue(page);

	await place(personal(page), SEED_MARKET_ID, 'hangar').uncheck();
	await personal(page).getByRole('button', { name: 'Save', exact: true }).click();
	await expect(notice(page)).toHaveText('Selection saved.');
	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(0);
	await expect(page.locator('[data-group="formulas"]')).toHaveCount(0);
	expect(await totalValue(page)).toBeLessThan(before);

	await page.reload();
	await expect(place(personal(page), SEED_MARKET_ID, 'hangar')).not.toBeChecked();
	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(0);

	// Back to the seeded selection for the tests after this one.
	await place(personal(page), SEED_MARKET_ID, 'hangar').check();
	await personal(page).getByRole('button', { name: 'Save', exact: true }).click();
	await expect(notice(page)).toHaveText('Selection saved.');
	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(1);
	expect(await totalValue(page)).toBe(before);
});

test('inventory: Select all and Select none round-trip', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/account/inventory');
	const corp = corporation(page);
	const moonGoo = corp.locator('[data-bucket="div1"]').getByRole('checkbox');
	const fuel = corp.locator('[data-bucket="div2"]').getByRole('checkbox');

	await corp.getByRole('button', { name: 'Select all' }).click();
	await expect(notice(page)).toHaveText('Selection saved.');
	await expect(moonGoo).toBeChecked();
	await expect(fuel).toBeChecked();

	await corp.getByRole('button', { name: 'Select none' }).click();
	await expect(moonGoo).not.toBeChecked();
	await expect(fuel).not.toBeChecked();
	await expect(summaryItem(page, 'Cobalt')).toHaveCount(0);
	// The personal source keeps its own selection.
	await expect(place(personal(page), JITA_ID, 'hangar')).toBeChecked();
	await expect(summaryItem(page, 'Silicon Diborite')).toHaveCount(1);

	await corp.getByRole('button', { name: 'Select all' }).click();
	await expect(moonGoo).toBeChecked();
	await expect(fuel).toBeChecked();
	await expect(summaryItem(page, 'Cobalt')).toHaveCount(1);

	// Back to the seeded selection: Moon goo only.
	await fuel.uncheck();
	await corp.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(notice(page)).toHaveText('Selection saved.');
	await page.reload();
	await expect(moonGoo).toBeChecked();
	await expect(fuel).not.toBeChecked();
});

test('connections: Sync now without the updater says the sync could not start', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/account/connections');
	await expect(corporation(page).locator('[data-readers]')).toContainText(SEED_PILOT.name);
	await personal(page).locator('[data-part="inventory"]').getByRole('button', { name: 'Sync now' }).click();
	await expect(notice(page)).toHaveAttribute('data-notice', 'error');
	await expect(notice(page)).toContainText('could not be started');
	await expect(personal(page).locator('[data-status]')).toContainText('Up to date');
});

test('planner: My inventory starts Titanium Carbide a cycle earlier and costs less up front', async ({
	page
}) => {
	await devLogin(page, SEED_PILOT, '/planner');
	const myInventory = page.getByRole('button', { name: 'My inventory', exact: true });
	const pasted = page.getByRole('button', { name: 'Pasted lists', exact: true });
	await expect(myInventory).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-inventory-summary]')).toContainText('Seed Corp');
	await addTarget(page, TITANIUM_CARBIDE, 2);

	const firstCycle = planRow(page, TITANIUM_CARBIDE);
	const initial = page.locator('[data-metric="Initial investment"] dd');
	await expect(firstCycle).toHaveAttribute('data-first-cycle', '1');
	const withInventory = iskTitle(await initial.getAttribute('title'));

	await pasted.click();
	await expect(pasted).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-inventory-summary]')).toHaveCount(0);
	await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('');
	await expect(firstCycle).toHaveAttribute('data-first-cycle', '2');
	const withoutInventory = iskTitle(await initial.getAttribute('title'));
	expect(withInventory).toBeLessThan(withoutInventory);

	await myInventory.click();
	await expect(firstCycle).toHaveAttribute('data-first-cycle', '1');
});

test('planner: Use what I have plans with the inventory and keeps the targets', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/planner');
	await addTarget(page, TITANIUM_CARBIDE, 2);
	await page.getByRole('button', { name: 'Use what I have', exact: true }).click();

	const results = page.locator('[data-stock-results]');
	const status = page.locator('[data-stock-status]');
	const valueAdded = results.locator('[data-metric="Value added"] dd');
	// The search runs in a Web Worker for up to its time limit (10 s by default).
	await expect(status).toBeEmpty({ timeout: 30_000 });
	await expect(valueAdded).toBeVisible();
	expect(iskTitle(await valueAdded.getAttribute('title'))).toBeGreaterThan(0);
	await expect(
		results.locator('[data-stock-job]').filter({ hasText: TITANIUM_CARBIDE }).first()
	).toBeVisible();
	// Only fuel blocks are bought: no formulas to buy, and every purchase row is a fuel block (the seeded
	// Oxygen Fuel Blocks may cover the plan, leaving none to buy).
	await expect(results.locator('[data-stock-note]')).toContainText('Nothing else is bought');
	await expect(results.locator('[data-stock-formulas]')).toHaveCount(0);
	await expect(results.locator('[data-stock-fuel]')).toBeVisible();
	for (const name of await results.locator('[data-stock-fuel] [data-type-id]').allTextContents())
		expect(name).toContain('Fuel Block');

	const cycles = page.getByLabel('Cycles', { exact: true });
	const next = (await cycles.inputValue()) === '1' ? '2' : '1';
	await cycles.fill(next);
	await expect(page.locator('output[for="planner-stock-cycles"]')).toHaveText(next);
	await expect(page.getByRole('button', { name: 'Use default' })).toBeVisible();
	await expect(status).toBeEmpty({ timeout: 30_000 });
	await expect(results).toBeVisible();
	expect(iskTitle(await valueAdded.getAttribute('title'))).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Plan targets', exact: true }).click();
	await expect(page.getByRole('list', { name: 'Targets' }).getByRole('listitem')).toHaveCount(1);
	await expect(page.getByLabel('Product of target 1', { exact: true }).locator('option:checked')).toHaveText(
		TITANIUM_CARBIDE
	);
	await expect(page.getByLabel('Lines of target 1', { exact: true })).toHaveValue('2');
	await expect(planRow(page, TITANIUM_CARBIDE)).toHaveCount(1);
});

// Last: it removes the seeded connections.
test('connections: with no connections the add select offers characters and corporations', async ({
	page
}) => {
	await devLogin(page, SEED_PILOT, '/account/connections');
	await expect(page.locator('[data-all-added]')).toBeVisible();
	for (const source of [personal(page), corporation(page)]) {
		await source.getByText('Remove…').click();
		await source.getByRole('button', { name: 'Yes, remove' }).click();
		await expect(notice(page)).toHaveText('Connection removed.');
		await expect(source).toHaveCount(0);
	}

	await page.goto('/account/inventory');
	await expect(page.locator('[data-no-connections]')).toBeVisible();
	await expect(page.locator('[data-empty="no_sources"]')).toBeVisible();
	await page.locator('[data-no-connections]').getByRole('link').click();
	await page.waitForURL('**/account/connections');
	await page.waitForLoadState('networkidle');

	const add = page.getByRole('combobox', { name: 'Connection', exact: true });
	const groups = add.locator('optgroup');
	await expect(groups).toHaveCount(2);
	await expect(groups.nth(0)).toHaveAttribute('label', 'Characters');
	await expect(groups.nth(1)).toHaveAttribute('label', 'Corporations');
	await expect(groups.nth(0).locator('option')).toHaveText([SEED_PILOT.name]);
	await expect(groups.nth(1).locator('option')).toHaveText([`Seed Corp via ${SEED_PILOT.name}`]);

	// A personal connection needs no ESI call to add; without the updater its first syncs cannot start.
	await add.selectOption({ label: SEED_PILOT.name });
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(notice(page)).toContainText('could not be started');
	await expect(personal(page).locator('[data-status]')).toContainText('Sync queued');
	await expect(personal(page).getByRole('switch', { name: 'Inventory' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});
