import { DEFAULT_SETTINGS, Settings, encodeSettings } from '@reactions/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { NOW, insertStructureHub, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import { clearDataMemo } from '../data';
import { ApiError } from './http';
import { ProfitsQuery } from './schemas';
import {
	checkDate,
	checkLines,
	checkSettingsReferences,
	loadApiCalc,
	settingsFromBody,
	settingsFromQuery
} from './settings';
import { publicHubs } from './data';

beforeEach(() => {
	clearDataMemo();
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

function envWithSystems() {
	const env = fakeEnv();
	insertSystems(env.DB);
	return env;
}

/** The ApiError thrown by `fn` (fails the test when nothing is thrown). */
async function apiError(fn: () => unknown): Promise<ApiError> {
	try {
		await fn();
	} catch (e) {
		if (e instanceof ApiError) return e;
		throw e;
	}
	throw new Error('expected an ApiError');
}

const query = (search: string) => ProfitsQuery.schema.parse(Object.fromEntries(new URLSearchParams(search)));

describe('settingsFromQuery', () => {
	it('returns the defaults in shared mode without parameters', async () => {
		expect(await settingsFromQuery(asEnv(envWithSystems()), query(''))).toEqual(DEFAULT_SETTINGS);
	});

	it('maps maxLines onto the max parallel lines setting, 1 to 10 whole lines', async () => {
		const env = asEnv(envWithSystems());
		expect((await settingsFromQuery(env, query('slots=optimal&maxLines=10'))).maxParallelLines).toBe(10);
		expect((await settingsFromQuery(env, query(''))).maxParallelLines).toBe(4);
		const parse = (v: string) => ProfitsQuery.schema.safeParse({ maxLines: v }).success;
		expect([parse('1'), parse('10'), parse('0'), parse('11'), parse('2.5')]).toEqual([
			true,
			true,
			false,
			false,
			false
		]);
	});

	it('maps every parameter onto the shared profile', async () => {
		const q = query(
			[
				'structure=athanor&meRig=t1&teRig=none&system=671-ST&costIndex=3.5&facilityTax=2&scc=5&skill=4',
				'inputHub=amarr&inputFallbackHub=dodixie&outputHub=perimeter&inputMethod=instant&outputMethod=contract&inputBasis=buy',
				'outputBasis=sell&inputPricePct=95&outputPricePct=105&broker=2.5&salesTax=4',
				'shipInIskPerM3=800&shipInCollateral=1&shipInDiscount=10&shipOutCollateral=2&shipOutDiscount=20',
				'cycleDays=3.5&unrefinedYield=60&prismaticiteYield=80&prismaticiteRoll=40&slots=optimal'
			].join('&')
		);
		const s = await settingsFromQuery(asEnv(envWithSystems()), q);
		expect(s.mode).toBe('shared');
		expect(s.shared).toEqual({
			structure: 'athanor',
			meRig: 't1',
			teRig: 'none',
			systemId: 30004604,
			costIndexOverridePct: 3.5,
			facilityTaxPct: 2,
			sccPct: 5,
			reactionsSkill: 4,
			market: {
				inputHub: 'amarr',
				inputFallbackHub: 'dodixie',
				outputHub: 'perimeter',
				inputMethod: 'instant',
				outputMethod: 'contract',
				inputContractBasis: 'buy',
				outputContractBasis: 'sell',
				inputPricePct: 95,
				outputPricePct: 105,
				brokerFeePct: 2.5,
				salesTaxPct: 4
			},
			shipping: {
				input: { enabled: true, iskPerM3: 800, collateralPct: 1, discountPct: 10 },
				output: { enabled: true, iskPerM3: 0, collateralPct: 2, discountPct: 20 }
			}
		});
		expect(s.cycleDays).toBe(3.5);
		expect(s.slotAllocation).toBe('optimal');
		expect(s.reprocessing).toEqual({
			unrefinedYieldPct: 60,
			prismaticiteYieldPct: 80,
			prismaticiteRollPct: 40
		});
	});

	it('enables shipping only on a side with a price or collateral', async () => {
		const s = await settingsFromQuery(asEnv(envWithSystems()), query('shipInDiscount=50&shipOutIskPerM3=1'));
		expect(s.shared.shipping.input.enabled).toBe(false);
		expect(s.shared.shipping.output.enabled).toBe(true);
	});

	it('accepts a system id or exact name and rejects unknown and highsec systems', async () => {
		const env = asEnv(envWithSystems());
		expect((await settingsFromQuery(env, query('system=j105443'))).shared.systemId).toBe(31000007);
		expect((await settingsFromQuery(env, query('system=30004604'))).shared.systemId).toBe(30004604);
		for (const [system, message] of [
			['Jita', 'Jita is a highsec system; reactions need low, null or J-space'],
			['Ignoit', 'Unknown system "Ignoit"'],
			['123', 'Unknown system "123"']
		]) {
			const e = await apiError(() => settingsFromQuery(env, query(`system=${system}`)));
			expect([e.status, e.code, e.details]).toEqual([400, 'INVALID_PARAM', [{ param: 'system', message }]]);
		}
	});
});

describe('settingsFromBody', () => {
	it('merges a partial object onto the defaults', async () => {
		const s = await settingsFromBody({ cycleDays: 2, shared: { market: { brokerFeePct: 1 } } });
		expect(s.cycleDays).toBe(2);
		expect(s.shared.market.brokerFeePct).toBe(1);
		expect(s.shared.market.salesTaxPct).toBe(DEFAULT_SETTINGS.shared.market.salesTaxPct);
		expect(await settingsFromBody(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it('decodes an encoded settings string', async () => {
		const settings = Settings.parse({ mode: 'per_reactor', reactors: { hybrid: { meRig: 'none' } } });
		expect(await settingsFromBody(await encodeSettings(settings))).toEqual(settings);
	});

	it('names invalid fields below settings', async () => {
		const e = await apiError(() => settingsFromBody({ cycleDays: 0, shared: { structure: 'x' } }));
		expect((e.details as { param: string }[]).map((d) => d.param)).toEqual([
			'settings.shared.structure',
			'settings.cycleDays'
		]);
		expect((await apiError(() => settingsFromBody('???'))).details).toEqual([
			{ param: 'settings', message: 'Not a valid encoded settings string' }
		]);
	});
});

describe('checkSettingsReferences', () => {
	it('checks the hubs and systems of every profile in use', async () => {
		const env = envWithSystems();
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		const hubs = await publicHubs(asEnv(env));
		await checkSettingsReferences(asEnv(env), DEFAULT_SETTINGS, hubs);

		const privateHub = Settings.parse({
			mode: 'per_reactor',
			reactors: { biochemical: { market: { outputHub: 'structure-1044752365771' } } }
		});
		const notFound = await apiError(() => checkSettingsReferences(asEnv(env), privateHub, hubs));
		expect([notFound.status, notFound.code]).toEqual([404, 'NOT_FOUND']);

		const privateFallback = Settings.parse({
			shared: { market: { inputHub: 'amarr', inputFallbackHub: 'structure-1044752365771' } }
		});
		const fallbackNotFound = await apiError(() => checkSettingsReferences(asEnv(env), privateFallback, hubs));
		expect([fallbackNotFound.status, fallbackNotFound.code]).toEqual([404, 'NOT_FOUND']);

		// The unused shared profile does not matter in per-reactor mode.
		const highsec = Settings.parse({
			mode: 'per_reactor',
			shared: { systemId: 1 },
			reactors: { composite: { systemId: 30000142 } }
		});
		const invalid = await apiError(() => checkSettingsReferences(asEnv(env), highsec, hubs));
		expect(invalid.details).toEqual([
			{
				param: 'settings.reactors.composite.systemId',
				message: 'Jita is a highsec system; reactions need low, null or J-space'
			}
		]);
	});
});

describe('checkDate and checkLines', () => {
	it('accepts 400 days ago … yesterday', () => {
		expect(() => checkDate(undefined, NOW)).not.toThrow();
		expect(() => checkDate('2026-10-05', NOW)).not.toThrow();
		expect(() => checkDate('2025-09-01', NOW)).not.toThrow();
		expect(() => checkDate('2026-10-06', NOW)).toThrow(ApiError);
		expect(() => checkDate('2025-08-01', NOW)).toThrow(ApiError);
	});

	it('requires slots=optimal and a chain view for lines', async () => {
		expect(() => checkLines({}, false)).not.toThrow();
		expect(() => checkLines({ slots: 'optimal', lines: 2 }, true)).not.toThrow();
		expect((await apiError(() => checkLines({ lines: 2 }, true))).details).toEqual([
			{ param: 'lines', message: 'Requires slots=optimal' }
		]);
		expect((await apiError(() => checkLines({ slots: 'optimal', lines: 2 }, false))).details).toEqual([
			{ param: 'lines', message: 'Applies to full chains only' }
		]);
	});
});

describe('loadApiCalc', () => {
	it('builds an anonymous engine context with public hubs only', async () => {
		const env = envWithSystems();
		await putKv(env, await loadSde());
		insertStructureHub(env.DB, { structureId: 1044752365771, name: 'Secret Market' });
		const calc = await loadApiCalc(asEnv(env), DEFAULT_SETTINGS);
		expect(calc.hubs.every((h) => !h.private)).toBe(true);
		expect(calc.ctx.profiles.composite.costIndex).toBe(0.0412);
		expect(calc.ctx.inputPrices.approximate).toBe(false);
	});

	it('404s before loading prices when a hub is not public, and 503s without data', async () => {
		const env = envWithSystems();
		const settings = Settings.parse({ shared: { market: { inputHub: 'nowhere' } } });
		expect((await apiError(() => loadApiCalc(asEnv(env), settings))).status).toBe(404);
		const e = await apiError(() => loadApiCalc(asEnv(env), DEFAULT_SETTINGS));
		expect([e.status, e.code]).toEqual([503, 'INTERNAL']);
	});

	it('prices a past day for date=', async () => {
		const env = envWithSystems();
		await putKv(env, await loadSde());
		const calc = await loadApiCalc(asEnv(env), DEFAULT_SETTINGS, { date: '2026-10-01' });
		expect(calc.ctx.inputPrices.asOf).toBe('2026-10-01');
		expect(
			(await apiError(() => loadApiCalc(asEnv(env), DEFAULT_SETTINGS, { date: '2026-10-06' }))).status
		).toBe(400);
	});
});
