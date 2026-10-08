import type { PlannerData } from '$lib/planner/plan';
import { makeCtx } from '../../../../packages/engine/test/fixtures/context';

/**
 * `/planner` load data built from the engine's hand-built fixture dataset (Crystalline Carbonide chain,
 * boosters, …) with fixed Jita prices; usable in node and jsdom tests.
 */
export function plannerData(overrides: Partial<PlannerData> = {}): PlannerData {
	const ctx = makeCtx();
	return {
		available: true,
		dataset: ctx.dataset,
		prices: ctx.outputPrices,
		inputPrices: null,
		inputsDaysAgo: 0,
		profiles: ctx.profiles,
		profileWarnings: [],
		settings: ctx.settings,
		hubs: [
			{
				hubId: 'jita',
				name: 'Jita 4-4',
				regionId: 10000002,
				regionName: 'The Forge',
				private: false,
				structure: false
			},
			{
				hubId: 'amarr',
				name: 'Amarr',
				regionId: 10000043,
				regionName: 'Domain',
				private: false,
				structure: false
			}
		],
		volumes: { 10000002: { 16670: 900_000 } },
		settingsSummary: null,
		sharedSettings: null,
		...overrides
	};
}
