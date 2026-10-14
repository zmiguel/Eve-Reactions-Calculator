import type { Page } from '@playwright/test';
import { SEED_PILOT, devLogin, expect, test } from './fixtures';

/**
 * Profits pages and Profit tracking settings of the seed pilot (`SEED_TRACKING` in
 * `scripts/seed-local.ts`: three finished reaction jobs, trades, contracts, one purchase entered by hand,
 * plus the e2e server's running jobs, `E2E_RUNNING_JOBS` in `scripts/e2e-server.ts`).
 *
 * This file must run before `inventory.spec.ts`, whose last test removes the seeded connections and with
 * them Profit tracking (Playwright runs the files in name order). The tests run in order: the read-only
 * ones first, then those that write (each undoes its change where the page allows it). Never `@smoke`.
 */
test.describe.configure({ mode: 'serial', retries: 0 });

/** `SEED_TRACKING.jobs` and the e2e server's running jobs (job ids from 610000101). */
const FINISHED_JOBS = 3;
const RUNNING_JOBS = 8;
const TITANIUM_CARBIDE_JOB = 610000003;
/** `SEED_FACILITIES.unknown`: the structure EVE refused to tell. */
const UNKNOWN_FACILITY = 1045000000003;
/** Pager page size of every profits table (`PAGE_SIZE` in `$lib/paging`). */
const PAGE_SIZE = 10;

const jobRows = (page: Page) => page.getByRole('table', { name: 'Jobs', exact: true }).locator('tbody tr');
const jobLinks = (page: Page) =>
	page.getByRole('table', { name: 'Jobs', exact: true }).locator('tbody a[href^="/profits/jobs/"]');

/** Ids of the jobs the table shows, from the row links. */
async function shownJobIds(page: Page): Promise<number[]> {
	const hrefs = await jobLinks(page).evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
	return hrefs.map((href) => Number(href.split('/').pop()));
}

test('profits: an anonymous visitor sees the login gate and is sent to log in from the settings', async ({
	page,
	request
}) => {
	for (const path of ['/profits', '/profits/jobs', '/profits/ledger']) {
		await page.goto(path);
		const gate = page.locator('[data-profits-gate="login"]');
		await expect(gate).toBeVisible();
		await expect(gate.getByRole('link')).toHaveAttribute(
			'href',
			`/auth/login?purpose=login&returnTo=${encodeURIComponent(path)}`
		);
		await expect(page.getByRole('navigation', { name: 'Profits pages' })).toHaveCount(0);
	}

	const response = await request.get('/account/tracking', { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	expect(response.headers()['location']).toBe('/auth/login?purpose=login&returnTo=%2Faccount%2Ftracking');
});

test('profits: the overview shows the KPI cards and the period switch updates the URL', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/profits');
	for (const kpi of ['realized', 'expected', 'sales', 'spent', 'per-slot-day', 'unsold'])
		await expect(page.locator(`[data-kpi="${kpi}"]`)).toBeVisible();
	await expect(page.locator('[data-kpi="per-slot-day"]')).toContainText('Profit / slot / day');

	const periods = page.getByRole('navigation', { name: 'Period', exact: true });
	await expect(periods.locator('[aria-current="page"]')).toHaveAttribute('data-period', '30');
	await periods.locator('[data-period="7"]').click();
	await expect(page).toHaveURL(/\/profits\?period=7$/);
	await expect(periods.locator('[aria-current="page"]')).toHaveAttribute('data-period', '7');
	await expect(page.locator('[data-kpi="per-slot-day"]')).toBeVisible();

	await periods.locator('[data-period="all"]').click();
	await expect(page).toHaveURL(/\/profits\?period=all$/);
	await expect(periods.locator('[aria-current="page"]')).toHaveAttribute('data-period', 'all');

	await periods.locator('[data-period="30"]').click();
	await expect(page).toHaveURL(/\/profits$/);
	await expect(periods.locator('[aria-current="page"]')).toHaveAttribute('data-period', '30');
});

test('profits: the jobs list filters by status and pages in place', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/profits/jobs');
	const total = FINISHED_JOBS + RUNNING_JOBS;
	await expect(jobRows(page)).toHaveCount(PAGE_SIZE);

	await page.locator('[data-status-option="running"]').click();
	await expect(page).toHaveURL(/[?&]status=running\b/);
	await expect(jobRows(page)).toHaveCount(RUNNING_JOBS);
	for (const id of await shownJobIds(page)) expect(id).toBeGreaterThan(TITANIUM_CARBIDE_JOB);

	await page.locator('[data-status-option="finished"]').click();
	await expect(page).toHaveURL(/[?&]status=finished\b/);
	await expect(jobRows(page)).toHaveCount(FINISHED_JOBS);
	expect(await shownJobIds(page)).toContain(TITANIUM_CARBIDE_JOB);

	await page.locator('[data-status-option="all"]').click();
	await expect(page).toHaveURL(/\/profits\/jobs$/);
	await expect(jobRows(page)).toHaveCount(PAGE_SIZE);
	const firstPage = await shownJobIds(page);

	const pager = page.getByRole('navigation', { name: 'Jobs pages', exact: true });
	// Marks the document: a full page load would drop the mark.
	const marked = () => page.evaluate(() => document.documentElement.hasAttribute('data-e2e-mark'));
	await page.evaluate(() => document.documentElement.setAttribute('data-e2e-mark', ''));
	await pager.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page).toHaveURL(/[?&]page=2\b/);
	await expect(jobRows(page)).toHaveCount(total - PAGE_SIZE);
	const secondPage = await shownJobIds(page);
	expect(secondPage.filter((id) => firstPage.includes(id))).toEqual([]);
	expect(await marked()).toBe(true);

	await pager.getByRole('link', { name: 'Previous', exact: true }).click();
	await expect(page).not.toHaveURL(/[?&]page=/);
	await expect(jobRows(page)).toHaveCount(PAGE_SIZE);
	expect(await shownJobIds(page)).toEqual(firstPage);
	expect(await marked()).toBe(true);

	// The URL of page 2 opens page 2 on its own.
	await page.goto('/profits/jobs?page=2');
	expect(await shownJobIds(page)).toEqual(secondPage);
});

