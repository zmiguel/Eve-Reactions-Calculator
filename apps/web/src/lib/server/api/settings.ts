import {
	DEFAULT_SETTINGS,
	MAX_PARALLEL_LINES,
	Settings,
	decodeSettings,
	type ReactorProfile
} from '@reactions/engine';
import { MAX_PICKED_LINES } from '$lib/components/detail/links';
import type { ProfileKey } from '$lib/settings/fields';
import { loadCalc, type RequestCalc } from '../context.ts';
import type { HubInfo } from '../hubs.ts';
import { dateBounds } from '../listing.ts';
import { profilesInUse, referenceErrors, systemsFor } from '../settingsForm.ts';
import { getSystemByName, getSystemsByIds } from '../systems.ts';
import { publicHubs, requireHub } from './data.ts';
import { ApiError, invalidParam } from './http.ts';
import { dateParam, enumParam, numberParam, stringParam, type QueryValues } from './params.ts';

/**
 * Settings from API v2 query parameters. Every parameter maps onto the shared profile of
 * `DEFAULT_SETTINGS` (documented defaults are those values). API v2 is anonymous: only enabled public
 * hubs exist for it, and cookies/sessions are never read.
 */

const P = DEFAULT_SETTINGS.shared;
const M = P.market;
const R = DEFAULT_SETTINGS.reprocessing;

const RIGS = ['none', 't1', 't2'] as const;
const BASES = ['buy', 'sell', 'split'] as const;

export const SETTINGS_PARAMS = {
	structure: enumParam('Refinery used for the reactions.', ['athanor', 'tatara'], P.structure),
	meRig: enumParam('Material efficiency rig of the refinery.', RIGS, P.meRig),
	teRig: enumParam('Time efficiency rig of the refinery.', RIGS, P.teRig),
	system: stringParam(
		'Reaction system: solar system id or exact name (case-insensitive). Highsec systems are rejected. Default Ignoitton.',
		{ default: String(P.systemId), example: 'Ignoitton' }
	),
	costIndex: numberParam("Reaction cost index override in percent; default is the system's current index.", {
		min: 0,
		max: 100
	}),
	facilityTax: numberParam('Facility tax in percent.', { min: 0, max: 50, default: P.facilityTaxPct }),
	scc: numberParam('SCC surcharge in percent.', { min: 0, max: 20, default: P.sccPct }),
	skill: numberParam('Reactions skill level.', { min: 1, max: 5, integer: true, default: P.reactionsSkill }),
	inputHub: stringParam('Public market hub id where inputs are bought (see /api/v2/hubs).', {
		default: M.inputHub
	}),
	inputFallbackHub: stringParam(
		'Public market hub id where the part of an input that inputHub does not list is bought (buy_order and instant only).',
		{ default: M.inputFallbackHub }
	),
	outputHub: stringParam('Public market hub id where outputs are sold (see /api/v2/hubs).', {
		default: M.outputHub
	}),
	inputMethod: enumParam(
		'How inputs are bought: own buy orders, instantly from sell orders, or by contract.',
		['buy_order', 'instant', 'contract'],
		M.inputMethod
	),
	outputMethod: enumParam(
		'How outputs are sold: own sell orders, instantly to buy orders, or by contract.',
		['sell_order', 'instant', 'contract'],
		M.outputMethod
	),
	inputBasis: enumParam(
		'Contract price basis for inputs (inputMethod=contract).',
		BASES,
		M.inputContractBasis
	),
	outputBasis: enumParam(
		'Contract price basis for outputs (outputMethod=contract).',
		BASES,
		M.outputContractBasis
	),
	inputPricePct: numberParam('Input prices in percent of the market price.', {
		min: 50,
		max: 150,
		default: M.inputPricePct
	}),
	outputPricePct: numberParam('Output prices in percent of the market price.', {
		min: 50,
		max: 150,
		default: M.outputPricePct
	}),
	broker: numberParam('Broker fee in percent (orders only).', { min: 0, max: 10, default: M.brokerFeePct }),
	salesTax: numberParam('Sales tax in percent.', { min: 0, max: 10, default: M.salesTaxPct }),
	shipInIskPerM3: numberParam('Input shipping: ISK per m³. Shipping is on when this or the collateral > 0.', {
		min: 0,
		max: 1e6,
		default: 0
	}),
	shipInCollateral: numberParam('Input shipping: collateral fee in percent of the goods value.', {
		min: 0,
		max: 100,
		default: 0
	}),
	shipInDiscount: numberParam('Input shipping: discount in percent on the whole shipping price.', {
		min: 0,
		max: 100,
		default: 0
	}),
	shipOutIskPerM3: numberParam(
		'Output shipping: ISK per m³. Shipping is on when this or the collateral > 0.',
		{
			min: 0,
			max: 1e6,
			default: 0
		}
	),
	shipOutCollateral: numberParam('Output shipping: collateral fee in percent of the goods value.', {
		min: 0,
		max: 100,
		default: 0
	}),
	shipOutDiscount: numberParam('Output shipping: discount in percent on the whole shipping price.', {
		min: 0,
		max: 100,
		default: 0
	}),
	cycleDays: numberParam('Days between job starts (one cycle).', {
		min: 0.25,
		max: 30,
		default: DEFAULT_SETTINGS.cycleDays
	}),
	unrefinedYield: numberParam('Reprocessing yield of unrefined products in percent.', {
		min: 0,
		max: 100,
		default: R.unrefinedYieldPct
	}),
	prismaticiteYield: numberParam('Reprocessing yield of Prismaticite in percent.', {
		min: 0,
		max: 100,
		default: R.prismaticiteYieldPct
	}),
	prismaticiteRoll: numberParam('Expected Prismaticite roll in percent of the maximum.', {
		min: 0,
		max: 100,
		default: R.prismaticiteRollPct
	}),
	unrefinedInChains: enumParam(
		'view=best and POST /plan: never = full chains with regular reactions only; best = build an intermediate with its unrefined reaction and reprocess it where that raises the chain profit per slot-day. view=chain is always regular and view=unrefined always uses the routes.',
		['never', 'best'],
		DEFAULT_SETTINGS.unrefinedInChains
	)
};

