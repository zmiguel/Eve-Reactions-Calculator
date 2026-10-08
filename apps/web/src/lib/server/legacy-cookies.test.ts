import { DEFAULT_SETTINGS, Settings, isDefaultSettings } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { V2_COOKIES, convertLegacySettings, takeLegacyCookies } from './legacy-cookies';
import { FakeCookies, asEnv, fakeEnv } from '../../test/fakes';
import { V2_DEFAULT_COOKIES, insertSystems } from '../../test/fixtures';

function convert(cookies: Record<string, string>) {
	const env = fakeEnv();
	insertSystems(env.DB);
	return convertLegacySettings(asEnv(env), new Map(Object.entries(cookies)));
}

describe('convertLegacySettings', () => {
	it.each<[string, Record<string, string>, unknown]>([
		['input buy (buy orders, broker fee)', { input: 'buy' }, {}],
		[
			'input sell (instant from sell orders)',
			{ input: 'sell' },
			{ shared: { market: { inputMethod: 'instant' } } }
		],
		['output sell (sell orders)', { output: 'sell' }, {}],
		[
			'output buy (instant to buy orders)',
			{ output: 'buy' },
			{ shared: { market: { outputMethod: 'instant' } } }
		],
		['input hub Amarr', { inMarket: 'Amarr' }, { shared: { market: { inputHub: 'amarr' } } }],
		['input hub Perimeter', { inMarket: 'Perimeter' }, { shared: { market: { inputHub: 'perimeter' } } }],
		['output hub Amarr', { outMarket: 'Amarr' }, { shared: { market: { outputHub: 'amarr' } } }],
		['output hub Perimeter', { outMarket: 'Perimeter' }, { shared: { market: { outputHub: 'perimeter' } } }],
		['unknown hub', { inMarket: 'Dodixie', outMarket: 'jita' }, {}],
		['broker fee', { brokers: '2.5' }, { shared: { market: { brokerFeePct: 2.5 } } }],
		['broker fee at the v2 default', { brokers: '3.0' }, {}],
		['sales tax', { sales: '4.5' }, { shared: { market: { salesTaxPct: 4.5 } } }],
		['skill', { skill: '4' }, { shared: { reactionsSkill: 4 } }],
		['medium facility', { facility: 'medium' }, { shared: { structure: 'athanor' } }],
		['no rigs', { rigs: '0' }, { shared: { meRig: 'none', teRig: 'none' } }],
		['T1 rigs', { rigs: '1' }, { shared: { meRig: 't1', teRig: 't1' } }],
		['space alone', { space: 'lowsec' }, {}],
		['system by name', { system: '671-ST' }, { shared: { systemId: 30004604 } }],
		['system name case-insensitive', { system: ' j105443 ' }, { shared: { systemId: 31000007 } }],
		['highsec system', { system: 'Jita' }, {}],
		['unknown system', { system: 'Nowhere' }, {}],
		['facility tax', { indyTax: '5' }, { shared: { facilityTaxPct: 5 } }],
		['SCC surcharge', { sccTax: '3' }, { shared: { sccPct: 3 } }],
		['duration of one day', { duration: '1440' }, { cycleDays: 1 }],
		['duration of 30 days', { duration: '43200' }, { cycleDays: 30 }],
		['duration below 6 hours', { duration: '60' }, {}],
		['duration above 30 days', { duration: '50000' }, {}],
		['wormhole cost index', { space: 'wormhole', costIndex: '5' }, { shared: { costIndexOverridePct: 5 } }],
		['wormhole without cost index', { space: 'wormhole', costIndex: '0' }, {}],
		['cost index outside wormhole space', { space: 'nullsec', costIndex: '5' }, {}],
		['prismaticite roll', { prismaticite: '75' }, { reprocessing: { prismaticiteRollPct: 75 } }],
		['cycles, partner and submit', { cycles: '100', partner: 'true', submit: '' }, {}]
	])('%s', async (_, cookies, expected) => {
		expect(await convert(cookies)).toEqual(Settings.parse(expected));
	});

	it('leaves every v2 default unconverted, so v2 defaults become the v3 defaults', async () => {
		const settings = await convert(V2_DEFAULT_COOKIES);
		expect(isDefaultSettings(settings)).toBe(true);
		expect(settings.shared.market.brokerFeePct).toBe(DEFAULT_SETTINGS.shared.market.brokerFeePct);
	});

	it('skips invalid, unparseable and out-of-range values one by one', async () => {
		const settings = await convert({
			input: 'contract',
			output: 'auction',
			brokers: 'abc',
			sales: '11',
			skill: '4.5',
			facility: 'small',
			rigs: '3',
			indyTax: '60',
			sccTax: '-1',
			duration: 'week',
			prismaticite: '101',
			space: 'wormhole',
			costIndex: '101',
			system: 'Jita',
			inMarket: 'constructor',
			partner: 'true'
		});
		expect(settings).toEqual(DEFAULT_SETTINGS);
		expect(
			await convert({ brokers: '', sales: '5', skill: '0', system: '671-ST', settingsMode: 'single' })
		).toEqual(Settings.parse({ shared: { market: { salesTaxPct: 5 }, systemId: 30004604 } }));
	});

	it('single mode reads the unsuffixed cookies only', async () => {
		expect(await convert({ settingsMode: 'single', brokers_composite: '2', skill: '3' })).toEqual(
			Settings.parse({ shared: { reactionsSkill: 3 } })
		);
	});

	it('separate mode builds each reactor from its suffixed cookies, falling back to the unsuffixed ones', async () => {
		const settings = await convert({
			settingsMode: 'separate',
			brokers: '2',
			brokers_composite: '2.5',
			// A suffixed v2 default overrides a non-default unsuffixed value with the v3 default.
			skill: '3',
			skill_biochemical: '5',
			facility_hybrid: 'medium',
			system_biochemical: '671-ST',
			space_composite: 'wormhole',
			costIndex_composite: '7',
			costIndex_hybrid: '7',
			duration_biochemical: '10080',
			duration_composite: '1440',
			duration_hybrid: '2880',
			prismaticite_hybrid: '80'
		});
		expect(settings).toEqual(
			Settings.parse({
				mode: 'per_reactor',
				shared: { market: { brokerFeePct: 2 }, reactionsSkill: 3 },
				reactors: {
					biochemical: { market: { brokerFeePct: 2 }, systemId: 30004604 },
					composite: { market: { brokerFeePct: 2.5 }, reactionsSkill: 3, costIndexOverridePct: 7 },
					hybrid: { market: { brokerFeePct: 2 }, reactionsSkill: 3, structure: 'athanor' }
				},
				cycleDays: 1,
				reprocessing: { prismaticiteRollPct: 80 }
			})
		);
	});

	it('separate mode without other changes still switches to per-reactor profiles', async () => {
		expect(await convert({ ...V2_DEFAULT_COOKIES, settingsMode: 'separate' })).toEqual(
			Settings.parse({ mode: 'per_reactor' })
		);
	});
});

describe('takeLegacyCookies', () => {
	it('returns and deletes every v2 cookie, leaving v3 cookies alone', () => {
		const all = Object.fromEntries([...V2_COOKIES].map((name) => [name, 'x']));
		const cookies = new FakeCookies({ ...all, rc_theme: 'light', rc_settings: 'abc', rc_session: 't' });
		const legacy = takeLegacyCookies(cookies.asCookies());
		expect(new Set(legacy.keys())).toEqual(V2_COOKIES);
		expect(new Set(cookies.deleted)).toEqual(V2_COOKIES);
		expect(cookies.set_calls.every((c) => c.opts.path === '/' && c.opts.maxAge === 0)).toBe(true);
		expect([...cookies.jar.keys()].sort()).toEqual(['rc_session', 'rc_settings', 'rc_theme']);
	});

	it('names the settings form fields with every reactor suffix', () => {
		for (const name of [
			'settingsMode',
			'partner',
			'input',
			'input_composite',
			'cycles_hybrid',
			'submit_biochemical'
		])
			expect(V2_COOKIES.has(name)).toBe(true);
		expect(V2_COOKIES.size).toBe(2 + 18 * 4);
	});
});
