import { prep, simple } from '$lib/server/calc';

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
		duration: cookies.get('duration')
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-bio'));

	const db_prep = await prep('bio', options, blueprints, platform.env);

	let results_simple = [];
	await Promise.all(
		blueprints.map(async (bp) => {
			results_simple.push(await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0));
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
		results: {
			simple: results_simple
		}
	};
};
