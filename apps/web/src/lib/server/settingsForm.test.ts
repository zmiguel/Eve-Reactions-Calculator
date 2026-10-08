import { DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { asEnv, fakeEnv } from '../../test/fakes';
import { insertSystems } from '../../test/fixtures';
import {
	normalizeSettings,
	parseSettingsForm,
	profilesInUse,
	referenceErrors,
	systemsFor
} from './settingsForm';

const env = () => {
	const e = fakeEnv();
	insertSystems(e.DB);
	return asEnv(e);
};
const HUBS = new Set(['jita', 'amarr']);

describe('normalizeSettings', () => {
	it('drops unused reactor profiles in shared mode and keeps everything in per-reactor mode', () => {
		const shared = Settings.parse({ shared: { sccPct: 5 }, reactors: { hybrid: { structure: 'athanor' } } });
		expect(normalizeSettings(shared)).toEqual(Settings.parse({ shared: { sccPct: 5 } }));
		const perReactor = { ...shared, mode: 'per_reactor' as const };
		expect(normalizeSettings(perReactor)).toEqual(perReactor);
	});
});

describe('profilesInUse', () => {
	it('is the shared profile or the three reactors', () => {
		expect(profilesInUse(DEFAULT_SETTINGS)).toEqual(['shared']);
		expect(profilesInUse({ ...DEFAULT_SETTINGS, mode: 'per_reactor' })).toEqual([
			'biochemical',
			'composite',
			'hybrid'
		]);
	});
});

describe('referenceErrors', () => {
	it('flags unknown and highsec systems and inaccessible hubs per profile', async () => {
		const s = Settings.parse({
			mode: 'per_reactor',
			reactors: {
				composite: { systemId: 30000142 },
				hybrid: { systemId: 1, market: { outputHub: 'structure-1', inputFallbackHub: 'structure-2' } }
			}
		});
		const systems = await systemsFor(env(), [s]);
		expect(referenceErrors(s, profilesInUse(s), systems, HUBS)).toEqual({
			'reactors.composite.systemId': 'Jita is a highsec system; reactions need low, null or J-space',
			'reactors.hybrid.systemId': 'Unknown system 1',
			'reactors.hybrid.market.outputHub': 'This market hub is not available to you',
			'reactors.hybrid.market.inputFallbackHub': 'This market hub is not available to you'
		});
		expect(referenceErrors(DEFAULT_SETTINGS, ['shared'], systems, HUBS)).toEqual({});
	});
});

describe('parseSettingsForm', () => {
	it('reports a missing system and garbage enum values', async () => {
		const form = new FormData();
		form.set('mode', 'shared');
		form.set('editing', 'shared');
		form.set('shared.system', '');
		form.set('shared.structure', 'castle');
		const result = await parseSettingsForm(env(), form, DEFAULT_SETTINGS, HUBS);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual({
			'shared.systemId': 'Choose a system',
			'shared.structure': 'Choose one of the options'
		});
	});

	it('switching back to shared without JS keeps the stored shared profile', async () => {
		const current = Settings.parse({
			mode: 'per_reactor',
			shared: { sccPct: 6 },
			reactors: { hybrid: { sccPct: 2 } }
		});
		const form = new FormData();
		form.set('mode', 'shared');
		form.set('editing', 'per_reactor');
		form.set('reactors.hybrid.sccPct', '999');
		const result = await parseSettingsForm(env(), form, current, HUBS);
		expect(result).toEqual({ ok: true, settings: Settings.parse({ shared: { sccPct: 6 } }) });
	});

	it('reads max parallel lines and rejects more than 10', async () => {
		const submit = (value: string) => {
			const form = new FormData();
			form.set('mode', 'shared');
			form.set('editing', 'per_reactor');
			form.set('maxParallelLines', value);
			return parseSettingsForm(env(), form, DEFAULT_SETTINGS, HUBS);
		};
		expect(await submit('10')).toEqual({ ok: true, settings: Settings.parse({ maxParallelLines: 10 }) });
		const tooMany = await submit('11');
		expect(tooMany.ok).toBe(false);
		if (tooMany.ok) return;
		expect(tooMany.errors).toEqual({ maxParallelLines: 'Must be at most 10' });
		expect(tooMany.values.maxParallelLines).toBe(11);
	});

	it('copies errors of the shared profile to every reactor when switching to per-reactor', async () => {
		const form = new FormData();
		form.set('mode', 'per_reactor');
		form.set('editing', 'shared');
		form.set('shared.systemId', '30002647');
		form.set('shared.facilityTaxPct', '60');
		const result = await parseSettingsForm(env(), form, DEFAULT_SETTINGS, HUBS);
		if (result.ok) throw new Error('expected failure');
		expect(Object.keys(result.errors).sort()).toEqual([
			'reactors.biochemical.facilityTaxPct',
			'reactors.composite.facilityTaxPct',
			'reactors.hybrid.facilityTaxPct',
			'shared.facilityTaxPct'
		]);
		expect(result.values.mode).toBe('per_reactor');
		expect(result.values.reactors.hybrid.facilityTaxPct).toBe(60);
	});
});
