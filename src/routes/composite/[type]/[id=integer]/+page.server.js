import { prep, simple, chain, refined } from '$lib/server/calc'
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	if (params.id === undefined || params.type === undefined) {
		throw error(400, `params.slug is undefined`);
	}

	params.id = parseInt(params.id);

	let options = {
		input: cookies.get('input'),
		inMarket: cookies.get('inMarket'),
		output: cookies.get('output'),
		outMarket: cookies.get('outMarket'),
		brokers: cookies.get('brokers'),
		sales: cookies.get('sales'),
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


	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-comp'));
	let bps, db_prep, db_prep_refined, db_prep_unrefined, results;


	switch (params.type) {
		case 'simple':
			bps = await blueprints.filter((bp) => bp.type === 'simple');
			// check if type is in simple
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in simple`);
			}
			db_prep = await prep('simple', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, blueprints, parseInt(params.id), 0, true);
			break;


		case 'complex':
			bps = await blueprints.filter((bp) => bp.type === 'complex');
			// check if type is in complex
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in complex`);
			}
			db_prep = await prep('complex', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, blueprints, parseInt(params.id), 0, true);
			break;


		case 'chain':
			bps = await blueprints.filter((bp) => bp.type === 'complex');
			// check if type is in chain
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in chain`);
			}
			db_prep = await prep('chain', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await chain('complex', platform.env, options, db_prep, blueprints, parseInt(params.id), 0, true);
			break;


		case 'unrefined':
			bps = await blueprints.filter((bp) => bp.type === 'unrefined');
			// check if type is in unrefined
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in unrefined`);
			}
			db_prep = await prep('unrefined', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, blueprints, parseInt(params.id), 0, true);
			break;


		case 'refined':
			bps = await blueprints.filter((bp) => bp.type === 'unrefined');
			// check if type is in refined
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in refined`);
			}
			db_prep_unrefined = await prep('refined', options, blueprints, platform.env);
			db_prep_refined = await prep('refined', options, blueprints, platform.env);
			if (!db_prep_unrefined || !db_prep_refined) {
				throw error(500, `db_prep is undefined`);
			}
			results = await refined(
				platform.env,
				options,
				db_prep_unrefined,
				db_prep_refined,
				blueprints,
				parseInt(params.id),
				0,
				true
			);
			break;
		default:
			throw error(400, `type is not in simple, complex, chain, unrefined, or refined`);
	}

	return {
		input: cookies.get('input'),
		inMarket: cookies.get('inMarket'),
		output: cookies.get('output'),
		outMarket: cookies.get('outMarket'),
		brokers: cookies.get('brokers'),
		sales: cookies.get('sales'),
		skill: cookies.get('skill'),
		facility: cookies.get('facility'),
		rigs: cookies.get('rigs'),
		space: cookies.get('space'),
		system: cookies.get('system'),
		tax: cookies.get('indyTax'),
		scc: cookies.get('sccTax'),
		duration: cookies.get('duration'),
		cycles: cookies.get('cycles'),
		type: params.type,
		name: bps.find((bp) => bp._id === params.id).name,
		results: results
	};
};

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		for (const [key, value] of data.entries()) {
			setCookie(cookies, key, value.toString());
		}
	}
};
