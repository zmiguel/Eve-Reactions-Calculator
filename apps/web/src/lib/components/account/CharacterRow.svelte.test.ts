import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CharacterRow, { type AccountCharacter } from './CharacterRow.svelte';

const base: AccountCharacter = {
	characterId: 90000001,
	name: 'Alpha',
	isLogin: true,
	features: [],
	tokenStatus: 'none',
	lastRefreshedAt: null,
	lastError: null
};

function renderRow(props: {
	character?: Partial<AccountCharacter>;
	offeredFeatures?: AccountCharacter['features'];
	onlyCharacter?: boolean;
	showAccess?: boolean;
}) {
	const table = document.createElement('table');
	const tbody = table.appendChild(document.createElement('tbody'));
	document.body.appendChild(table);
	return render(CharacterRow, {
		target: tbody,
		props: {
			character: { ...base, ...props.character },
			offeredFeatures: props.offeredFeatures ?? [],
			onlyCharacter: props.onlyCharacter ?? false,
			showAccess: props.showAccess ?? true
		}
	});
}

describe('CharacterRow', () => {
	it('shows portrait, name, login marker and empty feature/token cells', () => {
		const { container } = renderRow({});
		expect(container.querySelector('img')?.getAttribute('src')).toBe(
			'https://images.evetech.net/characters/90000001/portrait?size=32'
		);
		expect(screen.getByText('Alpha')).toBeTruthy();
		expect(screen.getByText('Logged in')).toBeTruthy();
		expect(container.querySelector('[data-features]')?.textContent?.trim()).toBe('none');
		expect(container.querySelector('[data-token-status]')?.textContent).toBe('No token');
		expect(screen.queryByRole('link', { name: /^Enable/ })).toBeNull();
	});

	it('omits the feature, token and refresh cells when access columns are hidden', () => {
		const { container } = renderRow({ showAccess: false });
		expect(container.querySelectorAll('td')).toHaveLength(2);
		expect(container.querySelector('[data-features]')).toBeNull();
		expect(container.querySelector('[data-token-status]')).toBeNull();
	});

	it('renders granted features as badges, token status and the last refresh/error', () => {
		const { container } = renderRow({
			character: {
				isLogin: false,
				features: ['structures', 'wallet'],
				tokenStatus: 'invalid',
				lastRefreshedAt: Date.UTC(2026, 9, 6, 12),
				lastError: 'invalid_grant'
			}
		});
		const badges = [...container.querySelectorAll('[data-features] span span')].map((b) => b.textContent);
		expect(badges).toEqual(['Structure markets', 'Wallet']);
		expect(container.querySelector('[data-token-status="invalid"]')?.textContent).toBe('Token invalid');
		expect(container.textContent).toContain('2026-10-06 12:00 UTC');
		expect(container.textContent).toContain('invalid_grant');
		expect(screen.queryByText('Logged in')).toBeNull();
	});

	it('offers Enable buttons only for offered features the character lacks', () => {
		renderRow({ character: { features: ['structures'] }, offeredFeatures: ['structures', 'wallet'] });
		const links = screen.getAllByRole('link', { name: /^Enable/ });
		expect(links.map((a) => a.textContent)).toEqual(['Enable Wallet']);
		expect(links[0].getAttribute('href')).toBe(
			'/auth/login?purpose=feature&feature=wallet&characterId=90000001&returnTo=%2Faccount'
		);
	});

	it('removes directly, or behind a confirmation when it is the only character', () => {
		const { container, unmount } = renderRow({});
		const form = container.querySelector('form')!;
		expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual(['POST', '?/remove']);
		expect((form.querySelector('input[name="characterId"]') as HTMLInputElement).value).toBe('90000001');
		expect(form.closest('details')).toBeNull();
		unmount();

		const only = renderRow({ onlyCharacter: true });
		const confirm = only.container.querySelector('form')!;
		expect(confirm.closest('details')).not.toBeNull();
		expect(confirm.textContent).toContain('removing it deletes your account');
		expect(confirm.querySelector('button')?.textContent).toBe('Remove and delete account');
	});
});
