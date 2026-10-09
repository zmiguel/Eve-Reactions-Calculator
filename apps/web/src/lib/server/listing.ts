import {
	REACTORS,
	type ChainAllocation,
	type Dataset,
	type ReactionResult,
	type ReactionRow,
	type Reactor,
	type ResolvedProfile,
	type Tier
} from '@reactions/engine';
import type {
	RowSummary,
	SectionTab,
	SettingsSummaryData,
	SlotsSummary,
	TierSectionData,
	Variant,
	VariantSummary
} from '$lib/components/listing/types';
import { REACTOR_TIERS } from '$lib/site';
import type { HubInfo } from './hubs.ts';
import { isoDate } from './prices.ts';

export const DAY_MS = 86_400_000;
/** Oldest `?date=` accepted (the ESI history backfill covers ~400 days). */
export const MAX_HISTORY_DAYS = 400;

export function variantOf(result: ReactionResult): Variant {
	if (result.view !== 'single') return result.view;
	return result.outputMode === 'reprocessed' ? 'reprocessed' : 'single';
}

export function summarizeResult(result: ReactionResult, dataset: Dataset): VariantSummary {
	const t = result.totals;
	return {
		profitPerSlotDay: t.profitPerSlotDay,
		profit: t.profit,
		marginPct: t.marginPct,
		inputCost: t.inputCost + t.inputFees + t.inputShipping,
		outputValue: t.outputValue - t.outputFees - t.outputShipping,
		jobCost: t.jobCost,
		runs: result.runs,
		missing:
			t.profit === null
				? [...new Set(result.missingPrices)].map((id) => dataset.types[id]?.name ?? `Type ${id}`)
				: [],
		slots: result.allocation ? summarizeSlots(result.allocation) : null,
		...(result.viaUnrefined.length > 0
			? { unrefined: result.viaUnrefined.map((id) => dataset.types[id]?.name ?? `Type ${id}`) }
			: {})
	};
}

/** Compact slot summary for listing tables: total, slots per build level (final first) and per reaction. */
export function summarizeSlots(a: ChainAllocation): SlotsSummary {
	const levels: number[] = [];
	for (const r of a.reactions) levels[r.depth] = (levels[r.depth] ?? 0) + r.slots;
	return {
		lines: a.lines,
		total: a.slotsUsed,
		levels,
		reactions: a.reactions.map((r) => ({ name: r.name, runsPerSlot: r.runsPerSlot }))
	};
}

export function summarizeRow(row: ReactionRow, dataset: Dataset): RowSummary {
	return {
		blueprintTypeId: row.reaction.blueprintTypeId,
		slug: row.reaction.slug,
		name: row.reaction.name,
		productTypeId: row.reaction.product.typeId,
		single: summarizeResult(row.single, dataset),
		chain: row.chain ? summarizeResult(row.chain, dataset) : null,
		unrefined: row.unrefined ? summarizeResult(row.unrefined, dataset) : null,
		reprocessed: row.reprocessed ? summarizeResult(row.reprocessed, dataset) : null
	};
}

function tabsFor(rows: RowSummary[]): SectionTab[] {
	if (rows.some((r) => r.chain))
		return [
			{ variant: 'single', label: 'Buy inputs' },
			{ variant: 'chain', label: 'Full chain' },
			...(rows.some((r) => r.unrefined) ? [{ variant: 'unrefined' as const, label: 'Using unrefined' }] : [])
		];
	if (rows.some((r) => r.reprocessed))
		return [
			{ variant: 'single', label: 'Sell unrefined' },
			{ variant: 'reprocessed', label: 'Reprocess' }
		];
	return [{ variant: 'single', label: 'Buy inputs' }];
}

/**
 * Rows of one reactor grouped into its tier sections. A section gets "Full chain" tabs when any of its
 * reactions is chainable (plus "Using unrefined" when any chain has an unrefined route) and
 * "Reprocess" tabs when any is reprocessable; empty tiers are dropped and reactions of unlisted tiers
 * end up in a trailing "Other" section.
 */
export function buildTierSections(
	reactor: Reactor,
	rows: ReactionRow[],
	dataset: Dataset
): TierSectionData[] {
	const defs = REACTOR_TIERS[reactor];
	const known = new Set(defs.map((d) => d.tier));
	const sections: TierSectionData[] = [];
	const add = (tier: Tier, title: string, tierRows: ReactionRow[]) => {
		if (tierRows.length === 0) return;
		const summaries = tierRows.map((r) => summarizeRow(r, dataset));
		sections.push({ tier, title, tabs: tabsFor(summaries), rows: summaries });
	};
	for (const def of defs)
		add(
			def.tier,
			def.title,
			rows.filter((r) => r.reaction.tier === def.tier)
		);
	add(
		'other',
		'Other',
		rows.filter((r) => !known.has(r.reaction.tier))
	);
	return sections;
}

export function summarizeSettings(profile: ResolvedProfile, hubs: HubInfo[]): SettingsSummaryData {
	const hubName = (id: string) => hubs.find((h) => h.hubId === id)?.name ?? id;
	return {
		structure: profile.structure,
		meRig: profile.meRig,
		teRig: profile.teRig,
		systemName: profile.systemName,
		securityBand: profile.securityBand,
		costIndex: profile.costIndex,
		costIndexOverridden: profile.costIndexOverridePct !== null,
		inputHub: hubName(profile.market.inputHub),
		outputHub: hubName(profile.market.outputHub),
		inputMethod: profile.market.inputMethod,
		outputMethod: profile.market.outputMethod
	};
}

/** Distinct reaction systems of the visitor's profiles with their cost index. */
export function profileSystems(profiles: Record<Reactor, ResolvedProfile>) {
	const seen = new Map<string, { systemName: string; costIndex: number; costIndexMissing: boolean }>();
	for (const reactor of REACTORS) {
		const p = profiles[reactor];
		const key = `${p.systemId}:${p.costIndex}`;
		if (!seen.has(key))
			seen.set(key, {
				systemName: p.systemName,
				costIndex: p.costIndex,
				costIndexMissing: p.costIndexMissing
			});
	}
	return [...seen.values()];
}

/** `just now`, `5 minutes ago`, `3 hours ago`, `2 days ago`. */
export function formatAge(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
	if (minutes < 1) return 'just now';
	if (minutes < 60) return plural(minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return plural(hours, 'hour');
	return plural(Math.floor(hours / 24), 'day');
}

export interface DateBounds {
	min: string;
	max: string;
}

/** Historical prices can be picked from `MAX_HISTORY_DAYS` ago up to yesterday (UTC). */
export function dateBounds(now: number): DateBounds {
	return { min: isoDate(now - MAX_HISTORY_DAYS * DAY_MS), max: isoDate(now - DAY_MS) };
}

export function isValidDateParam(value: string, bounds: DateBounds): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const ms = Date.parse(`${value}T00:00:00Z`);
	if (Number.isNaN(ms) || isoDate(ms) !== value) return false;
	return value >= bounds.min && value <= bounds.max;
}
