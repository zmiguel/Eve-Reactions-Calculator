import { hybrid, prep } from '$lib/server/hybrid';

export const load = async ({ cookies, platform }) => {
	let options = {
		input: cookies.get('input'),
		inMarket: cookies.get('inMarket'),
		output: cookies.get('output'),
		outMarket: cookies.get('outMarket'),
		skill: cookies.get('skill'),
		facility: cookies.get('facility'),
		rigs: cookies.get('rigs'),
		space: cookies.get('space'),
		system: cookies.get('system'),
		tax: cookies.get('indyTax'),
		scc: cookies.get('sccTax'),
		duration: cookies.get('duration'),
		cycles: cookies.get('cycles')
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-hybrid'));

	const db_prep = await prep(options, blueprints, platform.env);

	let results = [];
	await Promise.all(
		blueprints.map(async (bp) => {
			results.push(await hybrid(platform.env, options, db_prep, parseInt(bp._id), 0));
		})
	);

	return {
		input: cookies.get('input'),
		inMarket: cookies.get('inMarket'),
		output: cookies.get('output'),
		outMarket: cookies.get('outMarket'),
		skill: cookies.get('skill'),
		facility: cookies.get('facility'),
		rigs: cookies.get('rigs'),
		space: cookies.get('space'),
		system: cookies.get('system'),
		tax: cookies.get('indyTax'),
		scc: cookies.get('sccTax'),
		duration: cookies.get('duration'),
		cycles: cookies.get('cycles'),
		results: results
	};
};