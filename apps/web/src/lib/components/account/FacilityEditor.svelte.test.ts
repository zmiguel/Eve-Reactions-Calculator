import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { FacilityRigChoice, FacilityView } from '$lib/account/facilities';
import {
	ATHANOR,
	M_COMPOSITE_RIG,
	M_COMPOSITE_RIG_II,
	TATARA,
	industryFixture
} from '../../../test/facilities';
import FacilityEditor from './FacilityEditor.svelte';

const industry = industryFixture();
const RIGS: FacilityRigChoice[] = industry.rigs.map((r) => ({
	typeId: r.typeId,
	name: r.name,
	rigSize: r.rigSize,
	groupId: r.groupId,
	fitsGroupIds: r.fitsGroupIds,
	activities: [...new Set(r.bonuses.map((b) => b.activity))]
}));
const REFINERIES = industry.structures
	.filter((s) => s.groupId === 1406)
	.map(({ typeId, name, groupId, rigSize, rigSlots }) => ({ typeId, name, groupId, rigSize, rigSlots }));

const facility = (overrides: Partial<FacilityView> = {}): FacilityView => ({
	facilityId: '101',
	name: 'Moon Factory',
	systemName: 'Ignoitton',
	band: 'lowsec',
	jobs: { reaction: 2, manufacturing: 0 },
	detectedStructure: null,
	detectedRigs: null,
	structures: REFINERIES,
	setting: { structureTypeId: ATHANOR, rigs: [M_COMPOSITE_RIG] },
	needs: { structure: false, rigs: false },
	bonus: [],
	reactionProfile: false,
	reactorDefault: null,
	...overrides
});

const renderEditor = (f: FacilityView, industryAvailable = true) =>
	render(FacilityEditor, { props: { facility: f, rigs: RIGS, industryAvailable } });

const selects = (container: Element) => [...container.querySelectorAll('select')];
const rigSelects = (container: Element) =>
	selects(container).filter((s) => s.hasAttribute('data-rig-select'));
const structureSelect = (container: Element) => selects(container).find((s) => s.name === 'structure-101');
const optionNames = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent?.trim());
const rigsFor = (container: Element) =>
	(container.querySelector('input[name="rigsFor-101"]') as HTMLInputElement | null)?.value ?? null;

