import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StructureRow, { type StructureLink } from './StructureRow.svelte';

const NOW = Date.UTC(2026, 9, 6, 12);

const base: StructureLink = {
	structureId: 1044752365771,
	name: 'Seed Market',
	systemName: 'Perimeter',
	regionName: 'The Forge',
	visibility: 'private',
	shareStatus: 'none',
	enabled: true,
	lastSuccessAt: null,
	lastError: null,
	accessStatus: 'ok',
	shareRequested: false,
	characterId: 90000001,
	characterName: 'Seed Pilot'
};

function renderRow(link: Partial<StructureLink> = {}) {
	const table = document.createElement('table');
	const tbody = table.appendChild(document.createElement('tbody'));
	document.body.appendChild(table);
	return render(StructureRow, { target: tbody, props: { link: { ...base, ...link }, now: NOW } });
}

const badge = (container: HTMLElement) => container.querySelector('[data-badge]')?.textContent;

describe('StructureRow', () => {
	it('shows name, system, region, character and "Prices pending" before the first refresh', () => {
		const { container } = renderRow();
		expect(container.textContent).toContain('Seed Market');
		expect(container.textContent).toContain('Perimeter · The Forge');
		expect(container.textContent).toContain('Seed Pilot');
		expect(container.querySelector('[data-status]')?.textContent?.trim()).toBe('Prices pending');
	});

	it('shows the last refresh, errors and a denied link', () => {
		const { container } = renderRow({
			lastSuccessAt: NOW - 3 * 3_600_000,
			lastError: 'character 1: HTTP 403',
			accessStatus: 'denied'
		});
		const status = container.querySelector('[data-status]')!.textContent!;
		expect(status).toContain('Prices 3 h ago');
		expect(status).toContain('Seed Pilot lost access');
		expect(status).toContain('character 1: HTTP 403');
	});

	it.each([
		[{ visibility: 'private', shareStatus: 'none' }, 'Private'],
		[{ visibility: 'private', shareStatus: 'pending' }, 'Shared, pending review'],
		[{ visibility: 'public', shareStatus: 'approved' }, 'Public'],
		[{ visibility: 'private', shareStatus: 'rejected' }, 'Rejected']
	] as const)('badge for %o is %s', (state, label) => {
		const { container } = renderRow(state);
		expect(badge(container)).toBe(label);
	});

	it('the sharing switch posts the opposite state and reflects the current one', () => {
		const { container, unmount } = renderRow();
		const form = container.querySelector('form[action="?/share"]')!;
		expect((form.querySelector('input[name="share"]') as HTMLInputElement).value).toBe('1');
		expect((form.querySelector('input[name="structureId"]') as HTMLInputElement).value).toBe('1044752365771');
		expect(
			screen.getByRole('switch', { name: 'Allow everyone to use this market' }).getAttribute('aria-checked')
		).toBe('false');
		unmount();
		const on = renderRow({ shareRequested: true });
		expect((on.container.querySelector('input[name="share"]') as HTMLInputElement).value).toBe('0');
		expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
	});

	it('disables the switch and Remove while a request is in flight', async () => {
		const { container } = renderRow();
		const toggle = screen.getByRole('switch') as HTMLButtonElement;
		const remove = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
		expect(toggle.disabled).toBe(false);
		await fireEvent.submit(container.querySelector('form[action="?/share"]')!);
		expect(toggle.disabled).toBe(true);
		expect(remove.disabled).toBe(true);
	});
});
