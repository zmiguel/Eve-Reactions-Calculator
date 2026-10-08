import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { insertStructureHub, insertUser, linkStructure } from '../../../test/fixtures';
import { releaseStructureHubs } from '../structures';
import { deleteAccount, listCharacters, removeCharacter } from './accounts';

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
