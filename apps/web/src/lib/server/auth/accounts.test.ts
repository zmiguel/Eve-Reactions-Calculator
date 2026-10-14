import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { insertStructureHub, insertUser, linkStructure } from '../../../test/fixtures';
import {
	addReader,
	grantInventory,
	insertItems,
	insertLocation,
	insertSource,
	poolOf,
	selectBucket,
	selection
} from '../../../test/inventory';
import { releaseStructureHubs } from '../structures';
import { deleteAccount, listCharacters, permissionsNoticeLocation, removeCharacter } from './accounts';

vi.mock('../structures', () => ({ releaseStructureHubs: vi.fn(async () => {}) }));

beforeEach(() => vi.mocked(releaseStructureHubs).mockClear());

function account() {
	const env = fakeEnv();
	insertUser(env.DB, { userId: 'u1' }, [
		{ characterId: 90000001, name: 'Alpha' },
		{ characterId: 90000002, name: 'Beta' }
	]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000003, name: 'Gamma' }]);
	insertStructureHub(env.DB, { structureId: 1001, name: 'Market A' });
	insertStructureHub(env.DB, { structureId: 1002, name: 'Market B' });
	linkStructure(env.DB, 'u1', 1001, 90000001);
	linkStructure(env.DB, 'u1', 1002, 90000002);
	return env;
}

describe('removeCharacter', () => {
	it('deletes the character and its links and hands their structures to the hub cleanup', async () => {
		const env = account();
		expect(await removeCharacter(asEnv(env), 90000001)).toEqual({ userId: 'u1', accountDeleted: false });
		expect((await listCharacters(asEnv(env), 'u1')).map((c) => c.characterId)).toEqual([90000002]);
		expect(env.DB.rows('SELECT structure_id FROM structure_links')).toEqual([{ structure_id: 1002 }]);
		expect(releaseStructureHubs).toHaveBeenCalledWith(expect.anything(), [1001]);
	});

	it('removing the last character deletes the account', async () => {
		const env = account();
		expect(await removeCharacter(asEnv(env), 90000003)).toEqual({ userId: 'u2', accountDeleted: true });
		expect(env.DB.rows('SELECT user_id FROM users')).toEqual([{ user_id: 'u1' }]);
	});

	it('returns null for an unknown character', async () => {
		expect(await removeCharacter(asEnv(account()), 1)).toBeNull();
	});

	it('hands a corporation inventory the character prefers to another member of its reader pool', async () => {
		const env = account();
		grantInventory(env.DB, 90000001, ['assets', 'corp_assets']);
		grantInventory(env.DB, 90000002, ['corp_assets']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001,
			ownerName: 'Seed Corp'
		});
		addReader(env.DB, corp, 90000002);
		insertSource(env.DB, { userId: 'u1', characterId: 90000001 });
		insertLocation(env.DB, corp, 60003760);
		insertItems(env.DB, corp, 60003760, 'div1', { 16663: 10 });
		selectBucket(env.DB, corp, 60003760, 'div1');

		await removeCharacter(asEnv(env), 90000001);

		expect(env.DB.rows('SELECT source_id, kind, character_id FROM inventory_sources')).toEqual([
			{ source_id: corp, kind: 'corporation', character_id: 90000002 }
		]);
		expect(poolOf(env.DB, corp)).toEqual([90000002]);
		expect(env.DB.rows('SELECT type_id, quantity FROM inventory_items')).toEqual([
			{ type_id: 16663, quantity: 10 }
		]);
		expect(selection(env.DB, corp)).toEqual(['60003760:div1']);
	});

	it('removes a corporation inventory without another pool member, even when another character could read it', async () => {
		const env = account();
		grantInventory(env.DB, 90000001, ['corp_assets']);
		grantInventory(env.DB, 90000002, ['corp_assets']);
		env.DB.sqlite.exec('UPDATE characters SET corporation_id = 98000001');
		insertSource(env.DB, { userId: 'u1', characterId: 90000001, kind: 'corporation', ownerId: 98000001 });

		await removeCharacter(asEnv(env), 90000001);

		expect(env.DB.rows('SELECT source_id FROM inventory_sources')).toEqual([]);
		expect(env.DB.rows('SELECT * FROM inventory_source_readers')).toEqual([]);
	});

	it("never hands an inventory to another account's character, even with a pool row pointing at it", async () => {
		const env = account();
		grantInventory(env.DB, 90000001, ['corp_assets']);
		grantInventory(env.DB, 90000003, ['corp_assets']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001
		});
		addReader(env.DB, corp, 90000003);

		await removeCharacter(asEnv(env), 90000001);

		expect(env.DB.rows('SELECT source_id FROM inventory_sources')).toEqual([]);
	});

	it('only drops the pool membership of a character that is not the preferred reader', async () => {
		const env = account();
		grantInventory(env.DB, 90000001, ['corp_assets']);
		grantInventory(env.DB, 90000002, ['corp_assets']);
		const corp = insertSource(env.DB, {
			userId: 'u1',
			characterId: 90000001,
			kind: 'corporation',
			ownerId: 98000001
		});
		addReader(env.DB, corp, 90000002);

		await removeCharacter(asEnv(env), 90000002);

		expect(env.DB.rows('SELECT character_id FROM inventory_sources')).toEqual([{ character_id: 90000001 }]);
		expect(poolOf(env.DB, corp)).toEqual([90000001]);
	});
});

describe('deleteAccount', () => {
	it('cascades to sessions, characters and links and releases every linked structure', async () => {
		const env = account();
		env.DB.sqlite.exec(
			"INSERT INTO user_sessions (session_hash, user_id, created_at, expires_at, character_id) VALUES ('h', 'u1', 0, 9e12, 90000001)"
		);
		await deleteAccount(asEnv(env), 'u1');
		expect(env.DB.rows('SELECT user_id FROM users')).toEqual([{ user_id: 'u2' }]);
		expect(env.DB.rows('SELECT character_id FROM characters')).toEqual([{ character_id: 90000003 }]);
		expect(env.DB.rows('SELECT * FROM structure_links')).toEqual([]);
		expect(env.DB.rows('SELECT * FROM user_sessions')).toEqual([]);
		expect(releaseStructureHubs).toHaveBeenCalledWith(expect.anything(), [1001, 1002]);
	});
});

describe('permissionsNoticeLocation', () => {
	it('adds the notice to a same-site returnTo', () => {
		expect(permissionsNoticeLocation('/account?x=1', 90000001, ['assets'], ['tracking'])).toBe(
			'/account?x=1&notice=permissions&characterId=90000001&added=assets&removed=tracking'
		);
	});

	it.each(['/.//evil.example', '/..//evil.example', '/%2e//evil.example', '//evil.example'])(
		'never builds a location on another host from %s',
		(returnTo) => {
			expect(permissionsNoticeLocation(returnTo, 90000001, [], ['assets'])).toBe(
				'/account?notice=permissions&characterId=90000001&added=&removed=assets'
			);
		}
	);
});
