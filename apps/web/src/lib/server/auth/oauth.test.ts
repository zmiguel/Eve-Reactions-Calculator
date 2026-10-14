import { describe, expect, it } from 'vitest';
import { SESSION_SECRET } from '../../../test/sso';
import { readOauthState, safeReturnTo, signOauthState, type LoginFlow } from './oauth';

const NOW = 1_791_000_000_000;
const STATE = 'state-abcdefghijklmnop';
const flow: LoginFlow = {
	purpose: 'features',
	feature: null,
	features: ['structures', 'tracking'],
	characterId: 90000001,
	returnTo: '/account'
};
const sign = (
	overrides: Partial<{ state: string; exp: number; returnTo: string }> = {},
	secret = SESSION_SECRET
) => signOauthState(secret, { ...flow, state: STATE, exp: NOW + 600_000, ...overrides });

describe('safeReturnTo', () => {
	it('keeps same-site paths with their query and hash, dot segments resolved', () => {
		expect(safeReturnTo('/composite?view=chain')).toBe('/composite?view=chain');
		expect(safeReturnTo('/')).toBe('/');
		expect(safeReturnTo('/account#characters')).toBe('/account#characters');
		expect(safeReturnTo('/a/../planner?x=1')).toBe('/planner?x=1');
		expect(safeReturnTo('/auth/login?purpose=feature&returnTo=%2F%2Fx')).toBe(
			'/auth/login?purpose=feature&returnTo=%2F%2Fx'
		);
	});

	it.each([
		'//evil.example',
		'/\\evil.example',
		'\\\\evil.example',
		'/.\\/evil.example',
		'/.//evil.example',
		'/..//evil.example',
		'/a/..//evil.example',
		'/%2e//evil.example',
		'/%2E%2E//evil.example',
		'https://evil.example/',
		'evil',
		'',
		'/\t/evil.example',
		'/\n/evil.example',
		null
	])('sends %j to /account', (value) => {
		expect(safeReturnTo(value)).toBe('/account');
	});
});

describe('rc_oauth', () => {
	it('round-trips the flow when signature, expiry and state match', async () => {
		expect(await readOauthState(SESSION_SECRET, await sign(), STATE, NOW)).toEqual(flow);
	});

	it('reads a cookie signed before the feature set existed as features null', async () => {
		const legacy = {
			purpose: 'feature',
			feature: 'structures',
			characterId: 90000001,
			returnTo: '/account'
		} as const;
		const cookie = await signOauthState(SESSION_SECRET, {
			...legacy,
			state: STATE,
			exp: NOW + 600_000
		} as never);
		expect(await readOauthState(SESSION_SECRET, cookie, STATE, NOW)).toEqual({ ...legacy, features: null });
	});

	it('rejects a tampered payload or signature', async () => {
		const [body, sig] = (await sign()).split('.');
		const forged = btoa(JSON.stringify({ ...flow, characterId: 1, state: STATE, exp: NOW + 600_000 }))
			.replace(/=+$/, '')
			.replace(/\+/g, '-')
			.replace(/\//g, '_');
		expect(await readOauthState(SESSION_SECRET, `${forged}.${sig}`, STATE, NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, `${body}.${sig.slice(0, -2)}AA`, STATE, NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, `${body}.${sig}.x`, STATE, NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, 'garbage', STATE, NOW)).toBeNull();
	});

	it('rejects a cookie signed with another secret', async () => {
		const other = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 7)));
		expect(await readOauthState(SESSION_SECRET, await sign({}, other), STATE, NOW)).toBeNull();
	});

	it('rejects an expired cookie, another state and a missing cookie or state', async () => {
		expect(await readOauthState(SESSION_SECRET, await sign({ exp: NOW }), STATE, NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, await sign(), 'state-other-1234567', NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, undefined, STATE, NOW)).toBeNull();
		expect(await readOauthState(SESSION_SECRET, await sign(), null, NOW)).toBeNull();
	});

	it('re-checks returnTo when reading', async () => {
		const read = await readOauthState(SESSION_SECRET, await sign({ returnTo: '//evil.example' }), STATE, NOW);
		expect(read?.returnTo).toBe('/account');
	});
});
