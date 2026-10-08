import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import HubsAdminTable, { type AdminHub } from './HubsAdminTable.svelte';

const NOW = Date.UTC(2026, 9, 6, 12);

const npc = (hubId: string, name: string, sortOrder: number, enabled = true): AdminHub => ({
	hubId,
	name,
	kind: 'station',
	visibility: 'public',
	shareStatus: 'none',
	enabled,
	sortOrder,
	systemName: 'Jita',
	lastSuccessAt: NOW - 600_000,
	lastError: null,
	contributors: []
});

const hubs: AdminHub[] = [
	npc('jita', 'Jita 4-4', 1),
	npc('amarr', 'Amarr', 2, false),
	{
		hubId: 'structure-7',
		name: 'Shared Market',
		kind: 'structure',
		visibility: 'public',
		shareStatus: 'approved',
		enabled: true,
		sortOrder: 3,
		systemName: 'Perimeter',
		lastSuccessAt: null,
		lastError: 'character 1: HTTP 403',
		contributors: ['Beta', 'Gamma']
	},
	{
		hubId: 'structure-8',
		name: 'Seed Market',
		kind: 'structure',
		visibility: 'private',
		shareStatus: 'none',
		enabled: true,
		sortOrder: 100,
		systemName: null,
		lastSuccessAt: null,
		lastError: null,
		contributors: ['Alpha']
	}
];

const row = (hubId: string) => document.querySelector(`tr[data-hub="${hubId}"]`) as HTMLTableRowElement;
const actionsOf = (hubId: string) =>
	[...row(hubId).querySelectorAll('form')].map((f) => f.getAttribute('action'));

describe('HubsAdminTable', () => {
	it('shows kind, visibility, share status, enabled, order, contributors and last error', () => {
		render(HubsAdminTable, { hubs, now: NOW });
		const shared = row('structure-7');
		expect(shared.querySelector('[data-share]')?.textContent).toBe('approved');
		expect(shared.querySelector('[data-contributors]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'2 · Beta, Gamma'
		);
		expect(shared.textContent).toContain('character 1: HTTP 403');
		expect(row('jita').querySelector('[data-contributors]')?.textContent?.trim()).toBe('n/a');
		expect(row('jita').textContent).toContain('10 min ago');
		expect(within(row('amarr')).getByText('no')).toBeTruthy();
	});

	it('offers enable/disable and ordering for public hubs, revoke only for public structure hubs', () => {
		render(HubsAdminTable, { hubs, now: NOW });
		expect(actionsOf('jita')).toEqual(['?/disable', '?/up', '?/down']);
		expect(actionsOf('amarr')).toEqual(['?/enable', '?/up', '?/down']);
		expect(actionsOf('structure-7')).toEqual(['?/disable', '?/up', '?/down', '?/revoke', '?/delete']);
		expect(actionsOf('structure-8')).toEqual(['?/delete']);
		expect((screen.getByRole('button', { name: 'Move Jita 4-4 up' }) as HTMLButtonElement).disabled).toBe(
			true
		);
		expect(
			(screen.getByRole('button', { name: 'Move Shared Market down' }) as HTMLButtonElement).disabled
		).toBe(true);
		expect((row('jita').querySelector('input[name="hubId"]') as HTMLInputElement).value).toBe('jita');
	});

	it('offers Delete behind one confirmation step for structure hubs only', () => {
		render(HubsAdminTable, { hubs, now: NOW });
		expect(row('jita').querySelector('[data-delete]')).toBeNull();
		expect(row('amarr').querySelector('[data-delete]')).toBeNull();
		for (const hubId of ['structure-7', 'structure-8']) {
			const details = row(hubId).querySelector('details[data-delete]') as HTMLDetailsElement;
			expect(details.open).toBe(false);
			expect(details.querySelector('summary')?.textContent?.trim()).toBe('Delete');
			expect((details.querySelector('form input[name="hubId"]') as HTMLInputElement).value).toBe(hubId);
		}
		expect(screen.getByRole('button', { name: 'Delete Seed Market', hidden: true }).textContent).toBe(
			'Delete hub'
		);
	});
});
