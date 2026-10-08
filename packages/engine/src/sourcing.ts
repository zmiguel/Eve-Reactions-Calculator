import type { CalcContext, LineItem, PricingContext } from './calculate.ts';
import { inputUnitPrice, shippingCost, type UnitPrice } from './formulas.ts';
import type { ResolvedProfile } from './settings.ts';

/** Part of a bought type's quantity and its price at one market. */
export interface InputSource {
	hubId: string;
	quantity: number;
	/** Unit price at this market after the price percentage; `null` when the market has no price. */
	unitPrice: number | null;
	total: number;
	fees: number;
}

/** A quantity one job (or one plan) buys, before pricing. */
export interface Purchase {
	profile: ResolvedProfile;
	typeId: number;
	quantity: number;
}

/** Listed volume of one input hub and type, shared by every purchase of a calculation. */
interface Allocation {
	/** Units listed for sale at the input hub. */
	available: number;
	/** Units all eligible purchases need. */
	need: number;
	/** Units taken at the input hub: `min(need, available)`. */
	local: number;
}

interface SourcePart {
	hubId: string;
	/** Σ purchase quantities this part applies to; the part's units are `weight × num ÷ den`. */
	weight: number;
	num: number;
	den: number;
	unit: UnitPrice | null;
}

/**
 * Units of `typeId` the profile can take at its input hub before the rest comes from its fallback hub,
 * or `null` when everything is bought at the input hub: contracts, a fallback equal to the input hub, or
 * an unknown listed volume (historical price books).
 *
 * The listed sell volume is what `instant` purchases take. For `buy_order` it is the best available proxy
 * for what local sellers offer: a buy order larger than the local supply waits for sellers that may never
 * come.
 */
function splitVolume(ctx: CalcContext, profile: ResolvedProfile, typeId: number): number | null {
	const m = profile.market;
	if (m.inputMethod === 'contract' || m.inputFallbackHub === m.inputHub) return null;
	return ctx.inputPrices.hubs[m.inputHub]?.[typeId]?.sellVolume ?? null;
}

/**
 * Market depth for inputs: per input hub and type, the units the input hub lists are shared by every
 * purchase of one calculation (all jobs of a chain, all reactions of a plan). When the total need exceeds
 * them, the rest is bought at the profile's fallback hub with the same method, fee and shipping rules.
 * Every purchase of a split type is priced at the same blended unit price, so per-job lines add up to the
 * aggregated totals.
 */
export class InputSourcing {
	/** Key `inputHub \0 typeId`. */
	private readonly allocations = new Map<string, Allocation>();
	/** Type id → `hubId \0 num \0 den` → part. */
	private readonly parts = new Map<number, Map<string, SourcePart>>();
	/** Type id → listed volume at the first market purchase's input hub (`null` = unknown). */
	private readonly available = new Map<number, number | null>();
	private readonly splitTypes = new Set<number>();
	private readonly ctx: CalcContext;

	constructor(ctx: CalcContext, purchases: Iterable<Purchase>) {
		this.ctx = ctx;
		for (const p of purchases) {
			const available = splitVolume(ctx, p.profile, p.typeId);
			if (available === null) continue;
			const key = `${p.profile.market.inputHub}\u0000${p.typeId}`;
			const a = this.allocations.get(key) ?? { available, need: 0, local: 0 };
			a.need += p.quantity;
			this.allocations.set(key, a);
		}
		for (const a of this.allocations.values()) a.local = Math.min(a.need, a.available);
	}

	/** True when any priced type is bought partly at a fallback hub. */
	get short(): boolean {
		return this.splitTypes.size > 0;
	}

	private addPart(typeId: number, part: SourcePart) {
		let byType = this.parts.get(typeId);
		if (!byType) this.parts.set(typeId, (byType = new Map()));
		const key = `${part.hubId}\u0000${part.num}\u0000${part.den}`;
		const existing = byType.get(key);
		if (existing) existing.weight += part.weight;
		else byType.set(key, part);
	}

