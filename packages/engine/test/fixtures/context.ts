import type { CalcContext } from '../../src/calculate.ts';
import { DEFAULT_SETTINGS, Settings, type ResolvedProfile } from '../../src/settings.ts';
import type { PriceBook, Reactor } from '../../src/types.ts';
import { dataset, priceBook } from './dataset.ts';

type ProfileOverrides = Partial<Omit<ResolvedProfile, 'market' | 'shipping'>> & {
	market?: Partial<ResolvedProfile['market']>;
	shipping?: {
		input?: Partial<ResolvedProfile['shipping']['input']>;
		output?: Partial<ResolvedProfile['shipping']['output']>;
	};
};

/** Spreadsheet-parity profile by default: Tatara, T2/T2 rigs, Reactions V, nullsec, 5 % cost index. */
export function resolved(overrides: ProfileOverrides = {}): ResolvedProfile {
	const base = DEFAULT_SETTINGS.shared;
	return {
		...base,
		securityBand: 'nullsec',
		costIndex: 0.05,
		systemName: 'Test',
		costIndexMissing: false,
		...overrides,
		market: { ...base.market, ...overrides.market },
		shipping: {
			input: { ...base.shipping.input, ...overrides.shipping?.input },
			output: { ...base.shipping.output, ...overrides.shipping?.output }
		}
	};
}

export function makeCtx(
	opts: {
		profile?: ProfileOverrides;
		profiles?: Partial<Record<Reactor, ResolvedProfile>>;
		settings?: unknown;
		inputPrices?: PriceBook;
		outputPrices?: PriceBook;
	} = {}
): CalcContext {
	const p = resolved(opts.profile);
	return {
		dataset,
		profiles: { biochemical: p, composite: p, hybrid: p, ...opts.profiles },
		settings: Settings.parse(opts.settings ?? {}),
		inputPrices: opts.inputPrices ?? priceBook(),
		outputPrices: opts.outputPrices ?? opts.inputPrices ?? priceBook()
	};
}

export const byId = (id: number) => {
	const r = dataset.reactions.find((x) => x.blueprintTypeId === id);
	if (!r) throw new Error(`no reaction ${id}`);
	return r;
};
