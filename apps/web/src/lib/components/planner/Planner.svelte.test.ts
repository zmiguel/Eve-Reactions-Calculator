import {
	STOCK_PLAN_MAX_CYCLES,
	Settings,
	isFuelBlock,
	planFromStock,
	type StockPlan
} from '@reactions/engine';
import type * as Engine from '@reactions/engine';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserInventory } from '#lib/server/inventory.js';
import { plannerContext } from '#lib/planner/plan.js';
import { STORAGE_KEY, decodeShare, emptyState, encodeShare, type PlannerState } from '#lib/planner/state.js';
import type { StockPlanner } from '#lib/planner/stockPlanner.js';
import { plannerData } from '../../../test/planner';
import { MemoryStorage } from '../../../test/storage';
import { resetNavigation, shallowUrls } from '../../../test/shims/app/navigation';
import { resetPage, setPage } from '../../../test/shims/app/state';
import Planner from './Planner.svelte';

vi.mock('@reactions/engine', async (importOriginal) => {
	const engine = await importOriginal<typeof Engine>();
	return { ...engine, planFromStock: vi.fn(engine.planFromStock) };
});
const lastStockInput = () => vi.mocked(planFromStock).mock.lastCall?.[0];

const CRYSTALLINE_CARBONIDE = 46205;
const CARBON_POLYMERS = 16659;
const COBALT = 16640;

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

