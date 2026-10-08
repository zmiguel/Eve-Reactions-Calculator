import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { AdminHub } from './HubsAdminTable.svelte';
import PendingHubsTable from './PendingHubsTable.svelte';

const pending: AdminHub = {
	hubId: 'structure-1042508032148',
	name: 'Seed Shared Market',
	kind: 'structure',
	visibility: 'private',
	shareStatus: 'pending',
	enabled: true,
	sortOrder: 100,
	systemName: 'Amarr',
	lastSuccessAt: null,
	lastError: null,
	contributors: ['Seed Pilot Two']
};

describe('PendingHubsTable', () => {
	it('lists each pending market with contributors and Approve/Reject forms for its hub id', () => {
		const { container } = render(PendingHubsTable, { hubs: [pending] });
		const row = container.querySelector('tr[data-pending="structure-1042508032148"]')!;
		expect(row.textContent).toContain('Seed Shared Market');
		expect(row.textContent).toContain('structure-1042508032148 · Amarr');
		expect(row.textContent).toContain('Seed Pilot Two');
		const forms = [...row.querySelectorAll('form')];
		expect(forms.map((f) => [f.getAttribute('method'), f.getAttribute('action')])).toEqual([
			['POST', '?/approve'],
			['POST', '?/reject']
		]);
		for (const form of forms) {
			expect((form.querySelector('input[name="hubId"]') as HTMLInputElement).value).toBe(pending.hubId);
		}
		expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
	});

	it('says so when nothing waits for review', () => {
		render(PendingHubsTable, { hubs: [] });
		expect(screen.getByText('Nothing waiting for review.')).toBeTruthy();
		expect(document.querySelector('table')).toBeNull();
	});
});
