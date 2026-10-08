import { DEFAULT_SETTINGS } from '@reactions/engine';
import { STRUCTURE_SCOPES } from '@reactions/eve';
import { isActionFailure, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { render } from 'svelte/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/server/session';
import { FakeCookies, fakeEnv, type FakeEnv } from '../../../test/fakes';
import {
	NOW,
	insertLatestPrice,
	insertStructureHub,
	insertUser,
	linkStructure
} from '../../../test/fixtures';
import { resetPage, setPage } from '../../../test/shims/app/state';
import { sessionUser } from '../../../test/sso';
import { actions, load } from './+page.server';
import Page from './+page.svelte';
import type { PageServerData } from './$types';

const admin = sessionUser('admin-account', [{ characterId: 90000009, name: 'Admin' }], true);
const pilot = sessionUser('account-two', [{ characterId: 90000002, name: 'Pilot' }]);
const PENDING = 1042508032148;
const PRIVATE = 1044752365771;

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	resetPage();
});

function seeded(
	UPDATER: unknown = { publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: 1, hubIds: [] })) }
) {
	const env = fakeEnv({ UPDATER, ADMIN_CHARACTER_IDS: '90000009' });
	insertUser(env.DB, { userId: 'account-one' }, [{ characterId: 90000001, name: 'Seed Pilot' }]);
	insertUser(env.DB, { userId: 'account-two' }, [{ characterId: 90000002, name: 'Pilot' }]);
	env.DB.sqlite.exec(
		`UPDATE characters SET scopes = '${STRUCTURE_SCOPES.join(' ')}', refresh_token_enc = 'secret-token-value', token_status = 'ok', owner_hash = 'owner-hash-value'`
	);
	insertStructureHub(env.DB, { structureId: PENDING, name: 'Shared Market', shareStatus: 'pending' });
	insertStructureHub(env.DB, { structureId: PRIVATE, name: 'Seed Market' });
	linkStructure(env.DB, 'account-two', PENDING, 90000002, true);
	linkStructure(env.DB, 'account-one', PENDING, 90000001);
	linkStructure(env.DB, 'account-one', PRIVATE, 90000001);
	return env;
}

function event(env: FakeEnv, user: SessionUser | null, path = '/admin/hubs', hubId?: string) {
	const url = new URL(`https://reactions.coalition.space${path}`);
	const body = new FormData();
	if (hubId) body.set('hubId', hubId);
	return {
		url,
		request: new Request(url, { method: 'POST', body }),
		cookies: new FakeCookies().asCookies(),
		platform: { env },
		locals: { user, settings: DEFAULT_SETTINGS, theme: 'dark' }
	} as unknown as RequestEvent as never;
}

async function status(promise: unknown) {
	try {
		await promise;
		return 200;
	} catch (e) {
		if (isHttpError(e)) return e.status;
		throw e;
	}
}

const hub = (env: FakeEnv, hubId: string) =>
	env.DB.rows(
		'SELECT visibility, share_status, share_reviewed_by, share_reviewed_at, enabled, sort_order FROM market_hubs WHERE hub_id = ?',
		hubId
	)[0];

const act = (name: keyof typeof actions, env: FakeEnv, hubId: string, user: SessionUser = admin) =>
	actions[name](event(env, user, `/admin/hubs?/${name}`, hubId));

