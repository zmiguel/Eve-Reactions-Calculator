import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../test/fakes';
import { insertUser } from '../../test/fixtures';
import { insertSource } from '../../test/inventory';
import { sessionUser } from '../../test/sso';
import { profitsAccess, profitsApiContext, profitsContext } from './profits-access';

const alpha = { characterId: 90000001, name: 'Alpha' };

function setup() {
	const env = fakeEnv();
	insertUser(env.DB, { userId: 'u1' }, [alpha]);
	insertUser(env.DB, { userId: 'u2' }, [{ characterId: 90000002, name: 'Beta' }]);
	const source = insertSource(env.DB, { userId: 'u1', characterId: alpha.characterId, ownerName: 'Alpha' });
	const event = (userId: string | null) => ({
		locals: { user: userId ? sessionUser(userId, userId === 'u1' ? [alpha] : []) : null },
		platform: { env: asEnv(env) }
	});
	return { env, source, event };
}

describe('profits access', () => {
	it('anonymous → login; logged in without a tracking connection → enable; with one → ok', async () => {
		const { env, source, event } = setup();
		expect(await profitsAccess(event(null) as never)).toBe('login');
		expect(await profitsAccess(event('u1') as never)).toBe('enable');
		env.DB.sqlite
			.prepare('UPDATE inventory_sources SET tracking_enabled = 1 WHERE source_id = ?')
			.run(source);
		expect(await profitsAccess(event('u1') as never)).toBe('ok');
		// Another account's connection never counts.
		expect(await profitsAccess(event('u2') as never)).toBe('enable');
		expect(await profitsContext(event('u2') as never)).toBeNull();
		expect((await profitsContext(event('u1') as never))?.user.userId).toBe('u1');
	});

	it('the JSON endpoints answer 401 and 403 instead of data', async () => {
		const { event } = setup();
		const status = (e: unknown) => (isHttpError(e) ? e.status : null);
		expect(status(await profitsApiContext(event(null) as never).catch((e: unknown) => e))).toBe(401);
		expect(status(await profitsApiContext(event('u1') as never).catch((e: unknown) => e))).toBe(403);
	});
});
