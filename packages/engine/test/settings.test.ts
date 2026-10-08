import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SETTINGS,
	MAX_DECODED_BYTES,
	Settings,
	decodeJson,
	decodeSettings,
	encodeJson,
	encodeSettings,
	isDefaultSettings,
	profileFor,
	settingsDiff
} from '../src/settings.ts';

describe('defaults', () => {
	it('materialise every nested default', () => {
		expect(DEFAULT_SETTINGS.v).toBe(1);
		expect(DEFAULT_SETTINGS.mode).toBe('shared');
		expect(DEFAULT_SETTINGS.cycleDays).toBe(7);
		expect(DEFAULT_SETTINGS.slotAllocation).toBe('single');
		expect(DEFAULT_SETTINGS.shared).toMatchObject({
			structure: 'tatara',
			meRig: 't2',
			teRig: 't2',
			systemId: 30002647,
			costIndexOverridePct: null,
			facilityTaxPct: 1,
			sccPct: 4,
			reactionsSkill: 5
		});
		expect(DEFAULT_SETTINGS.shared.market).toEqual({
			inputHub: 'jita',
			inputFallbackHub: 'jita',
			outputHub: 'jita',
			inputMethod: 'buy_order',
			outputMethod: 'sell_order',
			inputContractBasis: 'split',
			outputContractBasis: 'split',
			inputPricePct: 100,
			outputPricePct: 100,
			brokerFeePct: 1.5,
			salesTaxPct: 3.6
		});
		expect(DEFAULT_SETTINGS.shared.shipping.output).toEqual({
			enabled: false,
			iskPerM3: 0,
			collateralPct: 0,
			discountPct: 0
		});
		expect(DEFAULT_SETTINGS.reactors.hybrid).toEqual(DEFAULT_SETTINGS.shared);
		expect(DEFAULT_SETTINGS.reprocessing).toEqual({
			unrefinedYieldPct: 55,
			prismaticiteYieldPct: 90.63,
			prismaticiteRollPct: 50
		});
	});

	it('fill partial nested objects', () => {
		const s = Settings.parse({ shared: { market: { inputHub: 'amarr' } } });
		expect(s.shared.market.inputHub).toBe('amarr');
		expect(s.shared.market.brokerFeePct).toBe(1.5);
	});

	it('reject out-of-range values', () => {
		expect(Settings.safeParse({ shared: { reactionsSkill: 6 } }).success).toBe(false);
		expect(Settings.safeParse({ cycleDays: 0.1 }).success).toBe(false);
		expect(Settings.safeParse({ shared: { market: { inputPricePct: 200 } } }).success).toBe(false);
		expect(Settings.safeParse({ shared: { shipping: { input: { discountPct: 101 } } } }).success).toBe(false);
		expect(Settings.safeParse({ shared: { shipping: { output: { discountPct: -1 } } } }).success).toBe(false);
		expect(Settings.safeParse({ slotAllocation: 'parallel' }).success).toBe(false);
		expect(DEFAULT_SETTINGS.maxParallelLines).toBe(4);
		for (const maxParallelLines of [0, 11, 2.5])
			expect(Settings.safeParse({ maxParallelLines }).success).toBe(false);
		expect(Settings.parse({ maxParallelLines: 10 }).maxParallelLines).toBe(10);
	});
});

