import type { OutputMode, Reactor, Settings, SlotAllocation, View } from '@reactions/engine';
import { REACTOR_LABEL } from '$lib/site';

/** Profile being edited: the shared one, or one reactor's in `per_reactor` mode. */
export type ProfileKey = 'shared' | Reactor;

/** Form-field / error-key prefix of a profile (`shared`, `reactors.composite`, …). */
export const profilePath = (key: ProfileKey) => (key === 'shared' ? 'shared' : `reactors.${key}`);

/** One solar system as returned by `/api/v2/systems` and shown in the system autocomplete. */
export interface SystemSummary {
	id: number;
	name: string;
	regionName: string | null;
	securityBand: string;
	securityStatus: number;
	/** Reaction cost index as a fraction (0.0412 = 4.12 %), `null` when unknown. */
	reactionCostIndex: number | null;
}

export interface Option<T extends string = string> {
	value: T;
	name: string;
}

export const STRUCTURE_OPTIONS: Option<Settings['shared']['structure']>[] = [
	{ value: 'tatara', name: 'Tatara' },
	{ value: 'athanor', name: 'Athanor' }
];

export const RIG_OPTIONS: Option<Settings['shared']['meRig']>[] = [
	{ value: 'none', name: 'No rig' },
	{ value: 't1', name: 'T1' },
	{ value: 't2', name: 'T2' }
];

export const INPUT_METHOD_OPTIONS: Option<Settings['shared']['market']['inputMethod']>[] = [
	{ value: 'buy_order', name: 'Buy orders' },
	{ value: 'instant', name: 'Instant buy' },
	{ value: 'contract', name: 'Contract' }
];

export const OUTPUT_METHOD_OPTIONS: Option<Settings['shared']['market']['outputMethod']>[] = [
	{ value: 'sell_order', name: 'Sell orders' },
	{ value: 'instant', name: 'Instant sell' },
	{ value: 'contract', name: 'Contract' }
];

export const BASIS_OPTIONS: Option<Settings['shared']['market']['inputContractBasis']>[] = [
	{ value: 'buy', name: 'Buy price' },
	{ value: 'sell', name: 'Sell price' },
	{ value: 'split', name: 'Split (average)' }
];

export const MODE_OPTIONS: Option<Settings['mode']>[] = [
	{ value: 'shared', name: 'Same settings for every reactor' },
	{ value: 'per_reactor', name: 'Separate settings per reactor' }
];

/** Chain slot allocation: settings field, detail-page toggle and change labels. */
export const SLOT_ALLOCATION_OPTIONS: (Option<SlotAllocation> & { hint: string })[] = [
	{
		value: 'single',
		name: 'Single slot',
		hint: "One line of the chain in one slot, jobs one after another; profit/slot/day uses the jobs' total time."
	},
	{
		value: 'optimal',
		name: 'Optimal slots',
		hint: 'Parallel lines sized so every job fills one cycle in its own slot; profit/slot/day uses every allocated slot-day.'
	}
];

/** Which tab reaction lists and pages open on: settings field and change labels. */
export const DEFAULT_VIEW_OPTIONS: Option<View>[] = [
	{ value: 'single', name: 'Buy inputs' },
	{ value: 'chain', name: 'Full chain' }
];

/** Which tab reprocessable reactions open on: settings field and change labels. */
export const DEFAULT_OUTPUT_OPTIONS: Option<OutputMode>[] = [
	{ value: 'product', name: 'Sell product' },
	{ value: 'reprocessed', name: 'Reprocess' }
];

/** Whether full chains use unrefined routes: settings field and change labels. */
export const UNREFINED_IN_CHAINS_OPTIONS: Option<Settings['unrefinedInChains']>[] = [
	{ value: 'never', name: 'Never' },
	{ value: 'best', name: 'When better' }
];

