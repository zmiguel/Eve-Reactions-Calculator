import { STRUCTURE_SCOPES } from '@reactions/eve';
import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { NOW, insertLatestPrice, insertStructureHub, insertUser, linkStructure } from '../../test/fixtures';
import {
	NO_CONTRIBUTOR,
	canUseStructures,
	cleanupStructureHub,
	releaseStructureHubs,
	removeStructureLink,
	setStructureSharing
} from './structures';

const HUB = 'structure-1001';

function twoUsers() {
	const env = fakeEnv();
	insertUser(env.DB, { userId: 'u1' }, [{ characterId: 1, name: 'Alpha' }]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 2, name: 'Beta' }]);
	return env;
}

const hub = (env: FakeEnv) =>
	env.DB.rows(
		'SELECT visibility, share_status, enabled, last_error FROM market_hubs WHERE hub_id = ?',
		HUB
	)[0];

function withHistory(env: FakeEnv) {
	insertLatestPrice(env.DB, HUB, 34, 4, 5);
	insertLatestPrice(env.DB, 'jita', 34, 4, 5);
	env.HISTORY_DB.sqlite.exec(`
		INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_volume, sell_volume, source)
			VALUES (${NOW}, '${HUB}', 34, 4, 5, 1, 1, 'esi_structure'), (${NOW}, 'jita', 34, 4, 5, 1, 1, 'esi');
		INSERT INTO price_daily (date, hub_id, type_id, buy_avg, sell_avg, samples)
			VALUES ('2026-10-05', '${HUB}', 34, 4, 5, 4), ('2026-10-05', 'jita', 34, 4, 5, 4);
	`);
}

describe('canUseStructures', () => {
	it('needs a working token with every structure scope', () => {
		const scopes = STRUCTURE_SCOPES.join(' ');
		expect(canUseStructures({ scopes, tokenStatus: 'ok' })).toBe(true);
		expect(canUseStructures({ scopes, tokenStatus: 'invalid' })).toBe(false);
		expect(canUseStructures({ scopes: STRUCTURE_SCOPES.slice(0, 2).join(' '), tokenStatus: 'ok' })).toBe(
			false
		);
	});
});

describe('cleanupStructureHub', () => {
	it('deletes a private hub without links, its latest prices and its history rows', async () => {
		const env = fakeEnv();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		withHistory(env);
		expect(await cleanupStructureHub(asEnv(env), 1001)).toBe('deleted');
		expect(hub(env)).toBeUndefined();
		expect(env.DB.rows('SELECT hub_id FROM latest_prices')).toEqual([{ hub_id: 'jita' }]);
		expect(env.HISTORY_DB.rows('SELECT hub_id FROM price_snapshots')).toEqual([{ hub_id: 'jita' }]);
		expect(env.HISTORY_DB.rows('SELECT hub_id FROM price_daily')).toEqual([{ hub_id: 'jita' }]);
	});

	it('disables a public hub without links and keeps its data', async () => {
		const env = fakeEnv();
		insertStructureHub(env.DB, {
			structureId: 1001,
			name: 'Market',
			visibility: 'public',
			shareStatus: 'approved'
		});
		withHistory(env);
		expect(await cleanupStructureHub(asEnv(env), 1001)).toBe('disabled');
		expect(hub(env)).toEqual({
			visibility: 'public',
			share_status: 'approved',
			enabled: 0,
			last_error: NO_CONTRIBUTOR
		});
		expect(env.DB.rows('SELECT hub_id FROM latest_prices WHERE hub_id = ?', HUB)).toHaveLength(1);
	});

	it('links left but nobody sharing → private and unshared; a sharer keeps it as is', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, {
			structureId: 1001,
			name: 'Market',
			visibility: 'public',
			shareStatus: 'approved'
		});
		linkStructure(env.DB, 'u1', 1001, 1, true);
		expect(await cleanupStructureHub(asEnv(env), 1001)).toBe('shared');
		expect(hub(env)).toMatchObject({ visibility: 'public', share_status: 'approved' });
		env.DB.sqlite.exec('UPDATE structure_links SET share_requested = 0');
		expect(await cleanupStructureHub(asEnv(env), 1001)).toBe('unshared');
		expect(hub(env)).toMatchObject({ visibility: 'private', share_status: 'none', enabled: 1 });
	});

	it('never touches NPC hubs or unknown ids', async () => {
		const env = fakeEnv();
		expect(await cleanupStructureHub(asEnv(env), 60003760)).toBe('missing');
		expect(env.DB.rows('SELECT count(*) AS n FROM market_hubs')).toEqual([{ n: 6 }]);
	});
});