describe('codec', () => {
	it('round-trips settings through deflate-raw base64url', async () => {
		const s = Settings.parse({
			mode: 'per_reactor',
			reactors: { composite: { meRig: 't1' } },
			cycleDays: 3.5
		});
		const encoded = await encodeSettings(s);
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(await decodeSettings(encoded)).toEqual(s);
	});

	it('returns null for garbage, empty input and schema violations', async () => {
		expect(await decodeSettings('')).toBeNull();
		expect(await decodeSettings('not*base64')).toBeNull();
		expect(await decodeSettings('AAAA')).toBeNull();
		expect(await decodeSettings(await encodeJson({ v: 2 }))).toBeNull();
		expect(await decodeSettings(await encodeJson('hello'))).toBeNull();
		expect(await decodeSettings(await encodeJson(null))).toBeNull();
		expect(await decodeSettings(await encodeJson([1, 2]))).toBeNull();
		expect(await decodeSettings(await encodeJson({ shared: { facilityTaxPct: 99 } }))).toBeNull();
	});

	it('rejects codes that inflate beyond the limit (decompression bombs) or are too long', async () => {
		// ~10 MB of one repeated character deflates to a few KiB.
		const bomb = await encodeJson({ shared: { systemName: 'a'.repeat(10_000_000) } });
		expect(bomb.length).toBeLessThan(MAX_DECODED_BYTES);
		expect(await decodeJson(bomb)).toBeNull();
		expect(await decodeSettings(bomb)).toBeNull();

		const near = await encodeJson({ pad: 'a'.repeat(MAX_DECODED_BYTES - 20) });
		expect(await decodeJson(near)).toEqual({ pad: 'a'.repeat(MAX_DECODED_BYTES - 20) });
		expect(await decodeJson(near, 1024)).toBeNull();
		expect(await decodeJson('A'.repeat(MAX_DECODED_BYTES + 1))).toBeNull();
	});

	it('encodes only the versioned diff from the defaults', async () => {
		expect(await decodeJson(await encodeSettings(DEFAULT_SETTINGS))).toEqual({ v: 1 });
		const s = Settings.parse({ shared: { market: { brokerFeePct: 2 } } });
		expect(await decodeJson(await encodeSettings(s))).toEqual({
			v: 1,
			shared: { market: { brokerFeePct: 2 } }
		});
		expect((await encodeSettings(s)).length).toBeLessThan((await encodeJson(s)).length / 4);
	});

	it('decodes legacy full-object payloads', async () => {
		const s = Settings.parse({ mode: 'per_reactor', reactors: { hybrid: { structure: 'athanor' } } });
		expect(await decodeSettings(await encodeJson(s))).toEqual(s);
	});

	it('decodes payloads saved before the shipping discount existed with a 0 % discount', async () => {
		const legacyShipping = { enabled: true, iskPerM3: 900, collateralPct: 1 };
		const withShipping = Settings.parse({ shared: { shipping: { input: legacyShipping } } });
		// Full object as written by the release before `discountPct`: the field is absent everywhere.
		const legacyFull: unknown = JSON.parse(
			JSON.stringify(withShipping, (key, value: unknown) => (key === 'discountPct' ? undefined : value))
		);
		expect(JSON.stringify(legacyFull)).not.toContain('discountPct');
		const fromFull = await decodeSettings(await encodeJson(legacyFull));
		const fromDiff = await decodeSettings(
			await encodeJson({ v: 1, shared: { shipping: { input: legacyShipping } } })
		);
		for (const decoded of [fromFull, fromDiff]) {
			expect(decoded).toEqual(withShipping);
			expect(decoded?.shared.shipping.input).toEqual({ ...legacyShipping, discountPct: 0 });
			expect(decoded?.reactors.composite.shipping.output.discountPct).toBe(0);
		}
	});

	it('decodes payloads saved before the input fallback hub existed with Jita and omits the default', async () => {
		const s = Settings.parse({ shared: { market: { inputHub: 'structure-1' } } });
		const legacyFull: unknown = JSON.parse(
			JSON.stringify(s, (key, value: unknown) => (key === 'inputFallbackHub' ? undefined : value))
		);
		const decoded = await decodeSettings(await encodeJson(legacyFull));
		expect(decoded?.shared.market.inputFallbackHub).toBe('jita');
		expect(decoded?.reactors.hybrid.market.inputFallbackHub).toBe('jita');
		expect(await decodeJson(await encodeSettings(s))).toEqual({
			v: 1,
			shared: { market: { inputHub: 'structure-1' } }
		});
		const amarr = Settings.parse({ shared: { market: { inputFallbackHub: 'amarr' } } });
		expect(settingsDiff(amarr)).toEqual({ shared: { market: { inputFallbackHub: 'amarr' } } });
	});

	it('merges a diff made against older defaults onto the current defaults', async () => {
		// Simulated earlier release whose default broker fee was 3 %: a visitor who only changed the
		// structure gets today's 1.5 % default after decoding, and keeps the structure override.
		const oldDefaults = Settings.parse({ shared: { market: { brokerFeePct: 3 } } });
		const visitor = Settings.parse({ shared: { structure: 'athanor', market: { brokerFeePct: 3 } } });
		const diff = settingsDiff(visitor, oldDefaults);
		expect(diff).toEqual({ shared: { structure: 'athanor' } });
		const decoded = await decodeSettings(await encodeJson({ v: 1, ...diff }));
		expect(decoded?.shared.structure).toBe('athanor');
		expect(decoded?.shared.market.brokerFeePct).toBe(1.5);
		expect(decoded).toEqual(Settings.parse({ shared: { structure: 'athanor' } }));
	});
});

