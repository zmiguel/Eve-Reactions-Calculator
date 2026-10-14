import { describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv, type FakeEnv } from '../../test/fakes';
import { insertUser } from '../../test/fixtures';
import { requestLedgerRebuild } from './ledger-rebuild';

const dirty = (env: FakeEnv, userId: string) =>
	env.DB.sqlite.prepare('SELECT dirty FROM ledger_state WHERE user_id = ?').get(userId) as
		{ dirty: number } | undefined;

function setup(updater?: unknown) {
	const env = fakeEnv(updater === undefined ? {} : { UPDATER: updater });
	insertUser(env.DB, { userId: 'u1' });
	insertUser(env.DB, { userId: 'u2' });
	return env;
}

describe('requestLedgerRebuild', () => {
	it('marks the ledger dirty before the updater rebuilds it, so a rebuild that loaded earlier cannot clear it', async () => {
		let seen: { dirty: number } | undefined;
		const env = setup({
			rebuildLedger: vi.fn(async () => {
				seen = dirty(env, 'u1');
				return { rebuiltAt: 1, lots: 2, jobs: 1, needsReview: 0 };
			})
		});
		env.DB.sqlite.exec(`INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES ('u1', 5, 0)`);
		expect(await requestLedgerRebuild(asEnv(env), 'u1')).toEqual({ rebuilt: true });
		expect(seen).toEqual({ dirty: 1 });
		expect(dirty(env, 'u2')).toBeUndefined();
	});

	it('reports not rebuilt when the updater could not rebuild, leaving the ledger dirty', async () => {
		const env = setup({ rebuildLedger: vi.fn(async () => ({ error: 'unavailable' as const })) });
		expect(await requestLedgerRebuild(asEnv(env), 'u1')).toEqual({ rebuilt: false });
		expect(dirty(env, 'u1')).toEqual({ dirty: 1 });
	});

	it.each([
		['the updater does not answer', { rebuildLedger: vi.fn(async () => Promise.reject(new Error('down'))) }],
		['the binding is missing', undefined]
	])('marks only that user’s ledger dirty when %s', async (_case, updater) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const env = setup(updater);
		env.DB.sqlite.exec(`INSERT INTO ledger_state (user_id, rebuilt_at, dirty) VALUES ('u1', 5, 0)`);
		expect(await requestLedgerRebuild(asEnv(env), 'u1')).toEqual({ rebuilt: false });
		expect(dirty(env, 'u1')).toEqual({ dirty: 1 });
		expect(dirty(env, 'u2')).toBeUndefined();
		// A second failure keeps it dirty (upsert, no duplicate row).
		await requestLedgerRebuild(asEnv(env), 'u1');
		expect(env.DB.sqlite.prepare('SELECT count(*) AS n FROM ledger_state').get()).toEqual({ n: 1 });
	});
});
