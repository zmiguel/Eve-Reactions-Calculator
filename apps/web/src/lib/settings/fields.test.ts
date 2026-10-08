import { DEFAULT_SETTINGS, Settings } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import { describePath, profilePath, settingsChanges } from './fields';

describe('profilePath', () => {
	it('maps profiles to their field-name prefix', () => {
		expect(profilePath('shared')).toBe('shared');
		expect(profilePath('hybrid')).toBe('reactors.hybrid');
	});
});

describe('describePath', () => {
	it('labels global, shared and reactor fields', () => {
		expect(describePath('cycleDays')).toEqual({ scope: 'General', label: 'Cycle days' });
		expect(describePath('slotAllocation')).toEqual({ scope: 'General', label: 'Chain slot allocation' });
		expect(describePath('maxParallelLines')).toEqual({ scope: 'General', label: 'Max parallel lines' });
		expect(describePath('defaultView')).toEqual({ scope: 'General', label: 'Open reactions on' });
		expect(describePath('defaultOutput')).toEqual({
			scope: 'General',
			label: 'Open reprocessable reactions on'
		});
		expect(describePath('shared.market.brokerFeePct')).toEqual({
			scope: 'Shared profile',
			label: 'Broker fee %'
		});
		expect(describePath('reactors.composite.shipping.output.iskPerM3')).toEqual({
			scope: 'Composite',
			label: 'Output shipping ISK/m³'
		});
		expect(describePath('shared.shipping.input.discountPct')).toEqual({
			scope: 'Shared profile',
			label: 'Input shipping discount %'
		});
		expect(describePath('reactors.hybrid.shipping.output.discountPct')).toEqual({
			scope: 'Hybrid',
			label: 'Output shipping discount %'
		});
	});
});

describe('settingsChanges', () => {
	it('is empty for equal settings', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, Settings.parse({}))).toEqual([]);
	});

	it('labels the chain slot allocation change with the option names', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, Settings.parse({ slotAllocation: 'optimal' }))).toEqual([
			{
				path: 'slotAllocation',
				scope: 'General',
				label: 'Chain slot allocation',
				from: 'Single slot',
				to: 'Optimal slots'
			}
		]);
	});

	it('names a raised max parallel lines', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, Settings.parse({ maxParallelLines: 10 }))).toMatchObject([
			{ path: 'maxParallelLines', scope: 'General', label: 'Max parallel lines' }
		]);
	});

	it('labels the open-reactions-on change with the tab names (not the slot option names)', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, Settings.parse({ defaultView: 'chain' }))).toEqual([
			{
				path: 'defaultView',
				scope: 'General',
				label: 'Open reactions on',
				from: 'Buy inputs',
				to: 'Full chain'
			}
		]);
	});

	it('labels the reprocess preference change with the tab names', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, Settings.parse({ defaultOutput: 'reprocessed' }))).toEqual([
			{
				path: 'defaultOutput',
				scope: 'General',
				label: 'Open reprocessable reactions on',
				from: 'Sell product',
				to: 'Reprocess'
			}
		]);
	});

	it('lists changed leaves with formatted values and display names', () => {
		const next = Settings.parse({
			shared: {
				meRig: 'none',
				costIndexOverridePct: 5,
				systemId: 30004604,
				market: { outputHub: 'amarr', outputMethod: 'contract' },
				shipping: { input: { enabled: true, discountPct: 25 } }
			},
			reprocessing: { prismaticiteRollPct: 40 }
		});
		const names = { amarr: 'Amarr VIII', jita: 'Jita 4-4', 'system:30004604': '671-ST' };
		expect(
			settingsChanges(DEFAULT_SETTINGS, next, names).map((c) => [c.scope, c.label, c.from, c.to])
		).toEqual([
			['Shared profile', 'ME rig', 'T2', 'No rig'],
			['Shared profile', 'System', 'System 30002647', '671-ST'],
			['Shared profile', 'Cost index override %', 'n/a', '5'],
			['Shared profile', 'Output hub', 'Jita 4-4', 'Amarr VIII'],
			['Shared profile', 'Output method', 'Sell orders', 'Contract'],
			['Shared profile', 'Ship inputs', 'Off', 'On'],
			['Shared profile', 'Input shipping discount %', '0', '25'],
			['General', 'Prismaticite roll %', '50', '40']
		]);
	});

	it('only compares the profiles the new settings use', () => {
		const current = Settings.parse({ reactors: { hybrid: { structure: 'athanor' } } });
		expect(settingsChanges(current, DEFAULT_SETTINGS)).toEqual([]);
		const perReactor = Settings.parse({
			mode: 'per_reactor',
			shared: { sccPct: 9 },
			reactors: { hybrid: { sccPct: 5 } }
		});
		expect(settingsChanges(DEFAULT_SETTINGS, perReactor).map((c) => c.path)).toEqual([
			'mode',
			'reactors.hybrid.sccPct'
		]);
	});
});
