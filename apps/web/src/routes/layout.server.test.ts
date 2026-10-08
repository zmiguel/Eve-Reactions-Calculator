import { DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

const run = (user: App.Locals['user'], settings: Settings = DEFAULT_SETTINGS) =>
	load({ locals: { user, settings } } as never);

describe('root layout load', () => {
	it('exposes only the login character and admin flag to the navbar', () => {
		expect(
			run({
				userId: 'secret-user-id',
				characterId: 90000002,
				characters: [
					{ characterId: 90000001, name: 'Alpha' },
					{ characterId: 90000002, name: 'Beta' }
				],
				isAdmin: true
			})
		).toEqual({
			user: { characterId: 90000002, name: 'Beta', isAdmin: true },
			defaultTabs: { view: 'single', output: 'product', unrefined: false }
		});
	});

	it('falls back to the first character and is null when anonymous', () => {
		expect(
			run({ userId: 'u', characterId: 5, characters: [{ characterId: 1, name: 'Alpha' }], isAdmin: false })
		).toMatchObject({ user: { characterId: 1, name: 'Alpha', isAdmin: false } });
		expect(run(null)).toMatchObject({ user: null });
	});

	it("passes the visitor's preferred reaction tabs to every page", () => {
		expect(run(null, Settings.parse({ defaultView: 'chain', defaultOutput: 'reprocessed' }))).toEqual({
			user: null,
			defaultTabs: { view: 'chain', output: 'reprocessed', unrefined: false }
		});
		expect(
			(run(null, Settings.parse({ unrefinedInChains: 'best' })) as { defaultTabs: unknown }).defaultTabs
		).toEqual({
			view: 'single',
			output: 'product',
			unrefined: true
		});
	});
});
