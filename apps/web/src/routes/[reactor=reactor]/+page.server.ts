import { listReactions, rankRows } from '@reactions/engine';
import { error } from '@sveltejs/kit';
import { formatIsk } from '$lib/format';
import { loadCalc } from '$lib/server/context';
import {
	MAX_HISTORY_DAYS,
	buildTierSections,
	dateBounds,
	formatAge,
	isValidDateParam,
	summarizeSettings
} from '$lib/server/listing';
import { REACTOR_LABEL } from '$lib/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, platform, locals }) => {
	const reactor = params.reactor;
	const bounds = dateBounds(Date.now());
	const date = url.searchParams.get('date') || null;
	if (date !== null && !isValidDateParam(date, bounds)) {
		error(
			400,
			`Invalid date "${date}": use YYYY-MM-DD between ${bounds.min} and ${bounds.max} (last ${MAX_HISTORY_DAYS} days).`
		);
	}
	const page = { reactor, date, bounds, noindex: date !== null };
	const calc = platform ? await loadCalc(platform.env, locals, { date }) : null;
	if (!calc) return { ...page, listing: null };

	const { ctx, dataset, market, hubs } = calc;
	const rows = listReactions(ctx, { reactor });
	const profile = ctx.profiles[reactor];
	const warnings = [...calc.warnings];
	if (profile.costIndexMissing) warnings.push('COST_INDEX_MISSING');
	const pricesAge = formatAge(Date.now() - market.snapshotAt);
	const best = rankRows(rows)[0];
	const bestProfit = best?.best.totals.profitPerSlotDay ?? null;
	const label = REACTOR_LABEL[reactor];
	const description =
		`${label} reaction profits for EVE Online: ${rows.length} reactions priced ` +
		(date ? `as of ${date}.` : 'live.') +
		(bestProfit !== null ? ` Best: ${best.reaction.name} at ${formatIsk(bestProfit)} ISK/slot/day.` : '') +
		(date ? '' : ` Prices updated ${pricesAge}.`);
	return {
		...page,
		listing: {
			description,
			sections: buildTierSections(reactor, rows, dataset),
			settings: summarizeSettings(profile, hubs),
			warnings,
			approximate: ctx.inputPrices.approximate,
			pricesAsOf: date ?? market.snapshotAt,
			pricesAge
		}
	};
};
