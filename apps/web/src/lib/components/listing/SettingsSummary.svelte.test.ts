import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SettingsSummary from './SettingsSummary.svelte';
import type { SettingsSummaryData } from './types';

const settings: SettingsSummaryData = {
	structure: 'tatara',
	meRig: 't2',
	teRig: 't1',
	systemName: 'Ignoitton',
	securityBand: 'lowsec',
	costIndex: 0.0412,
	costIndexOverridden: false,
	inputHub: 'Jita 4-4',
	outputHub: 'Amarr VIII',
	inputMethod: 'buy_order',
	outputMethod: 'instant'
};

describe('SettingsSummary', () => {
	it('renders structure, rigs, system, cost index and hubs as a link to /settings', () => {
		render(SettingsSummary, { settings });
		const chip = screen.getByRole('link');
		expect(chip.getAttribute('href')).toBe('/settings');
		const text = chip.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('Tatara');
		expect(text).toContain('T2 ME / T1 TE rigs');
		expect(text).toContain('Ignoitton (lowsec)');
		expect(text).toContain('Cost index 4.12%');
		expect(text).toContain('Inputs: Jita 4-4 buy orders');
		expect(text).toContain('Outputs: Amarr VIII instant');
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('marks an overridden cost index', () => {
		render(SettingsSummary, { settings: { ...settings, costIndexOverridden: true, costIndex: 0.05 } });
		expect(screen.getByRole('link').textContent).toContain('Cost index 5.00% (override)');
	});

	it('explains HUB_UNAVAILABLE and COST_INDEX_MISSING warnings', () => {
		render(SettingsSummary, { settings, warnings: ['HUB_UNAVAILABLE', 'COST_INDEX_MISSING'] });
		const alerts = screen.getAllByRole('alert').map((a) => a.textContent!.trim());
		expect(alerts).toHaveLength(2);
		expect(alerts[0]).toContain('Jita 4-4 prices are used instead');
		expect(alerts[1]).toContain('No reaction cost index is known for Ignoitton');
	});
});