	/**
	 * Prices one purchase passed to the constructor. Unsplit purchases are priced at the input hub exactly
	 * as without market depth; split ones take `local ÷ need` of the quantity at the input hub and the rest
	 * at the fallback hub. A market without a price records the type in `pc.missing`; the line is then
	 * unpriced (contributes 0), like any input without a price.
	 */
	buy(pc: PricingContext, profile: ResolvedProfile, typeId: number, quantity: number): LineItem {
		const type = this.ctx.dataset.types[typeId];
		const name = type?.name ?? String(typeId);
		const unitVolume = type?.volume ?? 0;
		const volume = quantity * unitVolume;
		const m = profile.market;
		const hubs = this.ctx.inputPrices.hubs;
		if (m.inputMethod !== 'contract' && !this.available.has(typeId))
			this.available.set(typeId, hubs[m.inputHub]?.[typeId]?.sellVolume ?? null);
		const a =
			splitVolume(this.ctx, profile, typeId) === null
				? undefined
				: this.allocations.get(`${m.inputHub}\u0000${typeId}`);

		if (!a || a.local >= a.need) {
			const unit = inputUnitPrice(hubs[m.inputHub]?.[typeId], m);
			this.addPart(typeId, { hubId: m.inputHub, weight: quantity, num: 1, den: 1, unit });
			if (!unit) {
				pc.missing.add(typeId);
				return { typeId, name, quantity, unitPrice: null, total: 0, fees: 0, shipping: 0, volume };
			}
			return {
				typeId,
				name,
				quantity,
				unitPrice: unit.price,
				total: quantity * unit.price,
				fees: quantity * unit.fee,
				shipping: shippingCost(quantity, unitVolume, unit.price, profile.shipping.input),
				volume
			};
		}

		this.splitTypes.add(typeId);
		let total = 0;
		let fees = 0;
		let shipping = 0;
		let missing = false;
		const sides = [
			{ hubId: m.inputHub, num: a.local },
			{ hubId: m.inputFallbackHub, num: a.need - a.local }
		];
		for (const { hubId, num } of sides) {
			if (num === 0) continue;
			const unit = inputUnitPrice(hubs[hubId]?.[typeId], m);
			this.addPart(typeId, { hubId, weight: quantity, num, den: a.need, unit });
			if (!unit) {
				missing = true;
				pc.missing.add(typeId);
				continue;
			}
			const qty = (quantity * num) / a.need;
			total += qty * unit.price;
			fees += qty * unit.fee;
			shipping += shippingCost(qty, unitVolume, unit.price, profile.shipping.input);
		}
		if (missing) return { typeId, name, quantity, unitPrice: null, total: 0, fees: 0, shipping: 0, volume };
		return { typeId, name, quantity, unitPrice: total / quantity, total, fees, shipping, volume };
	}

	/**
	 * Adds `availableAtInputHub` (market purchases) and, for split types, `sources` per market to the
	 * aggregated purchase list built from the {@link buy} lines.
	 */
	annotate(items: LineItem[]): LineItem[] {
		return items.map((item) => {
			const available = this.available.get(item.typeId);
			const out: LineItem = available === undefined ? item : { ...item, availableAtInputHub: available };
			if (!this.splitTypes.has(item.typeId)) return out;
			const byHub = new Map<string, InputSource>();
			for (const part of this.parts.get(item.typeId)!.values()) {
				// Exact for whole units: weight = need when one profile buys the type.
				const quantity = (part.weight * part.num) / part.den;
				const total = part.unit ? quantity * part.unit.price : 0;
				const fees = part.unit ? quantity * part.unit.fee : 0;
				const source = byHub.get(part.hubId);
				if (!source) {
					byHub.set(part.hubId, {
						hubId: part.hubId,
						quantity,
						unitPrice: part.unit?.price ?? null,
						total,
						fees
					});
					continue;
				}
				source.quantity += quantity;
				source.total += total;
				source.fees += fees;
				source.unitPrice = part.unit && source.unitPrice !== null ? source.total / source.quantity : null;
			}
			return { ...out, sources: [...byHub.values()] };
		});
	}
}