describe('/admin/hubs', () => {
	it('is a 404 for anonymous visitors and non-admins (page and actions)', async () => {
		for (const user of [null, pilot]) {
			expect(await status(load(event(seeded(), user)))).toBe(404);
			for (const name of Object.keys(actions) as (keyof typeof actions)[]) {
				expect(await status(actions[name](event(seeded(), user, `/admin/hubs?/${name}`, 'jita')))).toBe(404);
			}
		}
	});

	it('lists every hub with contributor names, public ones first in published order', async () => {
		const data = (await load(event(seeded(), admin))) as PageServerData;
		expect(data.hubs.map((h) => h.hubId)).toEqual([
			'jita',
			'amarr',
			'perimeter',
			'dodixie',
			'rens',
			'hek',
			`structure-${PRIVATE}`,
			`structure-${PENDING}`
		]);
		expect(data.hubs.find((h) => h.hubId === `structure-${PENDING}`)).toEqual({
			hubId: `structure-${PENDING}`,
			name: 'Shared Market',
			kind: 'structure',
			visibility: 'private',
			shareStatus: 'pending',
			enabled: true,
			sortOrder: 100,
			systemName: null,
			lastSuccessAt: null,
			lastError: null,
			contributors: ['Pilot', 'Seed Pilot']
		});
		expect(data.hubs[0]!.contributors).toEqual([]);
	});

	it('renders noindex, the pending queue and never token data or account ids', async () => {
		const env = seeded();
		const data = (await load(event(env, admin))) as PageServerData;
		setPage({ url: 'https://reactions.coalition.space/admin/hubs' });
		const { head, body } = render(Page, { props: { data, form: null, params: {} } as never });
		expect(head).toContain('<meta name="robots" content="noindex"');
		expect(body).toContain(`data-pending="structure-${PENDING}"`);
		expect(body).toContain('action="?/approve"');
		for (const secret of [
			'secret-token-value',
			'owner-hash-value',
			'account-one',
			'account-two',
			'admin-account',
			'esi-markets',
			'90000001'
		]) {
			expect(JSON.stringify(data)).not.toContain(secret);
			expect(body).not.toContain(secret);
		}
	});

	it('approve makes a pending hub public, records the reviewer and republishes market:v1', async () => {
		const UPDATER = { publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: 1, hubIds: [] })) };
		const env = seeded(UPDATER);
		expect(await act('approve', env, `structure-${PENDING}`)).toEqual({
			notice: { ok: true, text: 'Shared Market is public.' }
		});
		expect(hub(env, `structure-${PENDING}`)).toMatchObject({
			visibility: 'public',
			share_status: 'approved',
			share_reviewed_by: 90000009,
			share_reviewed_at: NOW
		});
		expect(UPDATER.publishMarketSnapshot).toHaveBeenCalledTimes(1);
		const again: unknown = await act('approve', env, `structure-${PENDING}`);
		expect(isActionFailure(again)).toBe(true);
	});

	it('reject keeps the hub private; revoke turns a public structure hub private and rejected', async () => {
		const env = seeded();
		await act('reject', env, `structure-${PENDING}`);
		expect(hub(env, `structure-${PENDING}`)).toMatchObject({
			visibility: 'private',
			share_status: 'rejected'
		});
		expect(isActionFailure(await act('reject', env, `structure-${PRIVATE}`))).toBe(true);

		env.DB.sqlite.exec(
			`UPDATE market_hubs SET visibility = 'public', share_status = 'approved' WHERE hub_id = 'structure-${PENDING}'`
		);
		expect(await act('revoke', env, `structure-${PENDING}`)).toMatchObject({ notice: { ok: true } });
		expect(hub(env, `structure-${PENDING}`)).toMatchObject({
			visibility: 'private',
			share_status: 'rejected'
		});
	});

	it('NPC hubs cannot be revoked', async () => {
		const env = seeded();
		const result: unknown = await act('revoke', env, 'jita');
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({ status: 400, data: { notice: { text: 'NPC hubs cannot be revoked.' } } });
		expect(hub(env, 'jita')).toMatchObject({ visibility: 'public', enabled: 1 });
	});

	it('enables, disables and reorders public hubs only', async () => {
		const env = seeded();
		await act('disable', env, 'amarr');
		expect(hub(env, 'amarr')).toMatchObject({ enabled: 0 });
		await act('enable', env, 'amarr');
		expect(hub(env, 'amarr')).toMatchObject({ enabled: 1 });

		await act('up', env, 'perimeter');
		await act('down', env, 'jita');
		const order = env.DB.rows<{ hub_id: string }>(
			"SELECT hub_id FROM market_hubs WHERE visibility = 'public' ORDER BY sort_order"
		).map((h) => h.hub_id);
		expect(order).toEqual(['perimeter', 'jita', 'amarr', 'dodixie', 'rens', 'hek']);
		expect(await act('up', env, 'perimeter')).toMatchObject({
			notice: { text: 'Perimeter is already first.' }
		});

		for (const name of ['disable', 'up'] as const) {
			expect(isActionFailure(await act(name, env, `structure-${PRIVATE}`))).toBe(true);
		}
		expect(hub(env, `structure-${PRIVATE}`)).toMatchObject({ enabled: 1, sort_order: 100 });
	});

	it('an unreachable updater still saves and says the change shows after the next price refresh', async () => {
		const UPDATER = {
			publishMarketSnapshot: vi.fn(async () => {
				throw new Error('connection refused');
			})
		};
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = seeded(UPDATER);
		const result = await act('disable', env, 'hek');
		expect(result).toMatchObject({
			notice: { ok: false, text: expect.stringContaining('next price refresh') }
		});
		expect(hub(env, 'hek')).toMatchObject({ enabled: 0 });
	});

	describe('delete', () => {
		const withPrices = (env: FakeEnv) => {
			for (const hubId of [`structure-${PENDING}`, `structure-${PRIVATE}`, 'jita']) {
				insertLatestPrice(env.DB, hubId, 34, 4, 5);
				env.HISTORY_DB.sqlite.exec(`
					INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, source)
						VALUES (${NOW}, '${hubId}', 34, 4, 5, 1, 1, 'esi');
					INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples)
						VALUES ('2026-10-05', '${hubId}', 34, 4, 5, 4);
				`);
			}
			return env;
		};
		const left = (env: FakeEnv) => ({
			hubs: env.DB.rows<{ hub_id: string }>(
				"SELECT hub_id FROM market_hubs WHERE kind = 'structure' ORDER BY hub_id"
			).map((r) => r.hub_id),
			links: env.DB.rows('SELECT DISTINCT structure_id FROM structure_links ORDER BY structure_id'),
			latest: env.DB.rows('SELECT hub_id FROM latest_prices ORDER BY hub_id'),
			snapshots: env.HISTORY_DB.rows('SELECT hub_id FROM price_snapshots ORDER BY hub_id'),
			daily: env.HISTORY_DB.rows('SELECT hub_id FROM price_daily ORDER BY hub_id')
		});

		it('removes a private hub with its links, latest prices and history without republishing', async () => {
			const UPDATER = { publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: 1, hubIds: [] })) };
			const env = withPrices(seeded(UPDATER));
			expect(await act('delete', env, `structure-${PENDING}`)).toEqual({
				notice: { ok: true, text: 'Shared Market deleted.' }
			});
			const keep = `structure-${PRIVATE}`;
			expect(left(env)).toEqual({
				hubs: [keep],
				links: [{ structure_id: PRIVATE }],
				latest: [{ hub_id: 'jita' }, { hub_id: keep }],
				snapshots: [{ hub_id: 'jita' }, { hub_id: keep }],
				daily: [{ hub_id: 'jita' }, { hub_id: keep }]
			});
			expect(UPDATER.publishMarketSnapshot).not.toHaveBeenCalled();
			expect(await act('delete', env, `structure-${PENDING}`)).toMatchObject({
				status: 404,
				data: { notice: { text: 'Unknown hub.' } }
			});
		});

		it('republishes market:v1 after deleting a public hub, or says when the updater did not answer', async () => {
			const UPDATER = { publishMarketSnapshot: vi.fn(async () => ({ snapshotAt: 1, hubIds: [] })) };
			const env = seeded(UPDATER);
			env.DB.sqlite.exec(
				`UPDATE market_hubs SET visibility = 'public', share_status = 'approved' WHERE kind = 'structure'`
			);
			expect(await act('delete', env, `structure-${PENDING}`)).toEqual({
				notice: { ok: true, text: 'Shared Market deleted.' }
			});
			expect(UPDATER.publishMarketSnapshot).toHaveBeenCalledTimes(1);

			UPDATER.publishMarketSnapshot.mockRejectedValueOnce(new Error('connection refused'));
			vi.spyOn(console, 'error').mockImplementation(() => {});
			expect(await act('delete', env, `structure-${PRIVATE}`)).toMatchObject({
				notice: { ok: false, text: expect.stringMatching(/^Seed Market deleted\. .*next price refresh/) }
			});
			expect(left(env).hubs).toEqual([]);
		});

		it('refuses NPC hubs', async () => {
			const env = withPrices(seeded());
			const result: unknown = await act('delete', env, 'jita');
			expect(result).toMatchObject({
				status: 400,
				data: { notice: { text: 'NPC hubs cannot be deleted.' } }
			});
			expect(hub(env, 'jita')).toMatchObject({ visibility: 'public', enabled: 1 });
			expect(left(env).latest).toContainEqual({ hub_id: 'jita' });
		});
	});
});
