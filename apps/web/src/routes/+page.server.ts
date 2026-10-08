import { formatIsk } from '$lib/format';
import { loadCalc } from '$lib/server/context';
import {
	finalRows,
	HOME_MAX_SHARE_PCT,
	HOME_MIN_INPUT_MOVE_PCT,
	inputMoves,
	profileHubs,
	reactorBoards,
	recentListings
} from '$lib/server/home';
import { formatAge, profileSystems } from '$lib/server/listing';
import { getMarketStats } from '$lib/server/planner';
import { REACTOR_LABEL } from '$lib/site';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, locals }) => {
	const calc = platform ? await loadCalc(platform.env, locals) : null;
	if (!calc) return { home: null };
	const { ctx, dataset, market, hubs } = calc;
	const env = platform!.env;
	const [stats, recent] = await Promise.all([
		getMarketStats(
			env,
			profileHubs(ctx, hubs).map((h) => h.regionId)
		),
		recentListings(env, ctx, hubs, market.snapshotAt)
	]);
	const boards = reactorBoards(ctx, hubs, stats, finalRows(ctx), recent.days);
	const pricesAge = formatAge(Date.now() - market.snapshotAt);
	const best = boards
		.flatMap((b) =>
			[...b.single.items, ...(b.chain?.items ?? [])].map((item) => ({ item, reactor: b.reactor }))
		)
		.sort((a, b) => b.item.average - a.item.average)[0];
	const description =
		`Profit for all ${dataset.reactions.length} EVE Online reactions with your own settings.` +
		(best && recent.window
			? ` Best over the last ${recent.window.days} days: ${best.item.name} (${REACTOR_LABEL[best.reactor]}) at ${formatIsk(best.item.average)} ISK/slot/day.`
			: '') +
		` Prices updated ${pricesAge}.`;
	return {
		home: {
			description,
			status: {
				pricesUpdatedAt: market.snapshotAt,
				pricesAge,
				systems: profileSystems(ctx.profiles),
				sdeBuild: dataset.sdeBuild,
				reactionCount: dataset.reactions.length
			},
			window: recent.window,
			maxSharePct: HOME_MAX_SHARE_PCT,
			boards,
			inputs: {
				...inputMoves(ctx, hubs, stats),
				minPct: HOME_MIN_INPUT_MOVE_PCT,
				available: Object.keys(stats).length > 0
			}
		}
	};
};
