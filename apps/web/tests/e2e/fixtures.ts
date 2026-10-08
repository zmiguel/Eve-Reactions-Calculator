import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export { expect };

/** Seed accounts of `scripts/seed-local.ts` (`SEED_USERS`); 90000001 is the admin. */
export const SEED_PILOT = { characterId: 90000001, name: 'Seed Pilot' } as const;
export const SEED_PILOT_TWO = { characterId: 90000002, name: 'Seed Pilot Two' } as const;

/**
 * Only the site's own origin is reachable: analytics (session replay, beacons) would keep the network
 * busy, send test traffic to real dashboards and make runs depend on third parties.
 */
async function sameOriginOnly(context: BrowserContext, baseURL: string | undefined) {
	const origin = new URL(baseURL ?? 'http://localhost:8790').origin;
	await context.route(
		(url) => url.origin !== origin,
		(route) => route.abort()
	);
}

export const test = base.extend({
	context: async ({ context, baseURL }, use) => {
		await sameOriginOnly(context, baseURL);
		await use(context);
	}
});

/** A second, independent browser (own cookies), restricted like the default one. */
export async function freshContext(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
	const context = await browser.newContext({ baseURL });
	await sameOriginOnly(context, baseURL);
	return context;
}

/** Navigates and waits until the client has hydrated (scripts loaded, network quiet), so clicks are handled. */
export async function gotoHydrated(page: Page, url: string) {
	const response = await page.goto(url);
	await page.waitForLoadState('networkidle');
	return response;
}

/**
 * Logs in through `/auth/dev-login` (local/e2e server only, `DEV_LOGIN=1`) and waits until the
 * `returnTo` page has hydrated.
 */
export async function devLogin(page: Page, pilot: { characterId: number; name: string }, returnTo = '/') {
	const params = new URLSearchParams({
		characterId: String(pilot.characterId),
		name: pilot.name,
		returnTo
	});
	const response = await page.goto(`/auth/dev-login?${params}`);
	expect(response?.ok()).toBe(true);
	await page.waitForURL((url) => url.pathname + url.search === returnTo);
	await page.waitForLoadState('networkidle');
}
