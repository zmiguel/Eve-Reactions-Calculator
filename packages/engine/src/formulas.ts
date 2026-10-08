import type {
	ContractBasis,
	MarketSettings,
	ReactorProfile,
	ResolvedProfile,
	ShippingSettings
} from './settings.ts';
import type { HubPrice, Reaction, ReactionConstants, SecurityBand } from './types.ts';

export type EfficiencyProfile = Pick<ReactorProfile, 'structure' | 'meRig' | 'teRig' | 'reactionsSkill'> & {
	securityBand: SecurityBand;
};

export interface JobCostBreakdown {
	eiv: number;
	systemCost: number;
	facilityTax: number;
	scc: number;
	total: number;
}

export const SECONDS_PER_DAY = 86400;

export function materialModifier(p: EfficiencyProfile, c: ReactionConstants): number {
	return 1 - c.rig[p.meRig].me * c.securityModifier[p.securityBand];
}

export function timeModifier(p: EfficiencyProfile, c: ReactionConstants): number {
	const secMod = c.securityModifier[p.securityBand];
	return (
		(1 - c.skillTimeBonusPerLevel * p.reactionsSkill) *
		c.structureTimeMultiplier[p.structure] *
		(1 - c.rig[p.teRig].te * secMod)
	);
}

export function runTimeSeconds(r: Reaction, p: EfficiencyProfile, c: ReactionConstants): number {
	return r.baseTimeSeconds * timeModifier(p, c);
}

/**
 * Runs that fit one cycle. `fits` is false when not even one run fits (result is clamped to 1);
 * `capped` is true when more runs would fit but the formula's per-job maximum (`maxRuns`) applies.
 */
export function runsPerCycleDetail(
	r: Reaction,
	p: EfficiencyProfile,
	cycleDays: number,
	c: ReactionConstants
): { runs: number; fits: boolean; capped: boolean } {
	const raw = Math.floor((cycleDays * SECONDS_PER_DAY) / runTimeSeconds(r, p, c));
	return { runs: Math.min(Math.max(raw, 1), r.maxRuns), fits: raw > 0, capped: raw > r.maxRuns };
}

export function runsPerCycle(
	r: Reaction,
	p: EfficiencyProfile,
	cycleDays: number,
	c: ReactionConstants
): number {
	return runsPerCycleDetail(r, p, cycleDays, c).runs;
}

/** Splits `runs` across `slots` jobs as evenly as possible (earlier jobs take the remainder). */
export function distributeRuns(runs: number, slots: number): number[] {
	const base = Math.floor(runs / slots);
	const extra = runs % slots;
	return Array.from({ length: slots }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Parallel jobs for `runs` when one slot fits `capacity` runs per cycle: `⌈runs ÷ capacity⌉` even jobs. */
export function splitIntoSlots(runs: number, capacity: number): number[] {
	return distributeRuns(runs, Math.ceil(runs / capacity));
}

/** Rounds to two decimals before ceiling, matching the game's float handling. */
export function requiredQuantity(runs: number, baseQty: number, mm: number): number {
	return Math.max(runs, Math.ceil(Math.round(runs * baseQty * mm * 100) / 100));
}

/** Estimated item value; `missing` lists materials without an adjusted price (valued at 0). */
export function eiv(
	r: Pick<Reaction, 'materials'>,
	runs: number,
	adjusted: Record<number, number>
): { value: number; missing: number[] } {
	let value = 0;
	const missing: number[] = [];
	for (const m of r.materials) {
		const price = adjusted[m.typeId];
		if (price === undefined) missing.push(m.typeId);
		else value += m.quantity * price;
	}
	return { value: runs * value, missing };
}

export function jobCost(
	eivValue: number,
	p: Pick<ResolvedProfile, 'costIndex' | 'facilityTaxPct' | 'sccPct'>
) {
	const systemCost = eivValue * p.costIndex;
	const facilityTax = (eivValue * p.facilityTaxPct) / 100;
	const scc = (eivValue * p.sccPct) / 100;
	return {
		eiv: eivValue,
		systemCost,
		facilityTax,
		scc,
		total: systemCost + facilityTax + scc
	} satisfies JobCostBreakdown;
}

export function addJobCosts(a: JobCostBreakdown, b: JobCostBreakdown): JobCostBreakdown {
	return {
		eiv: a.eiv + b.eiv,
		systemCost: a.systemCost + b.systemCost,
		facilityTax: a.facilityTax + b.facilityTax,
		scc: a.scc + b.scc,
		total: a.total + b.total
	};
}

export const ZERO_JOB_COST: JobCostBreakdown = { eiv: 0, systemCost: 0, facilityTax: 0, scc: 0, total: 0 };

function basisPrice(hp: HubPrice, basis: ContractBasis): number | null {
	if (basis === 'buy') return hp.buy;
	if (basis === 'sell') return hp.sell;
	return hp.buy === null || hp.sell === null ? null : (hp.buy + hp.sell) / 2;
}

export interface UnitPrice {
	/** Price per unit after the price-percentage adjustment. */
	price: number;
	/** Fees per unit (broker fee / sales tax). */
	fee: number;
}

export function inputUnitPrice(hp: HubPrice | undefined, m: MarketSettings): UnitPrice | null {
	if (!hp) return null;
	let base: number | null;
	if (m.inputMethod === 'buy_order') base = hp.buy;
	else if (m.inputMethod === 'instant') base = hp.sell;
	else base = basisPrice(hp, m.inputContractBasis);
	if (base === null) return null;
	const price = (base * m.inputPricePct) / 100;
	const fee = m.inputMethod === 'buy_order' ? (price * m.brokerFeePct) / 100 : 0;
	return { price, fee };
}

export function outputUnitPrice(hp: HubPrice | undefined, m: MarketSettings): UnitPrice | null {
	if (!hp) return null;
	let base: number | null;
	let feePct = 0;
	if (m.outputMethod === 'sell_order') {
		base = hp.sell;
		feePct = m.brokerFeePct + m.salesTaxPct;
	} else if (m.outputMethod === 'instant') {
		base = hp.buy;
		feePct = m.salesTaxPct;
	} else base = basisPrice(hp, m.outputContractBasis);
	if (base === null) return null;
	const price = (base * m.outputPricePct) / 100;
	return { price, fee: (price * feePct) / 100 };
}

/** Volume charge + collateral, both reduced by the side's discount; 0 when shipping is off. */
export function shippingCost(
	qty: number,
	volumePerUnit: number,
	unitPrice: number,
	s: ShippingSettings
): number {
	if (!s.enabled) return 0;
	const price = qty * volumePerUnit * s.iskPerM3 + (qty * unitPrice * s.collateralPct) / 100;
	return (price * (100 - s.discountPct)) / 100;
}