const inventory = (): UserInventory => ({
	stock: { [COBALT]: 1000 },
	formulas: { [CRYSTALLINE_CARBONIDE]: 2 },
	sources: [
		{
			sourceId: 1,
			ownerName: 'Alpha',
			kind: 'character',
			status: 'ok',
			lastSyncedAt: Date.UTC(2026, 9, 6, 12, 5),
			dataAsOf: Date.UTC(2026, 9, 6, 12)
		}
	],
	oldestSyncAt: Date.UTC(2026, 9, 6, 12, 5)
});

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

	it('shopping list for N cycles: the cycles input extends it, the toggle stops subtracting the stock', async () => {
		// Crystallite Alloy buys 11,976 Cobalt per cycle (cycles 1 and 2 of the start-up, then every cycle).
		const storage = stored(stateWith({ stockText: 'Cobalt\t20,000' }));
		const { container } = await setup(storage);
		const shopping = () => container.querySelector('[data-plan-shopping]')!;
		const cobalt = () => {
			const row = shopping().querySelector(`tr[data-type-id="${COBALT}"]`);
			return row ? Number(text(row.children[1]).replace(/,/g, '')) : null;
		};
		const cycles = screen.getByRole('spinbutton', { name: 'Cycles' }) as HTMLInputElement;
		expect(cycles.value).toBe('2');
		expect(text(shopping().querySelector('h3'))).toBe('Shopping list for 2 cycles');
		expect(cobalt()).toBe(2 * 11_976 - 20_000);

		await fireEvent.change(cycles, { target: { value: '4' } });
		expect(text(shopping().querySelector('h3'))).toBe('Shopping list for 4 cycles');
		expect(cobalt()).toBe(4 * 11_976 - 20_000);
		expect(listQuantity(container, 'Shopping list per cycle', COBALT)).toBe(11_976);

		const toggle = screen.getByRole('checkbox', { name: 'Subtract my stock' }) as HTMLInputElement;
		expect(toggle.checked).toBe(true);
		await fireEvent.click(toggle);
		expect(toggle.checked).toBe(false);
		expect(cobalt()).toBe(4 * 11_976);
		// The start-up tables keep subtracting it.
		expect(startupQuantity(container, COBALT)).toBe(2 * 11_976 - 20_000);
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({
			shoppingCycles: 4,
			shoppingUseStock: false
		});
	});

	it('no stock toggle without stock the plan uses', async () => {
		await setup(stored(stateWith({ stockText: 'Caesarium Cadmide\t5' })));
		expect(screen.getByRole('spinbutton', { name: 'Cycles' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: 'Subtract my stock' })).toBeNull();
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
		// The scope limits every reaction auto-fill adds, slot-time top-ups included.
		const tiers = saved.targets.map(
			(t) => dataset.reactions.find((r) => r.blueprintTypeId === t.blueprintTypeId)!.tier
		);
		expect(saved.targets.length).toBeGreaterThan(1);
		// Started with no targets: every target is one auto-fill added.
		for (const target of saved.targets) expect(target.auto).toBe(true);
		expect(new Set(tiers)).toEqual(new Set(['composite']));
		// One output row per product, with its whole share of the region's volume within the cap.
		const shares = [...container.querySelectorAll('[data-output] [data-field="volumeShare"]')].map((c) =>
			parseFloat(text(c))
		);
		expect(shares.length).toBe(new Set(saved.targets.map((t) => t.blueprintTypeId)).size);
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
		for (const row of container.querySelectorAll<HTMLElement>('[data-plan-reaction]'))
			expect(row.dataset.depth).toBe('0');
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

	it('"Shared slots" packs leftover runs into shared slots only when chosen, and keeps the choice', async () => {
		// 150 Crystalline Carbonide runs (126 + 24) and 74 runs each of its two intermediates: the 24-run
		// job fits next to one intermediate's 74 runs.
		const storage = stored(
			stateWith({ targets: [{ blueprintTypeId: CRYSTALLINE_CARBONIDE, lines: 1, quantity: 1_500_000 }] })
		);
		const { container } = await setup(storage);
		const shared = () => container.querySelectorAll('[data-shared-slot]').length;
		// "With auto-fill" (the default) shares nothing without auto-fill targets.
		expect([slotsUsed(container), shared()]).toEqual(['4 / 150', 0]);

		await fireEvent.click(screen.getByRole('button', { name: 'Always' }));
		expect([slotsUsed(container), shared()]).toEqual(['3 / 150', 1]);
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!).slotSharing).toBe('always');

		await fireEvent.click(screen.getByRole('button', { name: 'Never' }));
		expect([slotsUsed(container), shared()]).toEqual(['4 / 150', 0]);
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
		expect(shallowUrls).toEqual([]);

		await fireEvent.click(screen.getByRole('button', { name: 'Buy Carbon Polymers' }));
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(stateWith({ buy: [CARBON_POLYMERS] }));
		expect(shallowUrls).toEqual(['http://localhost/planner?inputsDaysAgo=2']);
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

	it('"My inventory" replaces the paste boxes with a summary and plans with the inventory', async () => {
		const pasted = await setup(stored(stateWith({})));
		const pastedCobalt = startupQuantity(pasted.container, COBALT);
		pasted.unmount();

		const storage = stored(stateWith({ stockText: 'Cobalt\t5', formulasText: '' }));
		const { container } = await setup(storage, null, 150, plannerData({ inventory: inventory() }));
		expect(screen.getByRole('button', { name: 'My inventory' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('textbox', { name: 'Stock' })).toBeNull();
		expect(screen.queryByRole('textbox', { name: 'Owned formulas' })).toBeNull();
		const summary = container.querySelector('[data-inventory-summary]')!;
		expect(text(summary.querySelector('p'))).toBe(
			'1 material and 2 formulas from Alpha, synced 2026-10-06 12:05 UTC.'
		);
		expect(summary.querySelector('a')!.getAttribute('href')).toBe('/account/inventory');
		expect(startupQuantity(container, COBALT)).toBe(pastedCobalt - 1000);
		expect(container.querySelector('[data-formula="46205"]')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Pasted lists' }));
		expect(container.querySelector('[data-inventory-summary]')).toBeNull();
		expect((screen.getByRole('textbox', { name: 'Stock' }) as HTMLTextAreaElement).value).toBe('Cobalt\t5');
		expect(startupQuantity(container, COBALT)).toBe(pastedCobalt - 5);
		expect(container.querySelector('[data-formula="46205"]')).not.toBeNull();
		expect(JSON.parse(storage.getItem(STORAGE_KEY)!).stockSource).toBe('paste');
	});

	it('notes failed and old syncs of the inventory', async () => {
		const inv = inventory();
		inv.sources.push({ ...inv.sources[0], sourceId: 2, ownerName: 'Seed Corp', status: 'error' });
		inv.oldestSyncAt = Date.now() - 3 * 86_400_000;
		const { container } = await setup(stored(stateWith({})), null, 150, plannerData({ inventory: inv }));
		expect(text(container.querySelector('[data-inventory-summary] p'))).toContain('from Alpha, Seed Corp');
		expect(text(container.querySelector('[data-inventory-error]'))).toBe(
			'The last sync of Seed Corp failed; the items of the sync before are used.'
		);
		expect(container.querySelector('[data-inventory-stale]')).not.toBeNull();
	});

	it('share links keep the inventory as stock source but never carry the inventory', async () => {
		const writeText = vi.fn(async (_data: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await setup(stored(stateWith({})), null, 150, plannerData({ inventory: inventory() }));
		const button = screen.getByRole('button', { name: 'Share' });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		const code = new URL(writeText.mock.calls[0][0]).searchParams.get('s')!;
		expect((await decodeShare(code))?.state).toEqual(stateWith({ stockSource: 'account' }));
	});

	it('a shared plan using an inventory falls back to the pasted lists without one', async () => {
		const code = await encodeShare(stateWith({ stockSource: 'account', stockText: 'Cobalt\t1,000' }));
		const plain = await setup(new MemoryStorage(), await encodeShare(stateWith({})));
		const before = startupQuantity(plain.container, COBALT);
		expect(plain.container.querySelector('[data-inventory-fallback]')).toBeNull();
		plain.unmount();

		const { container } = await setup(new MemoryStorage(), code);
		expect(text(container.querySelector('[data-inventory-fallback]'))).toBe(
			'This plan takes stock and formulas from an account inventory, and you have no synced inventory here: your pasted lists are used instead.'
		);
		expect(screen.queryByRole('button', { name: 'My inventory' })).toBeNull();
		expect((screen.getByRole('textbox', { name: 'Stock' }) as HTMLTextAreaElement).value).toBe(
			'Cobalt\t1,000'
		);
		expect(startupQuantity(container, COBALT)).toBe(before - 1000);
	});
});

describe('Planner: Use what I have', () => {
	const storedState = (storage: MemoryStorage) => JSON.parse(storage.getItem(STORAGE_KEY)!) as PlannerState;
	beforeEach(() => {
		vi.mocked(planFromStock).mockClear();
	});

	it('the mode tabs swap the targets for the stock options and keep the targets', async () => {
		const storage = stored(stateWith({}));
		const { container } = await setup(storage);
		const targetsTab = screen.getByRole('button', { name: 'Plan targets' });
		expect(targetsTab.getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('heading', { name: 'Targets' })).not.toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Use what I have' }));
		expect(screen.queryByRole('heading', { name: 'Targets' })).toBeNull();
		expect(screen.getByRole('checkbox', { name: "Allow formulas I don't own" })).not.toBeNull();
		expect(screen.getByRole('textbox', { name: 'Stock' })).not.toBeNull();
		expect(container.querySelector('[data-results]')).toBeNull();
		expect(text(container.querySelector('[data-stock-status]'))).toBe('Planning…');
		expect(storedState(storage)).toMatchObject({ mode: 'stock', targets: stateWith({}).targets });

		await fireEvent.click(targetsTab);
		expect(screen.queryByRole('checkbox', { name: "Allow formulas I don't own" })).toBeNull();
		expect(slotsUsed(container)).toBe('4 / 150');
		expect(runReactions(container)).toContain('Crystalline Carbonide');
	});

	it('plans from the pasted stock with the chosen cycles, search time and formula option', async () => {
		const storage = stored(
			stateWith({
				mode: 'stock',
				slots: 11,
				stockText: 'Carbon Polymers\t20,000',
				formulasText: 'Crystalline Carbonide Reaction Formula\t2'
			})
		);
		await setup(storage, null, 11);
		await waitFor(() =>
			expect(lastStockInput()).toMatchObject({
				totalSlots: 11,
				stock: { [CARBON_POLYMERS]: 20_000 },
				ownedFormulas: { [CRYSTALLINE_CARBONIDE]: 2 },
				maxCycles: undefined,
				allowUnownedFormulas: false,
				timeLimitMs: 10_000
			})
		);
		const cycles = screen.getByRole('slider', { name: 'Cycles' }) as HTMLInputElement;
		expect([cycles.min, cycles.max]).toEqual(['1', String(STOCK_PLAN_MAX_CYCLES)]);
		// Unset: the slider sits on the engine's default for this stock, marked as the default.
		await waitFor(() => expect(screen.getByText('(default)')).toBeTruthy());

		await fireEvent.click(screen.getByRole('checkbox', { name: "Allow formulas I don't own" }));
		await waitFor(() => expect(lastStockInput()?.allowUnownedFormulas).toBe(true));
		await fireEvent.input(cycles, { target: { value: '2' } });
		await waitFor(() => expect(lastStockInput()?.maxCycles).toBe(2));
		const search = screen.getByRole('slider', { name: 'Search time' }) as HTMLInputElement;
		expect([search.min, search.max]).toEqual(['10', '60']);
		await fireEvent.input(search, { target: { value: '45' } });
		await waitFor(() => expect(lastStockInput()?.timeLimitMs).toBe(45_000));
		expect(storedState(storage)).toMatchObject({
			allowUnownedFormulas: true,
			stockCycles: 2,
			stockSearchSeconds: 45
		});

		await fireEvent.click(screen.getByRole('checkbox', { name: "Allow formulas I don't own" }));
		await waitFor(() => expect(lastStockInput()?.allowUnownedFormulas).toBe(false));
		await fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
		await waitFor(() => expect(lastStockInput()?.maxCycles).toBeUndefined());
	});

	it('shows each plan found so far, then the final one', async () => {
		const runs: { incumbent: (plan: StockPlan) => void; finish: (plan: StockPlan) => void }[] = [];
		const planStock: StockPlanner = (_input, _signal, onIncumbent) => {
			const { promise, resolve } = Promise.withResolvers<StockPlan>();
			runs.push({ incumbent: (plan) => onIncumbent?.(plan), finish: resolve });
			return promise;
		};
		const real = planFromStock({
			ctx: plannerContext(plannerData(), 7),
			totalSlots: 11,
			stock: { [CARBON_POLYMERS]: 20_000, 16655: 20_000 },
			ownedFormulas: { [CRYSTALLINE_CARBONIDE]: 2 }
		});
		const { container } = render(Planner, {
			props: { data: plannerData(), storage: stored(stateWith({ mode: 'stock' })), planStock }
		});
		await waitFor(() => expect(runs).toHaveLength(1));
		const status = () => text(container.querySelector('[data-stock-status]'));
		expect(status()).toBe('Planning…');
		expect(container.querySelector('[data-stock-results]')).toBeNull();

		runs[0].incumbent({ ...real, optimal: false });
		await waitFor(() => expect(container.querySelector('[data-stock-results]')).not.toBeNull());
		expect(status()).toBe('Looking for a better plan…');
		expect(container.querySelector('[data-stock-plan]')!.className).not.toMatch(/opacity-50/);
		expect(container.querySelector('[data-not-optimal]')).toBeNull();

		runs[0].finish({ ...real, optimal: false });
		await waitFor(() => expect(status()).toBe(''));
		expect(container.querySelector('[data-not-optimal]')).not.toBeNull();
	});

	it('turns pasted intermediates into the owned formula’s product, buying only fuel blocks', async () => {
		const { container } = await setup(
			stored(
				stateWith({
					mode: 'stock',
					slots: 11,
					stockText: 'Carbon Polymers\t20,000\nCrystallite Alloy\t20,000',
					formulasText: 'Crystalline Carbonide Reaction Formula\t2'
				})
			),
			null,
			11
		);
		await waitFor(() => expect(container.querySelector('[data-stock-results]')).not.toBeNull());
		const jobs = [...container.querySelectorAll('[data-stock-job]')].map((j) =>
			j.getAttribute('data-stock-job')
		);
		expect(jobs).toContain(String(CRYSTALLINE_CARBONIDE));
		expect(text(container.querySelector('[data-stock-status]'))).toBe('');
		const { dataset } = plannerData();
		const bought = [...container.querySelectorAll('[data-stock-fuel] tr[data-type-id]')].map((row) =>
			Number(row.getAttribute('data-type-id'))
		);
		expect(bought.length).toBeGreaterThan(0);
		for (const typeId of bought) expect(isFuelBlock(dataset, typeId)).toBe(true);
		expect(container.querySelector('[data-stock-formulas]')).toBeNull();
		expect(container.querySelector('[data-results]')).toBeNull();

		// A change keeps the plan on screen, dimmed, until the next one is ready.
		await fireEvent.input(screen.getByRole('slider', { name: 'Cycles' }), { target: { value: '1' } });
		const shown = container.querySelector('[data-stock-plan]')!;
		expect(shown.getAttribute('aria-busy')).toBe('true');
		expect(shown.querySelector('[data-stock-results]')).not.toBeNull();
		expect(text(container.querySelector('[data-stock-status]'))).toBe('Planning…');
		await waitFor(() => expect(shown.getAttribute('aria-busy')).toBe('false'));
		expect(lastStockInput()?.maxCycles).toBe(1);
	});

	it('share links carry the mode, cycles, search time and formula option', async () => {
		const writeText = vi.fn(async (_data: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const state = stateWith({
			mode: 'stock',
			allowUnownedFormulas: true,
			stockCycles: 3,
			stockSearchSeconds: 30
		});
		const sharer = await setup(stored(state));
		const button = screen.getByRole('button', { name: 'Share' });
		await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(button);
		const code = new URL(writeText.mock.calls[0][0]).searchParams.get('s')!;
		expect((await decodeShare(code))?.state).toEqual(state);
		sharer.unmount();

		await setup(new MemoryStorage(), code);
		expect(screen.getByRole('button', { name: 'Use what I have' }).getAttribute('aria-pressed')).toBe('true');
		expect((screen.getByRole('slider', { name: 'Cycles' }) as HTMLInputElement).value).toBe('3');
		expect((screen.getByRole('slider', { name: 'Search time' }) as HTMLInputElement).value).toBe('30');
		expect(
			(screen.getByRole('checkbox', { name: "Allow formulas I don't own" }) as HTMLInputElement).checked
		).toBe(true);
	});
});