/** Full-chain slot allocation and line count (`profits` endpoints). */
export const ALLOCATION_PARAMS = {
	slots: enumParam(
		'Full-chain slot allocation: single = one line run job after job in one slot; optimal = parallel lines filling every slot of a cycle.',
		['single', 'optimal'],
		DEFAULT_SETTINGS.slotAllocation
	),
	maxLines: numberParam(
		'Highest number of final-product lines slots=optimal tries per chain (setting Max parallel lines).',
		{ min: 1, max: MAX_PARALLEL_LINES, integer: true, default: DEFAULT_SETTINGS.maxParallelLines }
	),
	lines: numberParam(
		`Fixed number of final-product lines for slots=optimal (chains only); default picks the best of 1 to maxLines (setting, default ${DEFAULT_SETTINGS.maxParallelLines}).`,
		{ min: 1, max: MAX_PICKED_LINES, integer: true }
	)
};

export const DATE_PARAM = {
	date: dateParam('Historical prices: daily averages of this UTC day (up to 400 days back, until yesterday).')
};

export type SettingsValues = Partial<QueryValues<typeof SETTINGS_PARAMS>> & {
	slots?: 'single' | 'optimal';
	maxLines?: number;
};

/**
 * `lines` fixes the optimal allocation's line count, so it needs `slots=optimal` and a view that
 * computes full chains; anything else is a 400 rather than a silently ignored parameter.
 */
export function checkLines(q: { slots?: string; lines?: number }, chainView: boolean): void {
	if (q.lines === undefined) return;
	if (q.slots !== 'optimal') throw invalidParam('lines', 'Requires slots=optimal');
	if (!chainView) throw invalidParam('lines', 'Applies to full chains only');
}

/** `system` as id or exact name; unknown → 400, highsec → 400. */
async function resolveSystemId(env: Pick<Env, 'DB'>, text: string): Promise<number> {
	const system = /^\d+$/.test(text)
		? ((await getSystemsByIds(env, [Number(text)])).get(Number(text)) ?? null)
		: await getSystemByName(env, text);
	if (!system) throw invalidParam('system', `Unknown system "${text}"`);
	if (system.securityBand === 'highsec')
		throw invalidParam('system', `${system.name} is a highsec system; reactions need low, null or J-space`);
	return system.id;
}

const shipping = (iskPerM3: number, collateralPct: number, discountPct: number) => ({
	enabled: iskPerM3 > 0 || collateralPct > 0,
	iskPerM3,
	collateralPct,
	discountPct
});