describe('releaseStructureHubs', () => {
	it('cleans up every distinct structure id', async () => {
		const env = fakeEnv();
		insertStructureHub(env.DB, { structureId: 1001, name: 'A' });
		insertStructureHub(env.DB, { structureId: 1002, name: 'B', visibility: 'public' });
		await releaseStructureHubs(asEnv(env), [1001, 1002, 1001]);
		expect(env.DB.rows("SELECT hub_id, enabled FROM market_hubs WHERE kind = 'structure'")).toEqual([
			{ hub_id: 'structure-1002', enabled: 0 }
		]);
	});
});

describe('setStructureSharing', () => {
	it('on → pending; off without other sharers → private/none', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		linkStructure(env.DB, 'u1', 1001, 1);
		expect(await setStructureSharing(asEnv(env), 'u1', 1001, true)).toBe(true);
		expect(hub(env)).toMatchObject({ visibility: 'private', share_status: 'pending' });
		expect(env.DB.rows('SELECT share_requested FROM structure_links')).toEqual([{ share_requested: 1 }]);
		await setStructureSharing(asEnv(env), 'u1', 1001, false);
		expect(hub(env)).toMatchObject({ visibility: 'private', share_status: 'none' });
	});

	it('a rejected hub goes back to review when someone asks again', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market', shareStatus: 'rejected' });
		linkStructure(env.DB, 'u1', 1001, 1);
		await setStructureSharing(asEnv(env), 'u1', 1001, true);
		expect(hub(env)).toMatchObject({ share_status: 'pending' });
	});

	it('an approved hub stays approved while another user toggles', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, {
			structureId: 1001,
			name: 'Market',
			visibility: 'public',
			shareStatus: 'approved'
		});
		linkStructure(env.DB, 'u1', 1001, 1, true);
		linkStructure(env.DB, 'u2', 1001, 2);
		await setStructureSharing(asEnv(env), 'u2', 1001, true);
		expect(hub(env)).toMatchObject({ visibility: 'public', share_status: 'approved' });
		await setStructureSharing(asEnv(env), 'u2', 1001, false);
		expect(hub(env)).toMatchObject({ visibility: 'public', share_status: 'approved' });
	});

	it('refuses structures the user has not linked', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		linkStructure(env.DB, 'u1', 1001, 1);
		expect(await setStructureSharing(asEnv(env), 'u2', 1001, true)).toBe(false);
		expect(hub(env)).toMatchObject({ share_status: 'none' });
	});
});

describe('removeStructureLink', () => {
	it('removing the last link of a private hub deletes it; another user keeps a shared hub alive', async () => {
		const env = twoUsers();
		insertStructureHub(env.DB, { structureId: 1001, name: 'Market' });
		withHistory(env);
		linkStructure(env.DB, 'u1', 1001, 1);
		linkStructure(env.DB, 'u2', 1001, 2);
		expect(await removeStructureLink(asEnv(env), 'u1', 1001)).toBe(true);
		expect(hub(env)).toMatchObject({ visibility: 'private' });
		expect(await removeStructureLink(asEnv(env), 'u1', 1001)).toBe(false);
		expect(await removeStructureLink(asEnv(env), 'u2', 1001)).toBe(true);
		expect(hub(env)).toBeUndefined();
		expect(env.HISTORY_DB.rows('SELECT hub_id FROM price_daily WHERE hub_id = ?', HUB)).toEqual([]);
	});
});