describe('settingsDiff', () => {
	it('is empty for the defaults', () => {
		expect(settingsDiff(DEFAULT_SETTINGS)).toEqual({});
		expect(settingsDiff(Settings.parse({}))).toEqual({});
		expect(isDefaultSettings(Settings.parse({ shared: { structure: 'tatara' } }))).toBe(true);
	});

	it('omits the default 0 % shipping discount and keeps a changed one', () => {
		const s = Settings.parse({ shared: { shipping: { input: { enabled: true, discountPct: 0 } } } });
		expect(settingsDiff(s)).toEqual({ shared: { shipping: { input: { enabled: true } } } });
		const discounted = Settings.parse({ shared: { shipping: { output: { discountPct: 15 } } } });
		expect(settingsDiff(discounted)).toEqual({ shared: { shipping: { output: { discountPct: 15 } } } });
	});

	it('omits the default single slot allocation and keeps optimal', () => {
		expect(settingsDiff(Settings.parse({ slotAllocation: 'single' }))).toEqual({});
		const optimal = Settings.parse({ slotAllocation: 'optimal' });
		expect(settingsDiff(optimal)).toEqual({ slotAllocation: 'optimal' });
		expect(Settings.parse(settingsDiff(optimal))).toEqual(optimal);
	});

	it('omits the default max parallel lines and keeps a raised cap', () => {
		expect(settingsDiff(Settings.parse({ maxParallelLines: 4 }))).toEqual({});
		expect(settingsDiff(Settings.parse({ maxParallelLines: 10 }))).toEqual({ maxParallelLines: 10 });
	});

	it('keeps only the changed nested leaf', () => {
		const s = Settings.parse({ reactors: { composite: { shipping: { input: { iskPerM3: 750 } } } } });
		expect(settingsDiff(s)).toEqual({ reactors: { composite: { shipping: { input: { iskPerM3: 750 } } } } });
		expect(isDefaultSettings(s)).toBe(false);
	});

	it('records nullable and top-level changes', () => {
		const s = Settings.parse({ cycleDays: 3, shared: { costIndexOverridePct: 0 } });
		expect(settingsDiff(s)).toEqual({ cycleDays: 3, shared: { costIndexOverridePct: 0 } });
	});

	it('round-trips arbitrary settings through the diff', () => {
		const s = Settings.parse({
			mode: 'per_reactor',
			shared: { market: { outputMethod: 'contract', outputContractBasis: 'buy' } },
			reactors: { biochemical: { reactionsSkill: 3, systemId: 30004604 } },
			reprocessing: { prismaticiteRollPct: 25 }
		});
		expect(Settings.parse(settingsDiff(s))).toEqual(s);
	});
});

describe('profileFor', () => {
	it('uses the shared profile in shared mode and the reactor profile otherwise', () => {
		const s = Settings.parse({
			shared: { structure: 'athanor' },
			reactors: { composite: { structure: 'tatara', meRig: 't1' } }
		});
		expect(profileFor(s, 'composite').structure).toBe('athanor');
		const perReactor = { ...s, mode: 'per_reactor' as const };
		expect(profileFor(perReactor, 'composite')).toMatchObject({ structure: 'tatara', meRig: 't1' });
		expect(profileFor(perReactor, 'hybrid').meRig).toBe('t2');
	});
});
