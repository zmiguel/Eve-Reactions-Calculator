import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ConnectionView, TrackingView } from '#lib/inventory/types.js';
import ConnectionCard from './ConnectionCard.svelte';

const trackingOff: TrackingView = {
	enabled: false,
	status: null,
	lastError: null,
	syncedAt: null,
	streams: [],
	walletDivisions: []
};

const base: ConnectionView = {
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
	inventoryEnabled: true,
	tracking: trackingOff
};

const corpTracking: TrackingView = {
	enabled: true,
	status: 'ok',
	lastError: null,
	syncedAt: Date.UTC(2026, 9, 6, 13, 10),
	streams: [
		{ key: 'jobs', label: 'Jobs', status: 'ok', lastError: null },
		{
			key: 'wallet:1',
			label: 'Master Wallet',
			status: 'denied',
			lastError: 'Seed Pilot needs the Accountant or Junior Accountant role'
		},
		{ key: 'wallet:3', label: 'Division 3', status: 'pending', lastError: null },
		{ key: 'orders', label: 'Orders', status: 'error', lastError: null },
		{ key: 'contracts', label: 'Contracts', status: 'ok', lastError: null }
	],
	walletDivisions: [1, 2, 3, 4, 5, 6, 7].map((division) => ({
		division,
		name: division === 1 ? 'Master Wallet' : `Division ${division}`,
		counted: division === 1 || division === 3
	}))
};

function renderCard(source: Partial<ConnectionView> = {}) {
	return render(ConnectionCard, { props: { source: { ...base, ...source } } });
}

const part = (container: HTMLElement, name: 'inventory' | 'tracking') =>
	container.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
const status = (container: HTMLElement) => container.querySelector('[data-status]')?.textContent?.trim();

/** `[sourceId, feature, on]` posted by each switch, with its `aria-checked`. */
const switches = (container: HTMLElement) =>
	[...container.querySelectorAll('form[action="?/switch"]')].map((f) => [
		f.querySelector<HTMLInputElement>('input[name="sourceId"]')!.value,
		f.querySelector<HTMLInputElement>('input[name="feature"]')!.value,
		f.querySelector<HTMLInputElement>('input[name="on"]')!.value,
		f.querySelector('[role="switch"]')!.getAttribute('aria-checked')
	]);

