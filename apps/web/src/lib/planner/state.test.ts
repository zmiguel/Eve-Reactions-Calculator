import { DEFAULT_SETTINGS, Settings, decodeJson, encodeJson } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../test/storage';
import {
	STORAGE_KEY,
	decodeShare,
	emptyState,
	encodeShare,
	loadState,
	parseState,
	saveState,
	type PlannerState
} from './state';

const sample: PlannerState = {
	v: 1,
	slots: 150,
	cycleDays: 5,
	targets: [
		{ blueprintTypeId: 46205, lines: 2 },
		{ blueprintTypeId: 46209, lines: 1, quantity: 35_280_000 }
	],
	buy: [16659],
	stockText: 'Cobalt\t12,345',
	formulasText: 'Carbon Polymers Reaction Formula\t1',
	maxVolumePct: 15,
	fillScope: 'composite_buy'
};

/** A v1 state saved before quantity targets, the volume cap and auto-fill scopes existed. */
const firstRelease = {
	v: 1,
	slots: 150,
	cycleDays: null,
	targets: [{ blueprintTypeId: 46205, lines: 2 }],
	buy: [],
	stockText: '',
	formulasText: ''
};

describe('state schema', () => {
	it('reads first-release v1 states with the new fields defaulted', () => {
		expect(parseState(firstRelease)).toEqual({ ...firstRelease, maxVolumePct: 10, fillScope: 'all' });
		const storage = new MemoryStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify(firstRelease));
		expect(loadState(storage).targets).toEqual([{ blueprintTypeId: 46205, lines: 2 }]);
	});

	it('rejects out-of-range caps, unknown scopes and non-positive quantities', () => {
		expect(parseState({ ...sample, maxVolumePct: 0 })).toBeNull();
		expect(parseState({ ...sample, maxVolumePct: 101 })).toBeNull();
		expect(parseState({ ...sample, fillScope: 'everything' })).toBeNull();
		expect(
			parseState({ ...sample, targets: [{ blueprintTypeId: 46205, lines: 1, quantity: 0 }] })
		).toBeNull();
	});
});

describe('localStorage persistence', () => {
	it('saves under planner:v1 and loads the same state back', () => {
		const storage = new MemoryStorage();
		saveState(storage, sample);
		expect([...storage.items.keys()]).toEqual([STORAGE_KEY]);
		expect(STORAGE_KEY).toBe('planner:v1');
		expect(loadState(storage)).toEqual(sample);
	});

	it('loads the empty state when nothing is stored or storage is unavailable', () => {
		expect(loadState(new MemoryStorage())).toEqual(emptyState());
		expect(loadState(undefined)).toEqual(emptyState());
		const throwing = {
			getItem: () => {
				throw new Error('SecurityError');
			}
		};
		expect(loadState(throwing)).toEqual(emptyState());
	});

	it('loads the empty state for another version or garbage', () => {
		const storage = new MemoryStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify({ ...sample, v: 2 }));
		expect(loadState(storage)).toEqual(emptyState());
		storage.setItem(STORAGE_KEY, '{not json');
		expect(loadState(storage)).toEqual(emptyState());
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({ ...sample, targets: [{ blueprintTypeId: 46205, lines: 0 }] })
		);
		expect(loadState(storage)).toEqual(emptyState());
	});

	it('ignores storage write errors', () => {
		const full = {
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(() => saveState(full, sample)).not.toThrow();
	});

	it('the empty state has no targets and one character’s slots', () => {
		expect(emptyState()).toEqual({
			v: 1,
			slots: 11,
			cycleDays: null,
			targets: [],
			buy: [],
			stockText: '',
			formulasText: '',
			maxVolumePct: 10,
			fillScope: 'all'
		});
	});
});

describe('share codec', () => {
	it('round-trips a state through a URL-safe code', async () => {
		const code = await encodeShare(sample);
		expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(await decodeShare(code)).toEqual({ state: sample, settings: null });
	});

	it('carries the sharer’s settings as the sparse diff and restores them', async () => {
		const settings = Settings.parse({ cycleDays: 3, shared: { structure: 'athanor' } });
		const code = await encodeShare(sample, settings);
		expect(await decodeJson(code)).toEqual({
			...sample,
			settings: { v: 1, cycleDays: 3, shared: { structure: 'athanor' } }
		});
		expect(await decodeShare(code)).toEqual({ state: sample, settings });
		expect((await decodeShare(await encodeShare(sample, DEFAULT_SETTINGS)))?.settings).toEqual(
			DEFAULT_SETTINGS
		);
	});

	it('opens links from before settings were shared, with no settings', async () => {
		expect(await decodeShare(await encodeJson(firstRelease))).toEqual({
			state: { ...firstRelease, maxVolumePct: 10, fillScope: 'all' },
			settings: null
		});
	});

	it('keeps the plan and drops invalid settings', async () => {
		for (const settings of [{ cycleDays: -1 }, { shared: { structure: 'castle' } }, 'athanor', null, [1]])
			expect(await decodeShare(await encodeJson({ ...sample, settings }))).toEqual({
				state: sample,
				settings: null
			});
	});

	it('returns null for garbage, invalid states and other versions', async () => {
		expect(await decodeShare('not a share code!')).toBeNull();
		expect(await decodeShare('AAAA')).toBeNull();
		expect(await decodeShare('')).toBeNull();
		expect(await decodeShare(await encodeJson({ hello: 'world' }))).toBeNull();
		expect(await decodeShare(await encodeJson({ ...sample, v: 2 }))).toBeNull();
		expect(await decodeShare(await encodeJson({ ...sample, slots: -1 }))).toBeNull();
	});

	it('parseState rejects non-objects', () => {
		expect(parseState(null)).toBeNull();
		expect(parseState('planner')).toBeNull();
		expect(parseState(sample)).toEqual(sample);
	});
});
