import {
	planReactions,
	producerIndex,
	type CalcContext,
	type Dataset,
	type FillOptions,
	type PlanInput,
	type PlanResult,
	type PlanTarget,
	type PriceBook,
	type Reactor,
	type ResolvedProfile,
	type Settings,
	type Tier
} from '@reactions/engine';
import type { SettingsSummaryData } from '$lib/components/listing/types';

export interface PlannerHub {
	hubId: string;
	name: string;
	regionId: number;
	/** SDE region name; `null` when the region is not in the database. */
	regionName: string | null;
	private: boolean;
	/** A player structure market (private or approved public). */
	structure: boolean;
}

/** `/planner` load data: everything the client-side engine needs for this visitor. */
export interface PlannerData {
	available: true;
	dataset: Dataset;
	/** Current prices of the visitor's accessible hubs (outputs, and inputs unless `inputPrices` is set). */
	prices: PriceBook;
	/** Input prices of `inputsDaysAgo` days ago; `null` when inputs are priced now. */
	inputPrices: PriceBook | null;
	inputsDaysAgo: number;
	profiles: Record<Reactor, ResolvedProfile>;
	/** Profile warnings such as `HUB_UNAVAILABLE`. */
	profileWarnings: string[];
	settings: Settings;
	hubs: PlannerHub[];
	/** 30-day average daily volume: region id → type id (products and reaction inputs) → units per day. */
	volumes: Record<number, Record<number, number>>;
	/** Settings chip (shared mode only; per-reactor profiles differ). */
	settingsSummary: SettingsSummaryData | null;
	/**
	 * Set when `?s=` carries settings that differ from the visitor's own: the page is computed with the
	 * shared settings. `planCode` is the same plan without settings (the visitor's settings apply);
	 * `importCode` opens them in the `/settings?import=` preview.
	 */
	sharedSettings: { planCode: string; importCode: string } | null;
}

export interface PlannerUnavailable {
	available: false;
}

/** Engine context with the locally edited cycle length. */
export function plannerContext(data: PlannerData, cycleDays: number): CalcContext {
	return {
		dataset: data.dataset,
		profiles: data.profiles,
		settings: { ...data.settings, cycleDays },
		inputPrices: data.inputPrices ?? data.prices,
		outputPrices: data.prices
	};
}

export interface ProductVolume {
	/** Region of the hub the type is sold (products) or bought (inputs) at. */
	regionName: string;
	/** 30-day average units traded per day there; `null` without statistics. */
	volume: number | null;
}

/** Types whose regional daily volume the planner compares against: reaction products and inputs. */
export function volumeTypes(dataset: Dataset): Set<number> {
	const ids = new Set<number>();
	for (const r of dataset.reactions) {
		ids.add(r.product.typeId);
		for (const m of r.materials) ids.add(m.typeId);
	}
	return ids;
}

/**
 * Every reaction product's market: the region of the output hub where its reactor's profile sells it and
 * that region's 30-day average daily volume. Products whose output hub is unknown are left out.
 */
export function productVolumes(
	data: Pick<PlannerData, 'dataset' | 'profiles' | 'volumes'> & {
		hubs: Pick<PlannerHub, 'hubId' | 'regionId' | 'regionName'>[];
	}
): Record<number, ProductVolume> {
	const hubOf = new Map(data.hubs.map((h) => [h.hubId, h]));
	const result: Record<number, ProductVolume> = {};
	for (const r of data.dataset.reactions) {
		const hub = hubOf.get(data.profiles[r.reactor].market.outputHub);
		if (!hub) continue;
		result[r.product.typeId] = {
			regionName: hub.regionName ?? `Region ${hub.regionId}`,
			volume: data.volumes[hub.regionId]?.[r.product.typeId] ?? null
		};
	}
	return result;
}

/** The planner's `dailyVolumes`: products with statistics only. */
export function dailyVolumes(volumes: Record<number, ProductVolume>): Record<number, number> {
	const result: Record<number, number> = {};
	for (const [typeId, v] of Object.entries(volumes)) if (v.volume !== null) result[Number(typeId)] = v.volume;
	return result;
}

/**
 * Every reaction input's market: the region of the input hub of the first reaction (dataset order) that
 * consumes it and that region's 30-day average daily volume. Inputs whose input hub is unknown are left
 * out.
 */
export function inputVolumes(
	data: Pick<PlannerData, 'dataset' | 'profiles' | 'volumes'> & {
		hubs: Pick<PlannerHub, 'hubId' | 'regionId' | 'regionName'>[];
	}
): Record<number, ProductVolume> {
	const hubOf = new Map(data.hubs.map((h) => [h.hubId, h]));
	const result: Record<number, ProductVolume> = {};
	for (const r of data.dataset.reactions) {
		const hub = hubOf.get(data.profiles[r.reactor].market.inputHub);
		if (!hub) continue;
		for (const m of r.materials) {
			result[m.typeId] ??= {
				regionName: hub.regionName ?? `Region ${hub.regionId}`,
				volume: data.volumes[hub.regionId]?.[m.typeId] ?? null
			};
		}
	}
	return result;
}

/** The planner's `inputDailyVolumes`: each hub's region volumes, keyed by hub id. */
export function hubDailyVolumes(
	data: Pick<PlannerData, 'volumes'> & { hubs: Pick<PlannerHub, 'hubId' | 'regionId'>[] }
): Record<string, Record<number, number>> {
	return Object.fromEntries(data.hubs.map((h) => [h.hubId, data.volumes[h.regionId] ?? {}]));
}