/** Shared-mode settings: `DEFAULT_SETTINGS` with every given parameter applied. */
export async function settingsFromQuery(env: Pick<Env, 'DB'>, q: SettingsValues): Promise<Settings> {
	const d = DEFAULT_SETTINGS;
	const profile: ReactorProfile = {
		structure: q.structure ?? P.structure,
		meRig: q.meRig ?? P.meRig,
		teRig: q.teRig ?? P.teRig,
		systemId: q.system === undefined ? P.systemId : await resolveSystemId(env, q.system),
		costIndexOverridePct: q.costIndex ?? P.costIndexOverridePct,
		facilityTaxPct: q.facilityTax ?? P.facilityTaxPct,
		sccPct: q.scc ?? P.sccPct,
		reactionsSkill: q.skill ?? P.reactionsSkill,
		market: {
			inputHub: q.inputHub ?? M.inputHub,
			inputFallbackHub: q.inputFallbackHub ?? M.inputFallbackHub,
			outputHub: q.outputHub ?? M.outputHub,
			inputMethod: q.inputMethod ?? M.inputMethod,
			outputMethod: q.outputMethod ?? M.outputMethod,
			inputContractBasis: q.inputBasis ?? M.inputContractBasis,
			outputContractBasis: q.outputBasis ?? M.outputContractBasis,
			inputPricePct: q.inputPricePct ?? M.inputPricePct,
			outputPricePct: q.outputPricePct ?? M.outputPricePct,
			brokerFeePct: q.broker ?? M.brokerFeePct,
			salesTaxPct: q.salesTax ?? M.salesTaxPct
		},
		shipping: {
			input: shipping(q.shipInIskPerM3 ?? 0, q.shipInCollateral ?? 0, q.shipInDiscount ?? 0),
			output: shipping(q.shipOutIskPerM3 ?? 0, q.shipOutCollateral ?? 0, q.shipOutDiscount ?? 0)
		}
	};
	return Settings.parse({
		...structuredClone(d),
		mode: 'shared',
		shared: profile,
		cycleDays: q.cycleDays ?? d.cycleDays,
		slotAllocation: q.slots ?? d.slotAllocation,
		maxParallelLines: q.maxLines ?? d.maxParallelLines,
		unrefinedInChains: q.unrefinedInChains ?? d.unrefinedInChains,
		reprocessing: {
			unrefinedYieldPct: q.unrefinedYield ?? R.unrefinedYieldPct,
			prismaticiteYieldPct: q.prismaticiteYield ?? R.prismaticiteYieldPct,
			prismaticiteRollPct: q.prismaticiteRoll ?? R.prismaticiteRollPct
		}
	});
}

/**
 * `POST /plan` settings: a partial `Settings` object (merged onto the defaults) or an encoded settings
 * string (as in share links). Invalid values → 400 naming `settings.<path>`.
 */
export async function settingsFromBody(value: unknown): Promise<Settings> {
	if (value === undefined) return structuredClone(DEFAULT_SETTINGS);
	if (typeof value === 'string') {
		const decoded = await decodeSettings(value);
		if (!decoded) throw invalidParam('settings', 'Not a valid encoded settings string');
		return decoded;
	}
	const parsed = Settings.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new ApiError(
		400,
		'INVALID_PARAM',
		'Invalid request parameters.',
		parsed.error.issues.map((issue) => ({
			param: ['settings', ...issue.path].join('.'),
			message: issue.message
		}))
	);
}

/** Every hub of every profile the settings use must be public (404 otherwise); returns those profiles. */
function requireSettingsHubs(settings: Settings, hubs: HubInfo[]): ProfileKey[] {
	const keys = profilesInUse(settings);
	for (const key of keys) {
		const market = key === 'shared' ? settings.shared.market : settings.reactors[key].market;
		requireHub(hubs, market.inputHub);
		requireHub(hubs, market.inputFallbackHub);
		requireHub(hubs, market.outputHub);
	}
	return keys;
}

/**
 * Hubs and systems of every profile the settings use: a hub that is not public → 404, an unknown or
 * highsec system → 400 naming `<prefix><profile>.systemId`.
 */
export async function checkSettingsReferences(
	env: Pick<Env, 'DB'>,
	settings: Settings,
	hubs: HubInfo[],
	prefix = 'settings.'
): Promise<void> {
	const keys = requireSettingsHubs(settings, hubs);
	const errors = referenceErrors(
		settings,
		keys,
		await systemsFor(env, [settings]),
		new Set(hubs.map((h) => h.hubId))
	);
	const details = Object.entries(errors).map(([path, message]) => ({ param: prefix + path, message }));
	if (details.length) throw new ApiError(400, 'INVALID_PARAM', 'Invalid request parameters.', details);
}

/** `date` must lie in the historical range (400 days ago … yesterday, UTC). */
export function checkDate(date: string | undefined, now: number, param = 'date'): void {
	if (date === undefined) return;
	const { min, max } = dateBounds(now);
	if (date < min || date > max) throw invalidParam(param, `Must be between ${min} and ${max}`);
}

/**
 * Engine context for anonymous API requests: the settings' hubs must be public (404 otherwise); `date`
 * prices everything with that day's history. Missing reference data → 503.
 */
export async function loadApiCalc(
	env: Env,
	settings: Settings,
	opts: { date?: string; now?: number; hubs?: HubInfo[] } = {}
): Promise<RequestCalc> {
	checkDate(opts.date, opts.now ?? Date.now());
	const hubs = opts.hubs ?? (await publicHubs(env));
	requireSettingsHubs(settings, hubs);
	const calc = await loadCalc(env, { settings, user: null }, { date: opts.date, hubs });
	if (!calc) throw new ApiError(503, 'INTERNAL', 'Market data is not available yet.');
	return calc;
}
