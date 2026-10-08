import { DEFAULT_CONSTANTS, DEFAULT_SETTINGS } from '@reactions/engine';
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { SystemSummary } from '$lib/settings/fields';
import ProfileFields from './ProfileFields.svelte';

const system = (securityBand: string): SystemSummary => ({
	id: 1,
	name: 'X',
	regionName: null,
	securityBand,
	securityStatus: 0,
	reactionCostIndex: null
});

function setup(
	opts: { band?: string; hubs?: { hubId: string; name: string; private: boolean }[]; enhanced?: boolean } = {}
) {
	// A reactive profile, as `SettingsForm` passes it (this file is compiled with runes).
	const profile = $state(structuredClone(DEFAULT_SETTINGS.shared));
	const { container } = render(ProfileFields, {
		prefix: 'shared',
		profile,
		system: system(opts.band ?? 'lowsec'),
		systemText: 'X',
		hubs: opts.hubs ?? [{ hubId: 'jita', name: 'Jita 4-4', private: false }],
		errors: {},
		constants: DEFAULT_CONSTANTS,
		enhanced: opts.enhanced ?? true
	});
	// Typed as an input: the workers DOM types make `HTMLSelectElement` unusable here; `.value` is shared.
	const select = (name: string) =>
		container.querySelector(`select[name="shared.${name}"]`) as HTMLInputElement;
	const preview = (what: 'me' | 'te') =>
		container.querySelector(`[data-preview-${what}]`)!.textContent!.trim();
	return { container, select, preview };
}

describe('ProfileFields', () => {
	it('previews the effective ME/TE modifiers with the engine formulas', async () => {
		const { select, preview } = setup();
		// Tatara, T2/T2, Reactions V, lowsec: ME 1 − 0.024; TE 0.8 × 0.75 × 0.76.
		expect(preview('me')).toBe('ME ×0.9760');
		expect(preview('te')).toBe('TE ×0.4560');
		await fireEvent.change(select('meRig'), { target: { value: 't1' } });
		await fireEvent.change(select('structure'), { target: { value: 'athanor' } });
		await fireEvent.change(select('reactionsSkill'), { target: { value: '4' } });
		expect(preview('me')).toBe('ME ×0.9800');
		expect(preview('te')).toBe(`TE ×${(0.84 * 1 * 0.76).toFixed(4)}`);
	});

	it('uses the security modifier of the chosen system (highsec previews as lowsec)', () => {
		expect(setup({ band: 'nullsec' }).preview('me')).toBe('ME ×0.9736');
		expect(setup({ band: 'highsec' }).preview('me')).toBe('ME ×0.9760');
	});

	it('lists public hubs, then private ones labelled "(private)", plus an unavailable saved hub', () => {
		const { select } = setup({
			hubs: [
				{ hubId: 'amarr', name: 'Amarr VIII', private: false },
				{ hubId: 'structure-1', name: 'Seed Market', private: true }
			]
		});
		expect([...select('market.inputHub').querySelectorAll('option')].map((o) => o.textContent)).toEqual([
			'Amarr VIII',
			'Seed Market (private)',
			'jita (unavailable)'
		]);
		expect(select('market.inputHub').value).toBe('jita');
		const fallback = select('market.inputFallbackHub');
		expect([...fallback.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
			'Amarr VIII',
			'Seed Market (private)',
			'jita (unavailable)'
		]);
		expect(fallback.value).toBe('jita');
		expect(fallback.getAttribute('aria-describedby')).toBeTruthy();
	});

	it('without JS the contract basis is rendered for CSS toggling and shipping fields stay enabled', () => {
		const { container } = setup({ enhanced: false });
		const basis = container.querySelector('[data-contract-basis="input"]')!;
		expect(basis.className).toContain('hidden');
		expect(basis.querySelector('select[name="shared.market.inputContractBasis"]')).not.toBeNull();
		for (const name of ['iskPerM3', 'collateralPct', 'discountPct'])
			expect(
				container.querySelector<HTMLInputElement>(`input[name="shared.shipping.input.${name}"]`)!.disabled
			).toBe(false);
	});

	it('shipping checkboxes keep the accent colour (their checked fill) and style only the label text', () => {
		const { container } = setup();
		for (const side of ['input', 'output']) {
			const box = container.querySelector<HTMLInputElement>(`input[name="shared.shipping.${side}.enabled"]`)!;
			// flowbite's checked fill is `currentColor`: a text colour on the input would replace the accent.
			expect(box.classList).toContain('text-primary-600');
			expect([...box.classList].filter((c) => /^(dark:)?text-(gray|white)/.test(c))).toEqual([]);
			expect(box.closest('label')!.classList).toContain('dark:text-white');
		}
	});
});
