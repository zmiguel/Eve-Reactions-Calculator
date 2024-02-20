import { json } from '@sveltejs/kit';
import { prep, simple } from '$lib/server/calc';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, platform }) {
	let start,
		end,
		perf = [];
	const quantity = url.searchParams.get('quantity') ? url.searchParams.get('quantity') : 0;
	//const material = url.searchParams.get('material') ? url.searchParams.get('material') : 16659;

	let options = {
		input: 'buy',
		output: 'sell',
		skill: '5',
		facility: 'large',
		rigs: '2',
		space: 'nullsec',
		system: 'N-8YET',
		tax: '1',
		scc: '1.5',
		duration: '43200'
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-hybrid'));

	start = performance.now();
	const db_prep = await prep('hybrid', options, blueprints, platform.env);
	end = performance.now();
	perf.push({ name: 'db_prep', time: end - start });

	let results = [];
	start = performance.now();
	await Promise.all(
		blueprints.map(async (bp) => {
			results.push(
				await simple(
					platform.env,
					options,
					db_prep,
					blueprints,
					parseInt(bp._id),
					parseInt(quantity)
				)
			);
		})
	);
	end = performance.now();
	perf.push({ name: 'hybrid', time: end - start });

	return json({ results: results, perf: perf });
}