describe('FacilityEditor', () => {
	it("offers one select per rig slot with only the rigs fitting the selected structure for the jobs' activity", async () => {
		const { container } = renderEditor(facility());
		await tick();
		const rigs = rigSelects(container);
		expect(rigs).toHaveLength(3);
		// The M-Set engineering rig fits other structures; the L-Set reactor rig a Tatara.
		for (const s of rigs)
			expect(optionNames(s)).toEqual([
				'Not set',
				'No rig',
				'Standup M-Set Composite Reactor Material Efficiency I',
				'Standup M-Set Composite Reactor Material Efficiency II'
			]);
		// Stored rigs: the rig, then empty slots.
		expect(rigs.map((s) => s.value)).toEqual([String(M_COMPOSITE_RIG), 'none', 'none']);
		expect(rigsFor(container)).toBe(String(ATHANOR));

		const structure = structureSelect(container)!;
		expect(optionNames(structure)).toEqual([
			'Not set',
			'Athanor',
			'Tatara',
			'NPC station or other (no bonus)'
		]);
		await fireEvent.change(structure, { target: { value: String(TATARA) } });
		expect(rigSelects(container).map(optionNames)[0]).toEqual([
			'Not set',
			'No rig',
			'Standup L-Set Reactor Efficiency II'
		]);
		// Another structure: nothing stored for it.
		expect(rigSelects(container).map((s) => s.value)).toEqual(['', '', '']);
		expect(rigsFor(container)).toBe(String(TATARA));

		await fireEvent.change(structure, { target: { value: '' } });
		expect(rigSelects(container)).toHaveLength(0);
		expect(rigsFor(container)).toBeNull();
		expect(container.querySelector('[data-rigs-after-structure]')).not.toBeNull();
	});

	it('offers one rig of each kind: a T1 in one slot rules its T2 (and itself) out of the others', async () => {
		const { container } = renderEditor(facility());
		await tick();
		const disabled = (s: HTMLSelectElement) =>
			[...s.options].filter((o) => o.disabled).map((o) => Number(o.value));
		let rigs = rigSelects(container);
		// Slot 1 holds the T1: slots 2 and 3 cannot take the T1 or the T2; slot 1 itself can switch.
		expect(disabled(rigs[0]!)).toEqual([]);
		expect(disabled(rigs[1]!)).toEqual([M_COMPOSITE_RIG, M_COMPOSITE_RIG_II]);
		expect(disabled(rigs[2]!)).toEqual([M_COMPOSITE_RIG, M_COMPOSITE_RIG_II]);
		// Emptying slot 1 frees the kind.
		await fireEvent.change(rigs[0]!, { target: { value: 'none' } });
		rigs = rigSelects(container);
		expect(rigs.map(disabled)).toEqual([[], [], []]);
	});

	it('shows what EVE told as plain text: the structure and the rigs read from corporation assets', () => {
		const { container } = renderEditor(
			facility({
				detectedStructure: { typeId: TATARA, name: 'Tatara' },
				detectedRigs: { names: ['Standup L-Set Reactor Efficiency II'], others: 1, readAt: null },
				setting: { structureTypeId: null, rigs: null },
				bonus: [
					{
						activity: 'reaction',
						label: 'Composite Reactions',
						reduction: 0.024,
						fromReactorSettings: false
					}
				]
			})
		);
		expect(container.querySelector('select, input')).toBeNull();
		expect(container.querySelector('[data-detected-structure]')?.textContent).toBe('Tatara');
		const rigs = container.querySelector('[data-detected-rigs]')!.textContent!.trim();
		expect(rigs).toBe('Standup L-Set Reactor Efficiency II');
		expect(container.querySelector('[data-rigs]')?.textContent).toContain('1 rig without a material bonus');
		expect(container.querySelector('[data-bonus]')?.textContent?.trim()).toBe(
			'Composite Reactions: 2.40% fewer materials'
		);
		expect(container.querySelector('[data-needs-input]')).toBeNull();
	});

	it('marks a facility needing input; without rig data, only the structure select', () => {
		const { container } = renderEditor(
			facility({
				name: null,
				systemName: null,
				band: null,
				setting: { structureTypeId: null, rigs: null },
				needs: { structure: true, rigs: false },
				reactionProfile: true
			}),
			false
		);
		expect(container.textContent).toContain('Unknown structure');
		expect(container.querySelector('[data-needs-input]')).not.toBeNull();
		expect(structureSelect(container)?.value).toBe('');
		expect(container.querySelector('[data-rigs]')).toBeNull();
		expect(container.querySelector('[data-reaction-profile]')).not.toBeNull();
	});

	it('in the reactor settings system, unknown structure and rigs come from the reactor settings', () => {
		const { container } = renderEditor(
			facility({
				setting: { structureTypeId: null, rigs: null },
				reactorDefault: { structure: 'Tatara', meRig: 't2' },
				bonus: [
					{ activity: 'reaction', label: 'Composite Reactions', reduction: 0.024, fromReactorSettings: true }
				]
			})
		);
		expect(container.querySelector('[data-needs-input]')).toBeNull();
		expect(structureSelect(container)?.selectedOptions[0]?.textContent?.trim()).toBe(
			'Reactor settings (Tatara)'
		);
		expect(container.querySelector('[data-default-rigs]')?.textContent).toBe('Reactor settings (T2 ME rig)');
		expect(container.querySelector('[data-bonus]')?.textContent?.trim()).toBe(
			'Composite Reactions: 2.40% fewer materials (your reactor settings)'
		);
	});

	it('with a detected structure, empty rig slots read "Reactor settings" until rigs are picked', () => {
		const { container } = renderEditor(
			facility({
				detectedStructure: { typeId: TATARA, name: 'Tatara' },
				setting: { structureTypeId: null, rigs: null },
				reactorDefault: { structure: 'Tatara', meRig: 't1' }
			})
		);
		const rigs = rigSelects(container);
		expect(rigs.map((s) => s.value)).toEqual(['', '', '']);
		expect(rigs.map((s) => s.selectedOptions[0]?.textContent?.trim())).toEqual([
			'Reactor settings',
			'Reactor settings',
			'Reactor settings'
		]);
		expect(container.querySelector('[data-rigs]')?.textContent).toContain('reactor settings (T1 ME rig)');
	});
});