describe('ConnectionCard', () => {
	it('shows owner, kind, the inventory status with ESI and sync times', () => {
		const { container } = renderCard();
		expect(container.querySelector('h3')?.textContent).toContain('Seed Pilot');
		expect(container.querySelector('h3')?.textContent).toContain('Character');
		expect(status(container)).toBe('Up to date');
		const times = container.querySelector('[data-times]')!.textContent!;
		expect(times).toContain('Data from ESI as of 2026-10-06 12:00 UTC');
		expect(times).toContain('Synced 2026-10-06 12:05 UTC');
	});

	it('renders an Inventory part and a Profit tracking part, each with its switch', () => {
		const { container } = renderCard();
		expect(part(container, 'inventory')).not.toBeNull();
		expect(part(container, 'tracking')).not.toBeNull();
		// Inventory on posts "off", tracking off posts "on".
		expect(switches(container)).toEqual([
			['3', 'inventory', '0', 'true'],
			['3', 'tracking', '1', 'false']
		]);
		expect(part(container, 'tracking').querySelector('form[action="?/syncTracking"]')).toBeNull();
		expect(container.querySelector('[data-nothing-read]')).toBeNull();
	});

	it('with both switches off says nothing is read and hides the syncs', () => {
		const { container } = renderCard({ inventoryEnabled: false });
		expect(container.querySelector('[data-nothing-read]')).not.toBeNull();
		expect(container.querySelector('[data-status]')).toBeNull();
		expect(container.querySelector('form[action="?/sync"]')).toBeNull();
		expect(switches(container).map((s) => s[2])).toEqual(['1', '1']);
	});

	it('names the corporation and the character reading it; a single reader cannot be stopped', () => {
		const { container } = renderCard({ kind: 'corporation', ownerName: 'Seed Corp' });
		expect(container.querySelector('h3')?.textContent).toContain('Seed Corp');
		expect(container.querySelector('h3')?.textContent).toContain('Corporation');
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
			dataAsOf: null
		});
		expect(container.querySelector('[data-error]')?.textContent).toBe('sync did not finish');
		expect(container.querySelector('[data-times]')?.textContent?.trim()).toBe('Not synced yet');
		expect(container.textContent).not.toContain('Data from ESI');
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

	it('lists the tracking streams with readable names and their states, the denied sentence included', () => {
		const { container } = renderCard({ kind: 'corporation', ownerName: 'Seed Corp', tracking: corpTracking });
		const tracking = part(container, 'tracking');
		expect(tracking.querySelector('[data-tracking-status]')?.textContent?.trim()).toBe('Up to date');
		expect(tracking.querySelector('[data-tracking-times]')?.textContent?.trim()).toBe(
			'Synced 2026-10-06 13:10 UTC'
		);
		expect(
			[...tracking.querySelectorAll('[data-stream]')].map((li) => [
				li.getAttribute('data-stream'),
				li.firstElementChild!.textContent,
				li.querySelector('[data-stream-status]')!.textContent
			])
		).toEqual([
			['jobs', 'Jobs', 'OK'],
			['wallet:1', 'Master Wallet', 'Seed Pilot needs the Accountant or Junior Accountant role'],
			['wallet:3', 'Division 3', 'Waiting'],
			['orders', 'Orders', 'Failed'],
			['contracts', 'Contracts', 'OK']
		]);
	});

	it('a tracking note on an ok sync is grey; a failed sync shows its error through userFacingError', () => {
		const note = 'Seed Pilot Two is not in the corporation';
		const ok = renderCard({ tracking: { ...corpTracking, lastError: note } });
		const shown = part(ok.container, 'tracking').querySelector('[data-tracking-error]')!;
		expect(shown.textContent).toBe(note);
		expect(shown.className).toContain('text-gray-500');
		ok.unmount();
		const failed = renderCard({
			tracking: { ...corpTracking, status: 'error', lastError: 'D1_ERROR: no such table' }
		});
		const error = part(failed.container, 'tracking').querySelector('[data-tracking-error]')!;
		expect(error.textContent).not.toContain('D1_ERROR');
		expect(error.className).toContain('text-red-600');
	});

	it('posts the wallet divisions form with the counted divisions ticked', () => {
		const { container } = renderCard({ kind: 'corporation', ownerName: 'Seed Corp', tracking: corpTracking });
		const form = container.querySelector('form[action="?/walletDivisions"]')!;
		expect(form.querySelector<HTMLInputElement>('input[name="sourceId"]')!.value).toBe('3');
		const boxes = [...form.querySelectorAll<HTMLInputElement>('input[name="division"]')];
		expect(boxes.map((b) => [b.value, b.checked, b.parentElement!.textContent!.trim()])).toEqual([
			['1', true, 'Master Wallet'],
			['2', false, 'Division 2'],
			['3', true, 'Division 3'],
			['4', false, 'Division 4'],
			['5', false, 'Division 5'],
			['6', false, 'Division 6'],
			['7', false, 'Division 7']
		]);
		// Personal connections have no wallet divisions.
		const personal = renderCard({ tracking: { ...corpTracking, walletDivisions: [] } });
		expect(personal.container.querySelector('form[action="?/walletDivisions"]')).toBeNull();
	});

	it('tracking Sync now posts the source id and waits while a tracking sync runs', () => {
		const { container, unmount } = renderCard({ tracking: corpTracking });
		const form = part(container, 'tracking').querySelector('form[action="?/syncTracking"]')!;
		expect(form.querySelector<HTMLInputElement>('input[name="sourceId"]')!.value).toBe('3');
		expect(form.querySelector('button')!.disabled).toBe(false);
		unmount();
		const running = renderCard({ tracking: { ...corpTracking, status: 'running' } });
		const button = part(running.container, 'tracking').querySelector('form[action="?/syncTracking"] button');
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});
});
