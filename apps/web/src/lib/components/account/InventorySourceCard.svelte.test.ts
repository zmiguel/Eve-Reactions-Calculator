import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { InventorySourceView } from '$lib/inventory/types';
import InventorySourceCard from './InventorySourceCard.svelte';

const base: InventorySourceView = {
	sourceId: 3,
	kind: 'character',
	ownerName: 'Seed Pilot',
	characterId: 90000001,
	characterName: 'Seed Pilot',
	otherReaders: [],
	status: 'ok',
	lastError: null,
	lastSyncedAt: Date.UTC(2026, 9, 6, 12, 5),
	dataAsOf: Date.UTC(2026, 9, 6, 12),
	places: [
		{
			locationId: 60003760,
			kind: 'station',
			name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
			systemName: 'Jita',
			buckets: [{ bucket: 'hangar', label: 'Hangar', selected: true, formulas: 1, materials: 2 }]
		}
	]
};

function renderCard(source: Partial<InventorySourceView> = {}) {
	return render(InventorySourceCard, { props: { source: { ...base, ...source } } });
}

const status = (container: HTMLElement) => container.querySelector('[data-status]')?.textContent?.trim();

describe('InventorySourceCard', () => {
	it('shows owner, kind, status, ESI and sync times and the places', () => {
		const { container } = renderCard();
		expect(container.querySelector('h3')?.textContent).toContain('Seed Pilot');
		expect(container.querySelector('h3')?.textContent).toContain('Personal assets');
		expect(status(container)).toBe('Up to date');
		const times = container.querySelector('[data-times]')!.textContent!;
		expect(times).toContain('Data from ESI as of 2026-10-06 12:00 UTC');
		expect(times).toContain('Synced 2026-10-06 12:05 UTC');
		expect(container.querySelector('form[action="?/select"]')).not.toBeNull();
	});

	it('names the corporation and the character reading it; a single reader cannot be stopped', () => {
		const { container } = renderCard({ kind: 'corporation', ownerName: 'Seed Corp' });
		expect(container.querySelector('h3')?.textContent).toContain('Seed Corp');
		expect(container.querySelector('h3')?.textContent).toContain('Corporation assets');
		expect(container.querySelector('[data-readers]')?.textContent?.trim()).toBe('Read with Seed Pilot');
		expect(container.querySelector('form[action="?/removeReader"]')).toBeNull();
	});

	it('lists the other pool members and posts Stop using with source and character ids', () => {
		const { container } = renderCard({
			kind: 'corporation',
			ownerName: 'Seed Corp',
			otherReaders: [
				{ characterId: 90000002, name: 'Seed Pilot Two' },
				{ characterId: 90000003, name: 'Seed Pilot Three' }
			]
		});
		const readers = container.querySelector('[data-readers]')!.textContent!;
		expect(readers).toContain('Read with Seed Pilot');
		expect(readers).toContain('Also: Seed Pilot Two, Seed Pilot Three');
		const stops = [...container.querySelectorAll('form[action="?/removeReader"]')].map((f) => [
			f.querySelector<HTMLInputElement>('input[name="sourceId"]')!.value,
			f.querySelector<HTMLInputElement>('input[name="characterId"]')!.value,
			f.querySelector('button')!.textContent
		]);
		expect(stops).toEqual([
			['3', '90000001', 'Stop using Seed Pilot'],
			['3', '90000002', 'Stop using Seed Pilot Two'],
			['3', '90000003', 'Stop using Seed Pilot Three']
		]);
	});

	it.each([
		['pending', 'Sync queued'],
		['running', 'Sync running'],
		['error', 'Last sync failed'],
		['denied', 'ESI denied access for Seed Pilot']
	] as const)('status %s reads "%s"', (state, text) => {
		const { container } = renderCard({ status: state });
		expect(status(container)).toContain(text);
	});

	it('a denied corporation shows why each reader was skipped', () => {
		const lastError =
			'No character can read Seed Corp: Seed Pilot needs the Director role; Seed Pilot Two is not in the corporation';
		const { container } = renderCard({
			kind: 'corporation',
			ownerName: 'Seed Corp',
			status: 'denied',
			lastError,
			otherReaders: [{ characterId: 90000002, name: 'Seed Pilot Two' }]
		});
		expect(status(container)).toContain('ESI denied access');
		expect(status(container)).not.toContain('for Seed Pilot');
		expect(container.querySelector('[data-error]')?.textContent).toBe(lastError);
	});

	it('shows the last error and "Not synced yet" before the first sync', () => {
		const { container } = renderCard({
			status: 'error',
			lastError: 'sync did not finish',
			lastSyncedAt: null,
			dataAsOf: null,
			places: []
		});
		expect(container.querySelector('[data-error]')?.textContent).toBe('sync did not finish');
		expect(container.querySelector('[data-times]')?.textContent?.trim()).toBe('Not synced yet');
		expect(container.textContent).not.toContain('Data from ESI');
		expect(container.querySelector('[data-no-places]')).toBeNull();
	});

	it('posts Sync now and a confirmed Remove with the source id; Sync now waits while syncing', () => {
		const { container, unmount } = renderCard();
		const sync = container.querySelector('form[action="?/sync"]')!;
		expect((sync.querySelector('input[name="sourceId"]') as HTMLInputElement).value).toBe('3');
		const remove = container.querySelector('form[action="?/remove"]')!;
		expect(remove.closest('details')).not.toBeNull();
		expect((remove.querySelector('input[name="sourceId"]') as HTMLInputElement).value).toBe('3');
		expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(false);
		unmount();
		renderCard({ status: 'running' });
		expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
