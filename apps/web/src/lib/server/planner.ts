import { getCoreDb, marketStats, regions } from '@reactions/db';
import { encodeSettings, settingsDiff, type Dataset, type PriceBook, type Settings } from '@reactions/engine';
import { inArray } from 'drizzle-orm';
import { volumeTypes, type PlannerData, type PlannerUnavailable } from '$lib/planner/plan';
import { decodeShare, encodeShare } from '$lib/planner/state';
import { loadCalc } from './context.ts';
import { clampDays } from './detail.ts';
import { summarizeSettings } from './listing.ts';
import { getPriceBookNear } from './prices.ts';
import { normalizeSettings } from './settingsForm.ts';

const DAY_MS = 86_400_000;

/** Union of reaction blueprint, material, product and reprocess output ids (the updater's tracked set). */
export function trackedTypes(dataset: Dataset): Set<number> {
	const ids = new Set<number>();
	for (const r of dataset.reactions) {
		ids.add(r.blueprintTypeId);
		ids.add(r.product.typeId);
		for (const m of r.materials) ids.add(m.typeId);
	}
	for (const entry of Object.values(dataset.reprocess)) for (const m of entry.materials) ids.add(m.typeId);
	return ids;
}

/** The book restricted to the given hubs and types (keeps the page payload small). */
export function leanBook(
	book: PriceBook,
	hubIds: ReadonlySet<string>,
	types: ReadonlySet<number>
): PriceBook {
	const pick = <T>(record: Record<number, T>) =>
		Object.fromEntries(Object.entries(record).filter(([id]) => types.has(Number(id)))) as Record<number, T>;
	return {
		...book,
		hubs: Object.fromEntries(
			Object.entries(book.hubs)
				.filter(([hubId]) => hubIds.has(hubId))
				.map(([hubId, prices]) => [hubId, pick(prices)])
		),
		adjusted: pick(book.adjusted)
	};
}

/** Regional trade statistics of one type (`market_stats`, from the ESI daily history). */
export interface MarketStat {
	/** Average units traded per day over 30 days. */
	volume30d: number;
	/** Over 7 days; `null` until the daily run has computed it. */
	volume7d: number | null;
	/** Average traded price over the last 5 and 30 days. */
	price5d: number;
	price30d: number;
}

/** `market_stats` of every type in the given regions: region → type → statistics. */
export async function getMarketStats(
	env: Pick<Env, 'DB'>,
	regionIds: number[]
): Promise<Record<number, Record<number, MarketStat>>> {
	const regions = [...new Set(regionIds)];
	const result: Record<number, Record<number, MarketStat>> = {};
	if (regions.length === 0) return result;
	// One bound parameter per region (a handful of hubs); callers filter types.
	const rows = await getCoreDb(env.DB)
		.select({
			regionId: marketStats.regionId,
			typeId: marketStats.typeId,
			volume30d: marketStats.avgDailyVolume30d,
			volume7d: marketStats.avgDailyVolume7d,
			price5d: marketStats.avgPrice5d,
			price30d: marketStats.avgPrice30d
		})
		.from(marketStats)
		.where(inArray(marketStats.regionId, regions));
	for (const { regionId, typeId, ...stat } of rows) (result[regionId] ??= {})[typeId] = stat;
	return result;
}

/** `market_stats` 30-day average daily volumes of `typeIds` in the given regions: region → type → volume. */
export async function getRegionVolumes(
	env: Pick<Env, 'DB'>,
	regionIds: number[],
	typeIds: ReadonlySet<number>
): Promise<Record<number, Record<number, number>>> {
	const stats = await getMarketStats(env, regionIds);
	const result: Record<number, Record<number, number>> = {};
	for (const [regionId, types] of Object.entries(stats))
		for (const [typeId, s] of Object.entries(types))
			if (typeIds.has(Number(typeId))) (result[Number(regionId)] ??= {})[Number(typeId)] = s.volume30d;
	return result;
}

/** `?inputsDaysAgo=N`: whole days 0–60; anything else is 0 (inputs priced now). */
export function parseInputsDaysAgo(url: URL): number {
	const n = Number(url.searchParams.get('inputsDaysAgo') ?? 0);
	return Number.isFinite(n) ? clampDays(n) : 0;
}

type Locals = Pick<App.Locals, 'settings' | 'user'>;

/**
 * Settings of a `?s=` share link that differ from the visitor's own (compared as sparse diffs, the
 * shared-mode `reactors` ignored), with the codes of the notice links; `null` without a link, without
 * settings in it or when they match.
 */
export async function sharedPlanSettings(
	code: string | null,
	own: Settings
): Promise<{ settings: Settings; notice: NonNullable<PlannerData['sharedSettings']> } | null> {
	const shared = code ? await decodeShare(code) : null;
	if (!shared?.settings) return null;
	const settings = normalizeSettings(shared.settings);
	if (Object.keys(settingsDiff(settings, normalizeSettings(own))).length === 0) return null;
	const [planCode, importCode] = await Promise.all([encodeShare(shared.state), encodeSettings(settings)]);
	return { settings, notice: { planCode, importCode } };
}

/** `/planner` data: dataset, lean price books, resolved profiles, settings, hubs and market volumes. */
export async function loadPlanner(
	env: Env | undefined,
	locals: Locals,
	url: URL,
	now = Date.now()
): Promise<PlannerData | PlannerUnavailable> {
	const shared = env ? await sharedPlanSettings(url.searchParams.get('s'), locals.settings) : null;
	const calc = env ? await loadCalc(env, shared ? { ...locals, settings: shared.settings } : locals) : null;
	if (!env || !calc) return { available: false };
	const { ctx, dataset, hubs } = calc;
	const hubIds = new Set(hubs.map((h) => h.hubId));
	const types = trackedTypes(dataset);
	const inputsDaysAgo = parseInputsDaysAgo(url);
	const regionIds = [...new Set(hubs.map((h) => h.regionId))];
	const [inputBook, volumes, regionRows] = await Promise.all([
		inputsDaysAgo > 0
			? getPriceBookNear(env, now - inputsDaysAgo * DAY_MS, hubs, dataset, calc.market.adjusted)
			: null,
		getRegionVolumes(env, regionIds, volumeTypes(dataset)),
		regionIds.length
			? getCoreDb(env.DB)
					.select({ regionId: regions.regionId, name: regions.name })
					.from(regions)
					.where(inArray(regions.regionId, regionIds))
			: []
	]);
	const regionName = new Map(regionRows.map((r) => [r.regionId, r.name]));
	return {
		available: true,
		dataset,
		prices: leanBook(ctx.outputPrices, hubIds, types),
		inputPrices: inputBook && leanBook(inputBook, hubIds, types),
		inputsDaysAgo,
		profiles: ctx.profiles,
		profileWarnings: calc.warnings,
		settings: ctx.settings,
		hubs: hubs.map((h) => ({
			hubId: h.hubId,
			name: h.name,
			regionId: h.regionId,
			regionName: regionName.get(h.regionId) ?? null,
			private: h.private,
			structure: h.kind === 'structure'
		})),
		volumes,
		settingsSummary: ctx.settings.mode === 'shared' ? summarizeSettings(ctx.profiles.composite, hubs) : null,
		sharedSettings: shared?.notice ?? null
	};
}
