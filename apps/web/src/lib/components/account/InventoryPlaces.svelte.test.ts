import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { InventoryPlaceView } from '$lib/inventory/types';
import InventoryPlaces from './InventoryPlaces.svelte';

const JITA = 60003760;
const STRUCTURE = 1044752365771;

const places: InventoryPlaceView[] = [
	{
		locationId: JITA,
		kind: 'station',
		name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
		systemName: 'Jita',
		buckets: [
			{ bucket: 'div1', label: 'Reactions', selected: true, formulas: 2, materials: 5 },
			{ bucket: 'div3', label: 'Division 3', selected: false, formulas: 0, materials: 1 },
			{ bucket: 'deliveries', label: 'Deliveries', selected: false, formulas: 1, materials: 0 },
			{ bucket: 'jobs', label: 'Industry jobs', selected: false, formulas: 1, materials: 0 }
		]
	},
	{
		locationId: STRUCTURE,
		kind: 'structure',
		name: null,
		systemName: 'Perimeter',
		buckets: [{ bucket: 'hangar', label: 'Hangar', selected: true, formulas: 0, materials: 0 }]
	}
];

function renderPlaces(list = places) {
	return render(InventoryPlaces, { props: { sourceId: 7, characterName: 'Seed Pilot', places: list } });
}

describe('InventoryPlaces', () => {
	it('renders division names, the "Division N" fallback and counts per bucket', () => {
		const { container } = renderPlaces();
		const jita = container.querySelector(`tr[data-place="${JITA}"]`)!;
		expect(jita.textContent).toContain('Jita IV - Moon 4 - Caldari Navy Assembly Plant');
		expect(jita.textContent).toContain('Jita');
		const buckets = [...jita.querySelectorAll('label[data-bucket]')].map((l) => [
			l.getAttribute('data-bucket'),
			l.querySelector('span')?.textContent,
			l.querySelector('[data-counts]')?.textContent
		]);
		expect(buckets).toEqual([
			['div1', 'Reactions', '2 formulas, 5 materials'],
			['div3', 'Division 3', '1 material'],
			['deliveries', 'Deliveries', '1 formula'],
			['jobs', 'Industry jobs', '1 formula']
		]);
		expect(container.querySelector(`tr[data-place="${STRUCTURE}"] [data-counts]`)?.textContent).toBe(
			'Nothing found'
		);
	});

	it('names unknown structures by id with the docking hint', () => {
		const { container } = renderPlaces();
		const row = container.querySelector(`tr[data-place="${STRUCTURE}"]`)!;
		expect(row.textContent).toContain(`Structure ${STRUCTURE}`);
		expect(row.textContent).toContain('Perimeter');
		expect(row.querySelector('[data-no-dock]')?.textContent).toBe(
			'Seed Pilot cannot dock here, so its name is unknown.'
		);
		expect(container.querySelector(`tr[data-place="${JITA}"] [data-no-dock]`)).toBeNull();
	});

	it('posts one checkbox per bucket to ?/select with Save, Select all and Select none', () => {
		const { container } = renderPlaces();
		const form = container.querySelector('form')!;
		expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual(['POST', '?/select']);
		expect((form.querySelector('input[name="sourceId"]') as HTMLInputElement).value).toBe('7');
		const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		expect(boxes.map((b) => [b.name, b.value, b.checked])).toEqual([
			['place', `${JITA}:div1`, true],
			['place', `${JITA}:div3`, false],
			['place', `${JITA}:deliveries`, false],
			['place', `${JITA}:jobs`, false],
			['place', `${STRUCTURE}:hangar`, true]
		]);
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		const all = screen.getByRole('button', { name: 'Select all' }) as HTMLButtonElement;
		const none = screen.getByRole('button', { name: 'Select none' }) as HTMLButtonElement;
		expect([save.type, save.name]).toEqual(['submit', '']);
		expect([all.type, all.name, all.value]).toEqual(['submit', 'mode', 'all']);
		expect([none.type, none.name, none.value]).toEqual(['submit', 'mode', 'none']);
		expect(form.contains(all) && form.contains(none) && form.contains(save)).toBe(true);
	});

	it('says so when no place holds anything relevant', () => {
		const { container } = renderPlaces([]);
		expect(container.querySelector('form')).toBeNull();
		expect(container.querySelector('[data-no-places]')).not.toBeNull();
	});
});
