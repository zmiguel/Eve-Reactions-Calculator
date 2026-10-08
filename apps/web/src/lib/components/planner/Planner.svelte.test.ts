import { Settings } from '@reactions/engine';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, decodeShare, emptyState, encodeShare, type PlannerState } from '$lib/planner/state';
import { plannerData } from '../../../test/planner';
import { replaceStateCalls, resetNavigation } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Planner from './Planner.svelte';

const CRYSTALLINE_CARBONIDE = 46205;
const CARBON_POLYMERS = 16659;
const COBALT = 16640;

class MemoryStorage {
	items = new Map<string, string>();
	getItem(key: string) {
		return this.items.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.items.set(key, value);
	}
}

afterEach(() => {
	resetNavigation();
	resetPage();
});

const stateWith = (overrides: Partial<PlannerState>): PlannerState => ({
	...emptyState(),
	slots: 150,
	targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 2 }],
	...overrides
});

function stored(state: PlannerState) {
	const storage = new MemoryStorage();
	storage.setItem(STORAGE_KEY, JSON.stringify(state));
	return storage;
}

/** Renders the planner and waits for the client-side load (stored or shared plan) to apply. */
async function setup(storage: MemoryStorage, share: string | null = null, slots = 150, data = plannerData()) {
	const view = render(Planner, { props: { data, share, storage } });
	await waitFor(() => expect((screen.getByLabelText('Slots') as HTMLInputElement).value).toBe(String(slots)));
	return view;
}

const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();
const slotsUsed = (c: HTMLElement) => text(c.querySelector('[data-field="slotsUsed"]'));
const runReactions = (c: HTMLElement) =>
	[...c.querySelectorAll('[data-plan-reaction] [data-field="name"]')].map((e) => text(e));
const listQuantity = (c: HTMLElement, list: string, typeId: number) => {
	const row = c.querySelector(`section[aria-label^="${list}"] tr[data-type-id="${typeId}"]`);
	return row ? Number(text(row.children[1]).replace(/,/g, '')) : null;
};
/** Units of a type over every start-up list (stock is taken from the first cycles). */
const startupQuantity = (c: HTMLElement, typeId: number) =>
	[...c.querySelectorAll(`[data-plan-startup] tr[data-type-id="${typeId}"]`)].reduce(
		(acc, row) => acc + Number(text(row.children[1]).replace(/,/g, '')),
		0
	);

