import { render, screen } from '@testing-library/svelte';
import { ERROR_INTERNAL, TOKEN_ERROR_REVOKED, TOKEN_ERROR_SSO_DOWN } from '@reactions/eve/errors';
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
}) {
	const table = document.createElement('table');
	const tbody = table.appendChild(document.createElement('tbody'));
	document.body.appendChild(table);
	return render(CharacterRow, {
		target: tbody,
		props: {
			character: { ...base, ...props.character },
			offeredFeatures: props.offeredFeatures ?? [
				'structures',
				'assets',
				'corp_assets',
				'tracking',
				'corp_tracking'
			],
			onlyCharacter: props.onlyCharacter ?? false
		}
	});
}

const badges = (container: HTMLElement) =>
	[...container.querySelectorAll('[data-permissions] li')].map((li) => li.textContent?.trim());
const token = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-token]')!;

describe('CharacterRow', () => {
	it('shows portrait, name, login marker, no permissions and no token', () => {
		const { container } = renderRow({});
		expect(container.querySelector('img')?.getAttribute('src')).toContain('90000001');
		expect(screen.getByText('Alpha')).toBeTruthy();
		expect(screen.getByText('Logged in')).toBeTruthy();
		expect(badges(container)).toEqual([]);
		expect(container.querySelector('[data-permissions]')?.textContent?.trim()).toBe('None');
		expect(token(container).dataset.token).toBe('none');
		expect(container.querySelector('[data-last-refresh]')).toBeNull();
		expect(container.querySelector('[data-token-attention]')).toBeNull();
		expect(screen.queryByRole('link', { name: /^Enable/ })).toBeNull();
	});

	it('shows one badge per permission', () => {
		const { container } = renderRow({
			character: { isLogin: false, features: ['structures', 'assets', 'tracking', 'corp_tracking'] }
		});
		expect(badges(container)).toEqual([
			'Structure markets',
			'Personal assets',
			'Profit tracking',
			'Corporation profit tracking'
		]);
		expect(screen.queryByText('Logged in')).toBeNull();
	});

	it('a working token is OK with its last refresh time and no warning', () => {
		const { container } = renderRow({
			character: { features: ['tracking'], tokenStatus: 'ok', lastRefreshedAt: Date.UTC(2026, 9, 6, 12) }
		});
		expect(token(container).dataset.token).toBe('ok');
		expect(container.querySelector('[data-last-refresh]')?.textContent).toMatch(/2026-10-06/);
		expect(container.querySelector('[data-token-attention]')).toBeNull();
	});

	it('an invalid token shows its sentence and a "Log in again" POST re-granting the current permissions', () => {
		const { container } = renderRow({
			character: {
				features: ['structures', 'tracking'],
				tokenStatus: 'invalid',
				lastError: TOKEN_ERROR_REVOKED
			}
		});
		expect(token(container).dataset.token).toBe('invalid');
		const attention = container.querySelector('[data-token-attention]')!;
		expect(attention.textContent).toContain(TOKEN_ERROR_REVOKED);
		const button = screen.getByRole('button', { name: 'Log in again' });
		const form = button.closest('form')!;
		expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual([
			'POST',
			'/account/permissions/90000001?/save'
		]);
		expect(new FormData(form).getAll('features')).toEqual(['structures', 'tracking']);
	});

	it('a failed refresh is flagged with its sentence; a raw stored error becomes a generic sentence', () => {
		const down = renderRow({
			character: { features: ['tracking'], tokenStatus: 'ok', lastError: TOKEN_ERROR_SSO_DOWN }
		});
		expect(token(down.container).dataset.token).toBe('failing');
		expect(down.container.querySelector('[data-token-attention]')?.textContent).toContain(
			TOKEN_ERROR_SSO_DOWN
		);
		down.unmount();

		const { container } = renderRow({
			character: {
				features: ['structures'],
				tokenStatus: 'ok',
				lastError:
					'character 96440041: Error: Failed query: update "characters" set "refresh_token_enc" = ?, "last_refreshed_at" = ?, "last_error" = ? where "characters"."character_id" = ? params: djEuYWJj,1791830022248,,96440041'
			}
		});
		expect(container.textContent).toContain(ERROR_INTERNAL);
		expect(container.innerHTML).not.toMatch(/Failed query|96440041|params/);
	});

	it('the pencil links to the plain permissions page and opens the dialog', () => {
		renderRow({});
		const link = screen.getByRole('link', { name: 'Edit permissions of Alpha' });
		expect(link.getAttribute('href')).toBe('/account/permissions/90000001');
		expect(link.getAttribute('aria-haspopup')).toBe('dialog');
	});

	it('removes directly, or behind a confirmation when it is the only character', () => {
		const { container, unmount } = renderRow({});
		const form = container.querySelector('form')!;
		expect([form.getAttribute('method'), form.getAttribute('action')]).toEqual(['POST', '?/remove']);
		expect((form.querySelector('input[name="characterId"]') as HTMLInputElement).value).toBe('90000001');
		expect(screen.getByRole('button', { name: 'Remove Alpha' }).closest('form')).toBe(form);
		expect(form.closest('details')).toBeNull();
		unmount();

		const only = renderRow({ onlyCharacter: true });
		const confirm = only.container.querySelector('form')!;
		expect(confirm.closest('details')).not.toBeNull();
		expect(confirm.textContent).toContain('removing it deletes your account');
		expect(confirm.querySelector('button')?.textContent).toBe('Remove and delete account');
	});
});