test('profits: a job page shows its inputs, output and material bonus', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/profits/jobs?status=finished');
	await jobLinks(page)
		.and(page.locator(`[href="/profits/jobs/${TITANIUM_CARBIDE_JOB}"]`))
		.click();
	await expect(page).toHaveURL(new RegExp(`/profits/jobs/${TITANIUM_CARBIDE_JOB}$`));

	const inputs = page.locator('[data-inputs]');
	await expect(inputs.locator('[data-material-bonus]')).toContainText('Material bonus');
	await expect(inputs.locator('[data-input]')).toHaveCount(3);
	for (const name of ['Titanium Chromide', 'Silicon Diborite', 'Oxygen Fuel Block'])
		await expect(inputs.getByRole('link', { name, exact: true })).toBeVisible();

	const output = page.locator('[data-output]');
	await expect(output.getByRole('link', { name: 'Titanium Carbide', exact: true })).toBeVisible();
	await expect(output.getByRole('table', { name: 'Sales of Titanium Carbide' })).toBeVisible();
});

test('connections: Profit tracking shows its switch and the state of every stream', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/account/connections');
	const pilot = page.getByRole('region', { name: `Profit tracking of ${SEED_PILOT.name}`, exact: true });
	await expect(pilot.getByRole('switch', { name: 'Profit tracking' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(pilot.getByRole('listitem')).toHaveCount(6);
	const corp = page.getByRole('region', { name: 'Profit tracking of Seed Corp', exact: true });
	await expect(corp.getByRole('switch', { name: 'Profit tracking' })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await expect(corp.getByRole('listitem')).toHaveCount(0);
});

test('ledger: a price correction is saved, shown and undone', async ({ page }) => {
	await devLogin(page, SEED_PILOT, '/profits/ledger');
	const row = () =>
		page
			.getByRole('table', { name: 'Ledger', exact: true })
			.getByRole('row')
			.filter({ has: page.getByRole('link', { name: 'Silicon Diborite', exact: true }) })
			.filter({ has: page.locator('[data-correct]') });
	await expect(row()).toHaveCount(1);
	await expect(row().locator('[data-correction]')).toHaveCount(0);

	// A value no other test uses, different on every run, so a stale correction cannot pass by accident;
	// full ISK amounts always show two decimals.
	const price = String(100 + Math.floor(Math.random() * 900));
	await row().locator('[data-correct] summary').click();
	await row().getByLabel('Unit price (ISK)').fill(price);
	await row().getByRole('button', { name: 'Save', exact: true }).click();
	const shown = `${price}.00 ISK`;
	await expect(row().locator('[data-correction]')).toContainText(shown);

	await page.reload();
	await expect(row().locator('[data-correction]')).toContainText(shown);

	await row().getByRole('button', { name: 'Undo correction', exact: true }).click();
	await expect(row().locator('[data-correction]')).toHaveCount(0);
	await page.reload();
	await expect(row().locator('[data-correction]')).toHaveCount(0);
});

test('ledger: a purchase is added, listed and deleted; the import check reports a bad line', async ({
	page
}) => {
	await devLogin(page, SEED_PILOT, '/profits/ledger/add');
	const purchases = page.getByRole('table', { name: 'Your purchases', exact: true });
	const before = await purchases.locator('tbody tr').count();
	const note = `e2e ${Date.now()}`;
	const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
	const added = () => purchases.locator('tbody tr').filter({ hasText: note });

	const one = page.locator('[data-add-form]');
	await one.getByRole('combobox', { name: 'Item' }).fill('Titanium Chro');
	await page.getByRole('option', { name: /^Titanium Chromide\b/ }).click();
	await expect(one.getByRole('combobox', { name: 'Item' })).toHaveValue('Titanium Chromide');
	await one.getByLabel('Date (UTC)').fill(twoDaysAgo);
	await one.getByLabel('Quantity').fill('123');
	await one.getByLabel('Unit price (ISK)').fill('2500');
	await one.getByLabel('Note (optional)').fill(note);
	await one.getByRole('button', { name: '+ Add' }).click();

	await expect(added()).toHaveCount(1);
	await expect(added().getByRole('link', { name: 'Titanium Chromide', exact: true })).toBeVisible();
	await expect(added()).toContainText('123');
	await expect(purchases.locator('tbody tr')).toHaveCount(before + 1);

	await added().getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(added()).toHaveCount(0);
	await expect(purchases.locator('tbody tr')).toHaveCount(before);
	// Hydrated before typing: hydration would reset the import text.
	await page.reload({ waitUntil: 'networkidle' });
	await expect(purchases.locator('tbody tr')).toHaveCount(before);

	const importer = page.locator('[data-import]');
	await importer
		.getByLabel('Purchases, one per line')
		.fill(`${twoDaysAgo} Titanium Chromide 100 2500\nnot a purchase`);
	await importer.getByRole('button', { name: 'Check', exact: true }).click();
	await expect(importer.locator('[data-preview-errors] [data-error-line="2"]')).toBeVisible();
	await expect(importer.locator('[data-preview-row="1"]')).toBeVisible();
	await expect(importer.locator('[data-preview-row="2"]')).toHaveCount(0);
	// Checking adds nothing.
	await expect(purchases.locator('tbody tr')).toHaveCount(before);
});

test('tracking settings: a structure and rig picked for a facility give it a material bonus', async ({
	page
}) => {
	await devLogin(page, SEED_PILOT, '/account/tracking');
	const save = page.locator('[data-form="facilities"]').getByRole('button', { name: 'Save', exact: true });
	const facility = page.locator(`[data-facility="${UNKNOWN_FACILITY}"]`);
	await expect(facility.locator('[data-needs-input]')).toBeVisible();
	await expect(facility.locator('[data-reaction-profile]')).toBeVisible();

	await facility.getByLabel('Structure').selectOption({ label: 'Tatara' });
	await facility.getByLabel('Rig 1').selectOption({ label: 'Standup L-Set Reactor Efficiency II' });
	await save.click();
	await expect(page.locator('[data-facilities] [data-notice="ok"]')).toBeVisible();

	await page.reload();
	await expect(facility.getByLabel('Structure').locator('option:checked')).toHaveText('Tatara');
	await expect(facility.getByLabel('Rig 1').locator('option:checked')).toHaveText(
		'Standup L-Set Reactor Efficiency II'
	);
	await expect(facility.locator('[data-reaction-profile]')).toHaveCount(0);
	await expect(facility.locator('[data-bonus] li')).toContainText([/fewer materials/]);

	// Back to what EVE told: the structure is not set and the reactor settings apply again.
	await facility.getByLabel('Structure').selectOption({ value: '' });
	await save.click();
	await expect(page.locator('[data-facilities] [data-notice="ok"]')).toBeVisible();
	await page.reload();
	await expect(facility.locator('[data-reaction-profile]')).toBeVisible();
	await expect(facility.getByLabel('Rig 1')).toHaveCount(0);
});