describe('Planner', () => {
	it('loads the stored plan and computes it with the client engine', async () => {
		const { container } = await setup(stored(stateWith({})));
		expect(slotsUsed(container)).toBe('4 / 150');
		expect(runReactions(container)).toEqual([
			'Crystalline Carbonide',
			'Carbon Polymers',
			'Crystallite Alloy'
		]);
		expect([...container.querySelectorAll('[data-phase]')].map((p) => text(p))).toEqual([
			'Cycle 1 2 slots · build-up',
			'Cycle 2+ 4 slots · steady'
		]);
	});

	it('Build/Buy: buying an intermediate removes its reaction and adds it to the purchases', async () => {
		const storage = stored(stateWith({}));
		const { container } = await setup(storage);
		expect(listQuantity(container, 'Shopping list per cycle', CARBON_POLYMERS)).toBeNull();
		expect(screen.getByRole('button', { name: 'Build Carbon Polymers' }).getAttribute('aria-pressed')).toBe(
			'true'
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Buy Carbon Polymers' }));
		expect(runReactions(container)).toEqual(['Crystalline Carbonide', 'Crystallite Alloy']);
		expect(slotsUsed(container)).toBe('3 / 150');
		expect(listQuantity(container, 'Shopping list per cycle', CARBON_POLYMERS)).toBeGreaterThan(0);
		// The final reaction buys it, from its first cycle (2) on.
		expect(listQuantity(container, 'Cycle 1, start-up', CARBON_POLYMERS)).toBeNull();
		expect(listQuantity(container, 'Cycle 2, first steady cycle', CARBON_POLYMERS)).toBeGreaterThan(0);
		expect(screen.getByRole('button', { name: 'Buy Carbon Polymers' }).getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!).buy).toEqual([CARBON_POLYMERS]);

		await fireEvent.click(screen.getByRole('button', { name: 'Build Carbon Polymers' }));
		expect(runReactions(container)).toContain('Carbon Polymers');
		expect(listQuantity(container, 'Shopping list per cycle', CARBON_POLYMERS)).toBeNull();
	});

	it('pasted stock reduces the first start-up purchases and reports unknown names', async () => {
		const { container } = await setup(stored(stateWith({})));
		const before = startupQuantity(container, COBALT);
		const firstCycle = listQuantity(container, 'Cycle 1, start-up', COBALT)!;
		const recurring = text(container.querySelector('[data-metric="Recurring / cycle"] dd'));

		await fireEvent.input(screen.getByRole('textbox', { name: 'Stock' }), {
			target: { value: 'Cobalt\t1,000\nUnobtainium\t5' }
		});
		expect(startupQuantity(container, COBALT)).toBe(before - 1000);
		expect(listQuantity(container, 'Cycle 1, start-up', COBALT)).toBe(firstCycle - 1000);
		expect(text(container.querySelector('[data-metric="Recurring / cycle"] dd'))).toBe(recurring);
		expect(text(screen.getByRole('list', { name: 'Stock errors' }))).toBe(
			'Line 2: “Unobtainium” is not a known item'
		);
	});

	it('owned formulas are not bought', async () => {
		const { container } = await setup(stored(stateWith({})));
		expect(container.querySelector('[data-formula="46205"]')).not.toBeNull();
		await fireEvent.input(screen.getByRole('textbox', { name: 'Owned formulas' }), {
			target: { value: 'Crystalline Carbonide Reaction Formula\t2' }
		});
		expect(container.querySelector('[data-formula="46205"]')).toBeNull();
	});

	it('auto-fill adds lines up to the slot limit without exceeding it', async () => {
		const { container } = await setup(stored(stateWith({ slots: 20, targets: [] })), null, 20);
		expect(container.querySelector('[data-results]')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Auto-fill best' }));
		const [used, total] = slotsUsed(container).split(' / ').map(Number);
		expect(total).toBe(20);
		expect(used).toBeGreaterThan(0);
		expect(used).toBeLessThanOrEqual(20);
		expect(container.querySelector('[data-warning="SLOTS_EXCEEDED"]')).toBeNull();
	}, 15_000);

	it('auto-fill honours the chosen scope and the daily-volume cap', async () => {
		const dataset = plannerData().dataset;
		const volumes = {
			10000002: Object.fromEntries(dataset.reactions.map((r) => [r.product.typeId, 3_000_000]))
		};
		const storage = stored(stateWith({ targets: [], fillScope: 'composite_chains', maxVolumePct: 10 }));
		const { container } = await setup(storage, null, 150, plannerData({ volumes }));
		expect(screen.getByRole('button', { name: 'Auto-fill picks: Composite chains' })).toBeTruthy();
		expect((screen.getByLabelText(/max share of daily volume/) as HTMLInputElement).value).toBe('10');

		await fireEvent.click(screen.getByRole('button', { name: 'Auto-fill best' }));
		const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as PlannerState;
		const tiers = saved.targets.map(
			(t) => dataset.reactions.find((r) => r.blueprintTypeId === t.blueprintTypeId)!.tier
		);
		expect(saved.targets.length).toBeGreaterThan(1);
		expect(new Set(tiers)).toEqual(new Set(['composite']));
		const shares = [...container.querySelectorAll('[data-output] [data-field="volumeShare"]')].map((c) =>
			parseFloat(text(c))
		);
		expect(shares.length).toBe(saved.targets.length);
		for (const share of shares) expect(share).toBeLessThanOrEqual(10);
	}, 15_000);

	it('"Composites, buying intermediates" buys the intermediates of what it adds', async () => {
		// Volume data for every product and a 100 % cap: only the scope is under test here.
		const volumes = {
			10000002: Object.fromEntries(plannerData().dataset.reactions.map((r) => [r.product.typeId, 1e9]))
		};
		const storage = stored(
			stateWith({ slots: 10, targets: [], fillScope: 'composite_buy', maxVolumePct: 100 })
		);
		const { container } = await setup(storage, null, 10, plannerData({ volumes }));
		await fireEvent.click(screen.getByRole('button', { name: 'Auto-fill best' }));
		const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as PlannerState;
		expect(saved.buy.length).toBeGreaterThan(0);
		expect(slotsUsed(container)).toBe('10 / 10');
		// Every planned reaction is a final product: its intermediates are bought.
		for (const depth of container.querySelectorAll('[data-plan-reaction] td:nth-child(2)'))
			expect(text(depth)).toBe('0');
		const types = plannerData().dataset.types;
		for (const id of saved.buy)
			expect(screen.getByRole('button', { name: `Buy ${types[id].name}` }).getAttribute('aria-pressed')).toBe(
				'true'
			);
	}, 15_000);

	it('the volume cap is stored with the plan and kept within 1–100 %', async () => {
		const storage = stored(stateWith({}));
		await setup(storage);
		const cap = screen.getByLabelText(/max share of daily volume/) as HTMLInputElement;
		await fireEvent.change(cap, { target: { value: '25' } });
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!).maxVolumePct).toBe(25);
		await fireEvent.change(cap, { target: { value: '500' } });
		expect(cap.value).toBe('100');
		await fireEvent.change(cap, { target: { value: '0' } });
		expect(cap.value).toBe('1');
	});

	it('plans a quantity target: 35,280,000 Crystalline Carbonide per cycle', async () => {
		const { container } = await setup(
			stored(
				stateWith({ targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 35_280_000 }] })
			)
		);
		expect(slotsUsed(container)).toBe('56 / 150');
		expect(text(container.querySelector('[data-target-row="0"] [data-field="slots"]'))).toBe(
			'56 slots · 28 final'
		);
		expect(text(container.querySelector('[data-output="16670"] [data-field="perCycle"]'))).toBe('35,280,000');
	});

	it('the slot calculator sets the slots', async () => {
		await setup(stored(stateWith({})));
		await fireEvent.input(screen.getByRole('spinbutton', { name: 'Characters' }), { target: { value: '3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Use 33' }));
		expect((screen.getByLabelText('Slots') as HTMLInputElement).value).toBe('33');
	});

	it('opens a share link without overwriting the stored plan until the first edit', async () => {
		const mine = stateWith({ targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 3 }] });
		const storage = stored(mine);
		const code = await encodeShare(stateWith({}));
		setPage({ url: `http://localhost/planner?s=${code}&inputsDaysAgo=2` });
		const { container } = await setup(storage, code);
		expect(slotsUsed(container)).toBe('4 / 150');
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(mine);
		expect(replaceStateCalls).toEqual([]);

		await fireEvent.click(screen.getByRole('button', { name: 'Buy Carbon Polymers' }));
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(stateWith({ buy: [CARBON_POLYMERS] }));
		expect(replaceStateCalls).toEqual(['http://localhost/planner?inputsDaysAgo=2']);
	});

	it('falls back to the stored plan for an invalid share link', async () => {
		const { container } = await setup(stored(stateWith({})), 'garbage');
		expect(slotsUsed(container)).toBe('4 / 150');
		expect(container.textContent).toContain('The shared plan could not be opened');
	});

	it('share links carry the settings the plan is computed with', async () => {
		const writeText = vi.fn(async (_data: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const data = plannerData();
		data.settings = { ...data.settings, cycleDays: 2 };
		await setup(stored(stateWith({})), null, 150, data);
		const button = screen.getByRole('button', { name: 'Share' });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		const code = new URL(writeText.mock.calls[0][0]).searchParams.get('s')!;
		expect(await decodeShare(code)).toEqual({ state: stateWith({}), settings: data.settings });
	});

	it('a shared plan with other settings links to the visitor’s settings and the import preview', async () => {
		const code = await encodeShare(stateWith({}), Settings.parse({ cycleDays: 3 }));
		setPage({ url: `http://localhost/planner?s=${code}&inputsDaysAgo=2` });
		const sharedSettings = { planCode: 'PLAN', importCode: 'IMPORT' };
		const { container } = await setup(new MemoryStorage(), code, 150, plannerData({ sharedSettings }));
		const note = container.querySelector('[data-shared-settings]')!;
		expect(text(note)).toContain('This plan uses the settings it was shared with, which differ from yours.');
		expect(screen.getByRole('link', { name: 'Use my settings' }).getAttribute('href')).toBe(
			'/planner?s=PLAN&inputsDaysAgo=2'
		);
		expect(screen.getByRole('link', { name: 'Review these settings' }).getAttribute('href')).toBe(
			'/settings?import=IMPORT'
		);
		// Re-pricing inputs keeps the unedited shared plan and its settings.
		const hiddenShare = 'form input[type="hidden"][name="s"]';
		expect(container.querySelector<HTMLInputElement>(hiddenShare)?.value).toBe(code);
		// Once edited, the plan is the stored one: the visitor's settings open it without the link.
		await fireEvent.click(screen.getByRole('button', { name: 'Buy Carbon Polymers' }));
		expect(screen.getByRole('link', { name: 'Use my settings' }).getAttribute('href')).toBe(
			'/planner?inputsDaysAgo=2'
		);
		expect(container.querySelector(hiddenShare)).toBeNull();
	});

	it('no settings notice when the shared settings match', async () => {
		const code = await encodeShare(stateWith({}), plannerData().settings);
		const { container } = await setup(new MemoryStorage(), code);
		expect(container.querySelector('[data-shared-settings]')).toBeNull();
		expect(screen.queryByRole('link', { name: 'Use my settings' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Review these settings' })).toBeNull();
	});

	it('warns before a shared plan replaces a different stored plan', async () => {
		const mine = stateWith({ targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 3 }] });
		const code = await encodeShare(stateWith({}));
		setPage({ url: `http://localhost/planner?s=${code}` });
		const { container } = await setup(stored(mine), code);
		expect(text(container.querySelector('[data-shared-plan]'))).toContain(
			'Editing this shared plan replaces your saved plan.'
		);
		expect(screen.getByRole('link', { name: 'Open my saved plan' }).getAttribute('href')).toBe('/planner');
		await fireEvent.click(screen.getByRole('button', { name: 'Buy Carbon Polymers' }));
		expect(container.querySelector('[data-shared-plan]')).toBeNull();
	});

	it('no replace warning when nothing is stored or the stored plan is the shared one', async () => {
		const code = await encodeShare(stateWith({}));
		for (const storage of [new MemoryStorage(), stored(stateWith({}))]) {
			const { container, unmount } = await setup(storage, code);
			expect(container.querySelector('[data-shared-plan]')).toBeNull();
			unmount();
		}
	});
});
