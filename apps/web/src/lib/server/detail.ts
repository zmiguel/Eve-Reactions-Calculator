import { getCoreDb, regions } from '@reactions/db';
import {
	calculateAllocated,
	isFuelBlock,
	chainable,
	reprocessable,
	unrefinable,
	type ChainNode,
	type Dataset,
	type OutputMode,
	type Reaction,
	type Reactor,
	type ReactionResult,
	type ResolvedProfile,
	type SlotAllocation,
	type View
} from '@reactions/engine';
import { error, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { MAX_PICKED_LINES } from '$lib/components/detail/links';
import { defaultTabsOf, tabsFor, type ReactionTabs } from '$lib/components/listing/links';
import type { SettingsSummaryData } from '$lib/components/listing/types';
import { loadCalc } from './context.ts';
import { summarizeSettings } from './listing.ts';
import { getPriceBookNear } from './prices.ts';
import {
	DEFAULT_SERIES_RANGE,
	SERIES_RANGES,
	getProfitSeries,
	getVolumeSeries,
	type SeriesPoint,
	type SeriesRange,
	type VolumePoint
} from './series.ts';

export const MAX_BOUGHT_DAYS = 60;
const DAY_MS = 86_400_000;
/** Engine warnings caused by the visitor's profile; the settings summary shows them. */
const PROFILE_WARNINGS = new Set(['HUB_UNAVAILABLE', 'COST_INDEX_MISSING']);

export type DetailRoute =
	{ kind: 'found'; reaction: Reaction } | { kind: 'redirect'; location: string } | { kind: 'not_found' };

/**
 * Reaction for `/<reactor>/<slug>`: a numeric slug is a product type id, a slug of another reactor
 * redirects there (both keep the query string).
 */
export function resolveDetailRoute(
	dataset: Dataset,
	reactor: Reactor,
	slug: string,
	search = ''
): DetailRoute {
	const reaction = /^\d+$/.test(slug)
		? dataset.reactions.find((r) => r.product.typeId === Number(slug))
		: dataset.reactions.find((r) => r.slug === slug);
	if (!reaction) return { kind: 'not_found' };
	if (reaction.reactor !== reactor || reaction.slug !== slug)
		return { kind: 'redirect', location: `/${reaction.reactor}/${reaction.slug}${search}` };
	return { kind: 'found', reaction };
}

export const clampDays = (n: number) => Math.min(MAX_BOUGHT_DAYS, Math.max(0, Math.round(n)));

/** Days between buying inputs and selling the output: one cycle per chain level. */
export const defaultBoughtDays = (chainDepth: number, cycleDays: number) => clampDays(chainDepth * cycleDays);

export interface DetailQuery {
	view: View;
	outputMode: OutputMode;
	/** `?bought=` clamped to 0–60, or null when absent/invalid (the default then applies). */
	bought: number | null;
	range: SeriesRange;
	/** `?slots=` override of the chain slot allocation (chain views only), or null for the setting. */
	slots: SlotAllocation | null;
	/** `?lines=` 1–{@link MAX_PICKED_LINES} (chain views only), or null for the automatic choice. */
	lines: number | null;
}

/**
 * Query options that apply to this reaction; inapplicable or invalid values fall back to defaults.
 * Without `?view=` / `?output=` the visitor's preferred tabs apply (the full chain only where one
 * exists, reprocessing only where it applies). `?view=unrefined` without an unrefined route in the
 * chain falls back to the full chain.
 */
export function parseDetailQuery(
	params: URLSearchParams,
	reaction: Reaction,
	dataset: Dataset,
	defaults: ReactionTabs = { view: 'single', output: 'product' }
): DetailQuery {
	const rawBought = params.get('bought');
	const bought = rawBought !== null && rawBought.trim() !== '' ? Number(rawBought) : NaN;
	const range = params.get('range');
	const rawView = params.get('view');
	const wantedView =
		rawView === 'chain' || rawView === 'single' || rawView === 'unrefined' ? rawView : defaults.view;
	const view: View =
		wantedView === 'single' || !chainable(reaction, dataset)
			? 'single'
			: wantedView === 'unrefined' && unrefinable(reaction, dataset)
				? 'unrefined'
				: 'chain';
	const chainView = view !== 'single';
	const rawOutput = params.get('output');
	const wantedOutput = rawOutput === 'reprocessed' || rawOutput === 'product' ? rawOutput : defaults.output;
	const slots = params.get('slots');
	const lines = Number(params.get('lines'));
	return {
		view,
		outputMode:
			wantedOutput === 'reprocessed' && reprocessable(reaction, dataset) ? 'reprocessed' : 'product',
		bought: Number.isFinite(bought) ? clampDays(bought) : null,
		range: SERIES_RANGES.includes(range as SeriesRange) ? (range as SeriesRange) : DEFAULT_SERIES_RANGE,
		slots: chainView && (slots === 'single' || slots === 'optimal') ? slots : null,
		lines: chainView && Number.isInteger(lines) && lines >= 1 && lines <= MAX_PICKED_LINES ? lines : null
	};
}

/**
 * The single-view result as one job (the engine only builds a tree for chains): every material is
 * bought, so the job's materials are the result's inputs and its costs are the totals.
 */
export function singleStepNode(
	result: ReactionResult,
	reaction: Reaction,
	profile: Pick<ResolvedProfile, 'costIndex' | 'facilityTaxPct' | 'sccPct'>
): ChainNode {
	const produced = result.runs * reaction.product.quantity;
	const t = result.totals;
	return {
		blueprintTypeId: reaction.blueprintTypeId,
		name: reaction.name,
		reactor: reaction.reactor,
		runs: result.runs,
		runTimeSeconds: result.runTimeSeconds,
		quantityProduced: produced,
		quantityUsed: produced,
		surplus: 0,
		jobCost: result.jobCost,
		children: [],
		productTypeId: reaction.product.typeId,
		depth: 0,
		step: 1,
		materials: result.inputs.map((item) => ({ ...item, source: 'buy' as const })),
		slotSeconds: t.slotSeconds,
		jobRates: {
			costIndex: profile.costIndex,
			facilityTaxPct: profile.facilityTaxPct,
			sccPct: profile.sccPct
		},
		subtotal: {
			purchaseCost: t.inputCost,
			purchaseFees: t.inputFees,
			purchaseShipping: t.inputShipping,
			jobCost: t.jobCost,
			total: t.totalCost
		}
	};
}

export interface PriceTiming {
	days: number;
	defaultDays: number;
	/** Timestamp (ISO) or date of the historical input book. */
	asOf: string;
	approximate: boolean;
	then: { profit: number | null; profitPerSlotDay: number | null; inputCost: number };
	now: { profit: number | null; profitPerSlotDay: number | null; inputCost: number };
}

export interface DetailData {
	available: true;
	reaction: {
		name: string;
		slug: string;
		reactor: Reactor;
		tier: string;
		formulaName: string;
		blueprintTypeId: number;
		productTypeId: number;
	};
	chainable: boolean;
	/** The chain builds an intermediate that has an unrefined route (the "Using unrefined" tab exists). */
	unrefinable: boolean;
	reprocessable: boolean;
	query: DetailQuery;
	/** Chain slot allocation in effect: the `?slots=` override, else the visitor's setting. */
	slotAllocation: SlotAllocation;
	/** The visitor's setting (links back to it drop `?slots=`). */
	defaultSlotAllocation: SlotAllocation;
	/**
	 * Tabs this reaction opens on without `?view=` / `?output=`: the visitor's preferences where they
	 * apply (links to these tabs drop the parameter).
	 */
	defaultTabs: ReactionTabs;
	result: ReactionResult;
	timing: PriceTiming;
	series: SeriesPoint[];
	/** Units of the product traded per day in the output hub's region over the same range. */
	volumeSeries: { regionName: string; points: VolumePoint[] };
	/** Jobs of the shown view: the chain, or the single reaction as one job (steps and flowchart). */
	root: ChainNode;
	/** Fuel block type ids: the material flow draws them at the top, like every material list. */
	fuelTypeIds: number[];
	settingsSummary: SettingsSummaryData;
	cycleDays: number;
	/** Visitor-profile warnings shown by the settings summary (`HUB_UNAVAILABLE`, `COST_INDEX_MISSING`). */
	profileWarnings: string[];
	/** Reaction-level engine warnings (`SKILL_TOO_LOW`, `MISSING_ADJUSTED_PRICE`, …). */
	warnings: string[];
	missing: { typeId: number; name: string }[];
	pricesAsOf: string;
	/**
	 * Input market of the reaction's profile: hub names for the per-market split, and whether the
	 * purchase tables show the units listed at the input hub (structure input hub, or a split input).
	 */
	inputMarket: { name: string; fallbackName: string; showAvailable: boolean; names: Record<string, string> };
}

export interface DetailUnavailable {
	available: false;
	reactor: Reactor;
	slug: string;
}

type Locals = Pick<App.Locals, 'settings' | 'user'>;

/** Detail page data; throws SvelteKit redirects (301) and 404s. */
export async function loadDetail(
	env: Env | undefined,
	locals: Locals,
	params: { reactor: Reactor; slug: string },
	url: URL,
	now = Date.now()
): Promise<DetailData | DetailUnavailable> {
	const calc = env ? await loadCalc(env, locals) : null;
	if (!env || !calc) return { available: false, reactor: params.reactor, slug: params.slug };
	const { ctx, dataset } = calc;

	const route = resolveDetailRoute(dataset, params.reactor, params.slug, url.search);
	if (route.kind === 'redirect') redirect(301, route.location);
	if (route.kind === 'not_found') error(404, 'Reaction not found');
	const { reaction } = route;

	const isChainable = chainable(reaction, dataset);
	const isUnrefinable = isChainable && unrefinable(reaction, dataset);
	const isReprocessable = reprocessable(reaction, dataset);
	const defaultTabs = tabsFor(defaultTabsOf(ctx.settings), {
		chain: isChainable,
		unrefined: isUnrefinable,
		reprocessed: isReprocessable
	});
	const query = parseDetailQuery(url.searchParams, reaction, dataset, defaultTabs);
	const opts = {
		view: query.view,
		outputMode: query.outputMode,
		slotAllocation: query.slots ?? ctx.settings.slotAllocation,
		lines: query.lines ?? undefined
	};
	const result = calculateAllocated(reaction, ctx, opts);
	// Past prices keep today's allocation (same runs, same number of lines, same unrefined routes).
	const sameJobs = {
		...opts,
		runs: result.runs,
		lines: result.allocation?.lines,
		viaUnrefined: result.viaUnrefined
	};

	const defaultDays = defaultBoughtDays(result.chainDepth, ctx.settings.cycleDays);
	const days = query.bought ?? defaultDays;
	const outputRegion =
		calc.hubs.find((h) => h.hubId === ctx.profiles[reaction.reactor].market.outputHub)?.regionId ?? null;
	const [historical, series, volumePoints, regionRow] = await Promise.all([
		getPriceBookNear(env, now - days * DAY_MS, calc.hubs, dataset, calc.market.adjusted),
		getProfitSeries(env, reaction, ctx, query.range, {
			...sameJobs,
			now,
			hubRegions: Object.fromEntries(calc.hubs.map((h) => [h.hubId, h.regionId]))
		}),
		outputRegion === null
			? []
			: getVolumeSeries(env, outputRegion, reaction.product.typeId, query.range, now),
		outputRegion === null
			? undefined
			: getCoreDb(env.DB)
					.select({ name: regions.name })
					.from(regions)
					.where(eq(regions.regionId, outputRegion))
					.get()
	]);
	const then = calculateAllocated(reaction, { ...ctx, inputPrices: historical }, sameJobs);

	const profile = ctx.profiles[reaction.reactor];
	const pick = (r: ReactionResult) => ({
		profit: r.totals.profit,
		profitPerSlotDay: r.totals.profitPerSlotDay,
		inputCost: r.totals.inputCost
	});
	const root = result.chain ?? singleStepNode(result, reaction, profile);
	const names = Object.fromEntries(calc.hubs.map((h) => [h.hubId, h.name]));
	const inputHub = calc.hubs.find((h) => h.hubId === profile.market.inputHub);

	return {
		available: true,
		reaction: {
			name: reaction.name,
			slug: reaction.slug,
			reactor: reaction.reactor,
			tier: reaction.tier,
			formulaName: reaction.formulaName,
			blueprintTypeId: reaction.blueprintTypeId,
			productTypeId: reaction.product.typeId
		},
		chainable: isChainable,
		unrefinable: isUnrefinable,
		reprocessable: isReprocessable,
		query,
		slotAllocation: opts.slotAllocation,
		defaultSlotAllocation: ctx.settings.slotAllocation,
		defaultTabs,
		result,
		timing: {
			days,
			defaultDays,
			asOf: historical.asOf,
			approximate: historical.approximate,
			then: pick(then),
			now: pick(result)
		},
		series,
		volumeSeries: {
			regionName: regionRow?.name ?? (outputRegion === null ? 'the region' : `Region ${outputRegion}`),
			points: volumePoints
		},
		root,
		fuelTypeIds: Object.values(dataset.types)
			.filter((t) => isFuelBlock(dataset, t.typeId))
			.map((t) => t.typeId),
		settingsSummary: summarizeSettings(profile, calc.hubs),
		cycleDays: ctx.settings.cycleDays,
		profileWarnings: [...calc.warnings, ...result.warnings.filter((w) => PROFILE_WARNINGS.has(w))],
		warnings: result.warnings.filter((w) => !PROFILE_WARNINGS.has(w)),
		missing: result.missingPrices.map((typeId) => ({
			typeId,
			name: dataset.types[typeId]?.name ?? `Type ${typeId}`
		})),
		pricesAsOf: ctx.outputPrices.asOf,
		inputMarket: {
			name: names[profile.market.inputHub] ?? profile.market.inputHub,
			fallbackName: names[profile.market.inputFallbackHub] ?? profile.market.inputFallbackHub,
			showAvailable:
				(inputHub?.kind === 'structure' || result.warnings.includes('INPUT_VOLUME_SHORT')) &&
				result.inputs.some((i) => i.availableAtInputHub != null),
			names
		}
	};
}
