import { DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import type { AccountFacts } from '$lib/server/session';
import { asEnv, fakeEnv } from '../test/fakes';
import { NOW, insertSystems } from '../test/fixtures';
import { load } from './+layout.server';

const env = fakeEnv();
insertSystems(env.DB);

const account: AccountFacts = {
	createdAt: NOW,
	features: ['structures'],
	corporation: 'Reaction Corp',
	alliance: null
};

const run = (
	user: App.Locals['user'],
	settings: Settings = DEFAULT_SETTINGS,
	facts: AccountFacts | null = user ? account : null
) => load({ locals: { user, account: facts, settings }, platform: { env: asEnv(env) } } as never);

const alphaBeta: App.Locals['user'] = {
	userId: 'secret-user-id',
	characterId: 90000002,
	characters: [
		{ characterId: 90000001, name: 'Alpha' },
		{ characterId: 90000002, name: 'Beta' }
	],
	isAdmin: true
};

describe('root layout load', () => {
	it('exposes the login character to the navbar and the account with its main character to analytics', async () => {
		expect(await run(alphaBeta)).toEqual({
			user: { characterId: 90000002, name: 'Beta', isAdmin: true },
			analytics: {
				userId: 'secret-user-id',
				traits: {
					username: 'Alpha',
					name: 'Alpha',
					main_character_id: 90000001,
					corporation: 'Reaction Corp',
					alliance: 'none',
					is_admin: true,
					characters: 2,
					account_created: '2026-10-06',
					features: 'structures',
					structure: 'tatara',
					security: 'lowsec',
					input_hub: 'jita',
					output_hub: 'jita',
					per_reactor: false,
					slots: 'single',
					unrefined: 'never',
					custom_settings: false
				}
			},
			defaultTabs: { view: 'single', output: 'product', unrefined: false }
		});
	});

	it('never sends a null trait (Rybbit drops the whole update): unknown and missing affiliations are words', async () => {
		const traitsOf = async (facts: AccountFacts) =>
			((await run(alphaBeta, DEFAULT_SETTINGS, facts)) as { analytics: { traits: Record<string, unknown> } })
				.analytics.traits;
		const notLookedUp = await traitsOf({ ...account, corporation: null, alliance: null });
		expect(notLookedUp).toMatchObject({ corporation: 'unknown', alliance: 'unknown' });
		expect(Object.values(notLookedUp)).not.toContain(null);
		expect(await traitsOf({ ...account, alliance: 'Moon Alliance' })).toMatchObject({
			corporation: 'Reaction Corp',
			alliance: 'Moon Alliance'
		});
	});

	it('summarises changed settings, reports per-reactor differences as mixed and hides structure markets', async () => {
		const settings = Settings.parse({
			mode: 'per_reactor',
			slotAllocation: 'optimal',
			unrefinedInChains: 'best',
			reactors: {
				biochemical: {
					systemId: 30004604,
					market: { inputHub: 'structure-1044752365771', outputHub: 'amarr' }
				},
				composite: {
					systemId: 30004604,
					market: { inputHub: 'structure-1042508032148', outputHub: 'amarr' }
				},
				hybrid: { systemId: 31000007, structure: 'athanor', market: { outputHub: 'amarr' } }
			}
		});
		const data = (await run(alphaBeta, settings, { ...account, features: [] })) as {
			analytics: { traits: Record<string, unknown> };
		};
		expect(data.analytics.traits).toMatchObject({
			features: 'none',
			structure: 'mixed',
			security: 'mixed',
			input_hub: 'mixed',
			output_hub: 'amarr',
			per_reactor: true,
			slots: 'optimal',
			unrefined: 'best',
			custom_settings: true
		});

		const structures = Settings.parse({ shared: { market: { inputHub: 'structure-1044752365771' } } });
		expect(((await run(alphaBeta, structures)) as typeof data).analytics.traits).toMatchObject({
			input_hub: 'structure',
			output_hub: 'jita'
		});
	});

	it('falls back to the first character for the navbar and is null when anonymous', async () => {
		expect(
			await run({
				userId: 'u',
				characterId: 5,
				characters: [{ characterId: 1, name: 'Alpha' }],
				isAdmin: false
			})
		).toMatchObject({ user: { characterId: 1, name: 'Alpha', isAdmin: false } });
		expect(await run(null)).toMatchObject({ user: null, analytics: null });
	});

	it("passes the visitor's preferred reaction tabs to every page", async () => {
		expect(await run(null, Settings.parse({ defaultView: 'chain', defaultOutput: 'reprocessed' }))).toEqual({
			user: null,
			analytics: null,
			defaultTabs: { view: 'chain', output: 'reprocessed', unrefined: false }
		});
		expect(
			((await run(null, Settings.parse({ unrefinedInChains: 'best' }))) as { defaultTabs: unknown })
				.defaultTabs
		).toEqual({
			view: 'single',
			output: 'product',
			unrefined: true
		});
	});
});
