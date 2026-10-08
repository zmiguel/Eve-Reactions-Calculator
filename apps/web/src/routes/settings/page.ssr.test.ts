import { DEFAULT_SETTINGS, Settings, encodeSettings } from '@reactions/engine';
import type { RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv } from '../../test/fakes';
import { NOW, insertSystems, insertUser } from '../../test/fixtures';
import { resetPage, setPage } from '../../test/shims/app/state';
import { load } from './+page.server';
import Page from './+page.svelte';

beforeEach(() => {
	clearDataMemo();
	resetPage();
});

async function ssr(
	path: string,
	opts: { settings?: Settings; user?: SessionUser; form?: Record<string, unknown> | null } = {}
) {
	const env = fakeEnv();
	insertSystems(env.DB);
	insertUser(env.DB, { userId: 'u1' });
	env.DB.sqlite.exec(`UPDATE users SET settings_updated_at = ${NOW}`);
	const url = new URL(`https://reactions.coalition.space${path}`);
	setPage({ url });
	const data = await load({
		url,
		platform: { env },
		cookies: new FakeCookies().asCookies(),
		locals: { settings: opts.settings ?? DEFAULT_SETTINGS, user: opts.user ?? null, theme: 'dark' }
	} as unknown as RequestEvent as never);
	const { head, body } = render(Page, { props: { data, form: opts.form ?? null, params: {} } as never });
	return { head, body };
}

const count = (body: string, needle: string) => body.split(needle).length - 1;

describe('/settings (server-rendered)', () => {
	it('is noindex, follow and states cookie storage for anonymous visitors', async () => {
		const { head, body } = await ssr('/settings');
		expect(head).toContain('<meta name="robots" content="noindex, follow"');
		expect(head).toContain('<link rel="canonical" href="https://reactions.coalition.space/settings"');
		expect(body).toContain('Saved in this browser (cookie)');
		expect(body).toContain('log in with EVE Online</a> to sync them across devices');
		expect(body).not.toContain('Synced to your account');
		expect(body).toContain('href="/auth/login?purpose=login&amp;returnTo=%2Fsettings"');
	});

	it('shows account sync with the last save time when logged in', async () => {
		const { body } = await ssr('/settings', {
			user: { userId: 'u1', characterId: null, characters: [], isAdmin: false }
		});
		expect(body).toContain('Synced to your account');
		expect(body).toContain('last saved 2026-10-06 12:00 UTC');
	});

	it('renders a no-JS form: POST ?/save, all shared fields, contract basis and shipping inputs enabled', async () => {
		const { body } = await ssr('/settings');
		expect(body).toMatch(/<form[^>]*method="POST"[^>]*action="\?\/save"/);
		for (const name of [
			'mode',
			'editing',
			'cycleDays',
			'slotAllocation',
			'maxParallelLines',
			'reprocessing.prismaticiteRollPct',
			'shared.structure',
			'shared.systemId',
			'shared.system',
			'shared.costIndexOverridePct',
			'shared.market.inputContractBasis',
			'shared.market.brokerFeePct',
			'shared.shipping.output.enabled',
			'shared.shipping.output.collateralPct',
			'shared.shipping.output.discountPct'
		])
			expect(body).toContain(`name="${name}"`);
		expect(body).not.toMatch(/name="shared\.shipping\.input\.iskPerM3"[^>]*disabled=""/);
		expect(body).toContain('ME ×0.9760');
		expect(body).toMatch(/<input type="radio" checked="" value="single" name="slotAllocation"/);
		expect(body).toMatch(/<input type="radio" value="optimal" name="slotAllocation"/);
		expect(body).toContain('Chain slot allocation');
	});

	it('renders all three reactor profiles behind CSS tabs in per-reactor mode', async () => {
		const { body } = await ssr('/settings', { settings: Settings.parse({ mode: 'per_reactor' }) });
		expect(count(body, 'data-panel=')).toBe(3);
		expect(body).toContain('name="reactors.hybrid.structure"');
		expect(body).not.toContain('name="shared.structure"');
		expect(body).toMatch(/<input type="radio" name="_tab" value="composite"[^>]*checked/);
	});

	it('shows the import preview with the differences and an apply form', async () => {
		const imported = Settings.parse({
			shared: { structure: 'athanor' },
			cycleDays: 3,
			slotAllocation: 'optimal'
		});
		const { body } = await ssr(`/settings?import=${await encodeSettings(imported)}`);
		const text = body.replace(/\s+/g, ' ');
		expect(text).toContain('3 settings differ from yours');
		expect(count(body, 'data-change=')).toBe(3);
		expect(text).toContain('Chain slot allocation');
		expect(text).toContain('Optimal slots');
		expect(body).toMatch(/<form[^>]*action="\?\/import"/);
		expect(body).toContain('Apply these settings');
		expect(body).toContain(`name="code" value="${await encodeSettings(imported)}"`);
	});

	it('shows an invalid-import notice and the share link of the current settings', async () => {
		const { body } = await ssr('/settings?import=garbage');
		expect(body).toContain('This share link is not valid');
		expect(body).not.toContain('Apply these settings');
		expect(body).toContain(
			`value="https://reactions.coalition.space/settings?import=${await encodeSettings(DEFAULT_SETTINGS)}"`
		);
	});

	it('shows the saved notice and failed-save field errors', async () => {
		expect((await ssr('/settings?notice=saved')).body).toContain('Settings saved.');
		const values = Settings.parse({});
		values.shared.sccPct = 30;
		const { body } = await ssr('/settings', {
			form: { errors: { 'shared.sccPct': 'Must be at most 20' }, values, systemText: {} }
		});
		expect(body).toContain('Must be at most 20');
		expect(body).toMatch(/name="shared\.sccPct"[^>]*value="30"|value="30"[^>]*name="shared\.sccPct"/);
	});
});
