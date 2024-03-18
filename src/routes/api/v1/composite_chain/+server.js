import { json } from '@sveltejs/kit';
import { prep, fullChain } from '$lib/server/calc.js';

/** @type {import('../../../../../.svelte-kit/types/src/routes').RequestHandler} */
export async function GET({ url, platform }) {
	let start,
		end,
		perf = [];
	const quantity = url.searchParams.get('quantity') ? url.searchParams.get('quantity') : 0;
	//const material = url.searchParams.get('material') ? url.searchParams.get('material') : 16659;

	let options = {
		input: 'buy',
		inMarket: 'Jita',
		output: 'sell',
		outMarket: 'Jita',
		brokers: '1.5',
		sales: '3.6',
		skill: '5',
		facility: 'large',
		rigs: '2',
		space: 'nullsec',
		system: 'XU7-CH',
		tax: '1',
		scc: '4',
		duration: '43200',
		cycles: '54'
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-comp'));
	//const simple_blueprints = await blueprints.filter((bp) => bp.type === 'simple');
	const complex_blueprints = await blueprints.filter((bp) => bp.type === 'complex');

	start = performance.now();
	const db_prep = await prep('chain', options, blueprints, platform.env);
	end = performance.now();
	perf.push({ name: 'db_prep', time: end - start });

	let results = [];
	start = performance.now();
	await Promise.all(
		/* simple_blueprints.map(async (bp) => {
			results.push(
				await chain(
					'complex',
					platform.env,
					options,
					db_prep,
					blueprints,
					parseInt(bp._id),
					parseInt(quantity)
				)
			);
		}) */
		complex_blueprints.map(async (bp) => {
			results.push(
				await fullChain(
					platform.env,
					options,
					db_prep,
					blueprints,
					parseInt(bp._id),
					parseInt(quantity),
					false
				)
			);
		})
	);
	end = performance.now();
	perf.push({ name: 'simple', time: end - start });

	return json({ results: results, perf: perf });
}