/** Labels of the leaves inside a reactor profile, keyed by their path below the profile. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
	structure: 'Structure',
	meRig: 'ME rig',
	teRig: 'TE rig',
	systemId: 'System',
	costIndexOverridePct: 'Cost index override %',
	facilityTaxPct: 'Facility tax %',
	sccPct: 'SCC surcharge %',
	reactionsSkill: 'Reactions skill',
	'market.inputHub': 'Input hub',
	'market.inputFallbackHub': 'Buy missing inputs from',
	'market.outputHub': 'Output hub',
	'market.inputMethod': 'Input method',
	'market.outputMethod': 'Output method',
	'market.inputContractBasis': 'Input contract basis',
	'market.outputContractBasis': 'Output contract basis',
	'market.inputPricePct': 'Input price %',
	'market.outputPricePct': 'Output price %',
	'market.brokerFeePct': 'Broker fee %',
	'market.salesTaxPct': 'Sales tax %',
	'shipping.input.enabled': 'Ship inputs',
	'shipping.input.iskPerM3': 'Input shipping ISK/m³',
	'shipping.input.collateralPct': 'Input collateral %',
	'shipping.input.discountPct': 'Input shipping discount %',
	'shipping.output.enabled': 'Ship outputs',
	'shipping.output.iskPerM3': 'Output shipping ISK/m³',
	'shipping.output.collateralPct': 'Output collateral %',
	'shipping.output.discountPct': 'Output shipping discount %'
};

const GLOBAL_FIELD_LABELS: Record<string, string> = {
	mode: 'Mode',
	cycleDays: 'Cycle days',
	slotAllocation: 'Chain slot allocation',
	maxParallelLines: 'Max parallel lines',
	defaultView: 'Open reactions on',
	defaultOutput: 'Open reprocessable reactions on',
	unrefinedInChains: 'Unrefined reactions in chains',
	'reprocessing.unrefinedYieldPct': 'Unrefined reprocessing yield %',
	'reprocessing.prismaticiteYieldPct': 'Prismaticite yield %',
	'reprocessing.prismaticiteRollPct': 'Prismaticite roll %'
};

/** Group (`General`, `Shared profile`, `Composite`, …) and label of a dotted settings path. */
export function describePath(path: string): { scope: string; label: string } {
	const [head, second, ...rest] = path.split('.');
	if (head === 'shared')
		return { scope: 'Shared profile', label: PROFILE_FIELD_LABELS[[second, ...rest].join('.')] ?? path };
	if (head === 'reactors')
		return {
			scope: REACTOR_LABEL[second as Reactor] ?? second,
			label: PROFILE_FIELD_LABELS[rest.join('.')] ?? path
		};
	return { scope: 'General', label: GLOBAL_FIELD_LABELS[path] ?? path };
}

const OPTION_LABELS: Record<string, string> = {
	...Object.fromEntries(
		[...STRUCTURE_OPTIONS, ...RIG_OPTIONS, ...BASIS_OPTIONS, ...MODE_OPTIONS, ...SLOT_ALLOCATION_OPTIONS].map(
			(o) => [o.value, o.name]
		)
	),
	buy_order: 'Buy orders',
	sell_order: 'Sell orders',
	instant: 'Instant',
	contract: 'Contract'
};

export interface SettingsChange {
	/** Dotted settings path, e.g. `reactors.composite.market.inputHub`. */
	path: string;
	/** Group the field belongs to: `General`, `Shared profile`, `Composite`, … */
	scope: string;
	label: string;
	from: string;
	to: string;
}

function leaves(value: unknown, prefix = ''): [string, unknown][] {
	if (typeof value !== 'object' || value === null) return [[prefix, value]];
	return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

/**
 * Field-by-field differences between two settings, with human labels, limited to the profiles `next`
 * uses (`shared`, or the three reactors). `names` maps hub ids and `system:<id>` keys to display names.
 */
export function settingsChanges(
	current: Settings,
	next: Settings,
	names: Record<string, string> = {}
): SettingsChange[] {
	const before = new Map(leaves(current));
	const unused = next.mode === 'shared' ? 'reactors.' : 'shared.';
	const format = (path: string, value: unknown) => {
		if (value === null || value === undefined) return 'n/a';
		if (typeof value === 'boolean') return value ? 'On' : 'Off';
		if (path.endsWith('systemId')) return names[`system:${value}`] ?? `System ${value}`;
		if (path.endsWith('Hub')) return names[String(value)] ?? String(value);
		if (path === 'defaultView')
			return DEFAULT_VIEW_OPTIONS.find((o) => o.value === value)?.name ?? String(value);
		if (path === 'defaultOutput')
			return DEFAULT_OUTPUT_OPTIONS.find((o) => o.value === value)?.name ?? String(value);
		if (path === 'unrefinedInChains')
			return UNREFINED_IN_CHAINS_OPTIONS.find((o) => o.value === value)?.name ?? String(value);
		if (typeof value === 'string') return OPTION_LABELS[value] ?? value;
		return String(value);
	};
	const changes: SettingsChange[] = [];
	for (const [path, value] of leaves(next)) {
		if (path === 'v' || path.startsWith(unused) || Object.is(before.get(path), value)) continue;
		changes.push({
			path,
			...describePath(path),
			from: format(path, before.get(path)),
			to: format(path, value)
		});
	}
	return changes;
}