/** Input hub and fallback hub every profile shares (names for warnings); `null` when profiles differ. */
export interface InputMarket {
	name: string;
	fallbackName: string;
	/** The input hub is a player structure market. */
	structure: boolean;
}

export function inputMarket(data: Pick<PlannerData, 'profiles' | 'hubs'>): InputMarket | null {
	const markets = Object.values(data.profiles).map((p) => p.market);
	const { inputHub, inputFallbackHub } = markets[0];
	if (markets.some((m) => m.inputHub !== inputHub || m.inputFallbackHub !== inputFallbackHub)) return null;
	const hub = data.hubs.find((h) => h.hubId === inputHub);
	return {
		name: hub?.name ?? inputHub,
		fallbackName: data.hubs.find((h) => h.hubId === inputFallbackHub)?.name ?? inputFallbackHub,
		structure: hub?.structure ?? false
	};
}

export const FILL_SCOPE_IDS = [
	'all',
	'composite_chains',
	'composite_buy',
	'intermediates',
	'boosters',
	'molecular_forged',
	'polymers'
] as const;
export type FillScope = (typeof FILL_SCOPE_IDS)[number];

/** What "Auto-fill best" may pick: tiers (`null` = the engine's default set) and how intermediates are made. */
export const FILL_SCOPES: Record<
	FillScope,
	{ label: string; tiers: readonly Tier[] | null; buyIntermediates: boolean }
> = {
	all: { label: 'All', tiers: null, buyIntermediates: false },
	composite_chains: { label: 'Composite chains', tiers: ['composite'], buyIntermediates: false },
	composite_buy: { label: 'Composites, buying intermediates', tiers: ['composite'], buyIntermediates: true },
	intermediates: { label: 'Intermediates', tiers: ['intermediate'], buyIntermediates: false },
	boosters: {
		label: 'Biochemical: Strong / Improved boosters',
		tiers: ['booster_strong', 'booster_improved'],
		buyIntermediates: false
	},
	molecular_forged: { label: 'Molecular-Forged', tiers: ['molecular_forged'], buyIntermediates: false },
	polymers: { label: 'Hybrid polymers', tiers: ['polymer'], buyIntermediates: false }
};

/** Engine `suggestFillPlan` options for a scope and a daily-volume cap (percent). */
export function fillOptions(scope: FillScope, maxVolumeSharePct: number): FillOptions {
	const { tiers, buyIntermediates } = FILL_SCOPES[scope];
	return {
		...(tiers ? { allowed: (r) => tiers.includes(r.tier) } : {}),
		maxVolumeSharePct,
		buyIntermediates
	};
}

export interface BuildBuyItem {
	/** Product type id (the `buyInsteadOfBuild` key). */
	typeId: number;
	name: string;
	buy: boolean;
}

/**
 * Intermediates the plan builds (reactions below the final products; an unrefined job counts as the
 * materials it is reprocessed into) plus the ones it currently buys instead, as long as a planned
 * reaction still consumes them; sorted by name.
 */
export function buildBuyItems(plan: PlanResult, buy: readonly number[], dataset: Dataset): BuildBuyItem[] {
	const byId = new Map(dataset.reactions.map((r) => [r.blueprintTypeId, r]));
	const producers = producerIndex(dataset);
	const items = new Map<number, BuildBuyItem>();
	for (const pr of plan.reactions) {
		const reaction = byId.get(pr.blueprintTypeId);
		if (!reaction) continue;
		if (pr.depth > 0) {
			const made = pr.reprocess
				? pr.reprocess.replaces.map((r) => ({ typeId: r.typeId, name: r.regularName }))
				: [{ typeId: reaction.product.typeId, name: pr.name }];
			for (const { typeId, name } of made) items.set(typeId, { typeId, name, buy: false });
		}
		for (const m of reaction.materials) {
			const producer = producers.get(m.typeId);
			if (producer && buy.includes(m.typeId))
				items.set(m.typeId, { typeId: m.typeId, name: producer.name, buy: true });
		}
	}
	return [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface TargetFootprint {
	/** Slots of one line on its own (with its intermediates). */
	perLine: number;
	/** Slots of the whole target on its own (lines or quantity; shared intermediates round once). */
	total: number;
	/** Slots of the target reaction itself (the final product's slots). */
	finalSlots: number;
	/** Units one full line makes per cycle. */
	unitsPerLine: number;
}

/** Slots one target needs on its own, planned with the same inputs (build/buy choices, cycle). */
export function targetFootprint(input: PlanInput, target: PlanTarget): TargetFootprint {
	const alone = (t: PlanTarget) =>
		planReactions({ ...input, totalSlots: Number.POSITIVE_INFINITY, targets: [t] });
	const line = alone({ blueprintTypeId: target.blueprintTypeId, lines: 1 });
	const full = target.quantity === undefined && target.lines === 1 ? line : alone(target);
	return {
		perLine: line.slotsUsed,
		total: full.slotsUsed,
		finalSlots: full.reactions.find((r) => r.blueprintTypeId === target.blueprintTypeId)?.slots ?? 0,
		unitsPerLine: line.outputsPerCycle[0]?.quantity ?? 0
	};
}
