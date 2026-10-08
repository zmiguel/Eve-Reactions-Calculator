import type { MarketSnapshot } from '@reactions/db';
import type { CalcContext, Dataset, PriceBook } from '@reactions/engine';
import { getDataset, getMarket } from './data.ts';
import { getAccessibleHubs, getHubPrices, type HubInfo } from './hubs.ts';
import { buildPriceBook, getDailyPriceBook } from './prices.ts';
import { resolveProfiles } from './profiles.ts';

export interface RequestCalc {
	ctx: CalcContext;
	dataset: Dataset;
	market: MarketSnapshot;
	hubs: HubInfo[];
	/** Profile-level warnings such as `HUB_UNAVAILABLE`. */
	warnings: string[];
}

type Locals = Pick<App.Locals, 'settings' | 'user'>;

/** Current price book for the visitor: KV snapshot + their private hubs from D1. */
export async function currentPriceBook(
	env: Env,
	market: MarketSnapshot,
	hubs: HubInfo[]
): Promise<PriceBook> {
	const privateIds = hubs.filter((h) => h.private).map((h) => h.hubId);
	return buildPriceBook(market, await getHubPrices(env, privateIds));
}

/**
 * Everything a page needs to run the engine for this visitor, or `null` when the reference data has
 * not been published yet. `date` (YYYY-MM-DD) switches both price books to that day's history; `hubs`
 * skips the accessible-hub lookup when the caller already has them.
 */
export async function loadCalc(
	env: Env,
	locals: Locals,
	opts: { date?: string | null; hubs?: HubInfo[] } = {}
): Promise<RequestCalc | null> {
	const [dataset, market, hubs] = await Promise.all([
		getDataset(env),
		getMarket(env),
		opts.hubs ?? getAccessibleHubs(env, locals.user)
	]);
	if (!dataset || !market) return null;
	const { profiles, warnings } = await resolveProfiles(
		env,
		locals.settings,
		new Set(hubs.map((h) => h.hubId))
	);
	const book = opts.date
		? await getDailyPriceBook(env, opts.date, hubs, dataset, market.adjusted)
		: await currentPriceBook(env, market, hubs);
	return {
		ctx: { dataset, profiles, settings: locals.settings, inputPrices: book, outputPrices: book },
		dataset,
		market,
		hubs,
		warnings
	};
}
