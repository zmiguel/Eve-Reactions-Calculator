import { json } from '@sveltejs/kit';
import { prep, chain } from '$lib/server/composite';

/** @type {import('./$types').RequestHandler} */
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
		skill: '5',
		facility: 'large',
		rigs: '2',
		space: 'nullsec',
		system: 'N-8YET',
		tax: '1',
		scc: '1.5',
		duration: '43200',
		cycles: '52'
	};

	const blueprints = await platform.env.KV_DATA.get('bp-comp');
	const simple_blueprints = await JSON.parse(blueprints).filter((bp) => bp.type === 'complex');

	start = performance.now();
	const db_prep = await prep('chain', options, blueprints, platform.env);
	end = performance.now();
	perf.push({ name: 'db_prep', time: end - start });

	let results = [];
	start = performance.now();
	await Promise.all(
		simple_blueprints.map(async (bp) => {
			results.push(
				await chain(platform.env, options, db_prep, parseInt(bp._id), parseInt(quantity))
			);
		})
	);
	end = performance.now();
	perf.push({ name: 'simple', time: end - start });

	return json({ results: results, perf: perf });
}
