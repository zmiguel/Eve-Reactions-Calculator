import { chain, prep, refined, simple } from '$lib/server/composite.js';
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

	const blueprints = await platform.env.KV_DATA.get('bp-comp');
	let bps, db_prep, db_prep_refined, db_prep_unrefined, results;
	switch (params.type) {
		case 'simple':
			bps = await JSON.parse(blueprints).filter((bp) => bp.type === 'simple');
			// check if type is in simple
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in simple`);
			}
			db_prep = await prep('simple', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, parseInt(params.id), 0);
			break;
		case 'complex':
			bps = await JSON.parse(blueprints).filter((bp) => bp.type === 'complex');
			// check if type is in complex
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in complex`);
			}
			db_prep = await prep('complex', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, parseInt(params.id), 0);
			break;
		case 'chain':
			bps = await JSON.parse(blueprints).filter((bp) => bp.type === 'complex');
			// check if type is in chain
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in chain`);
			}
			db_prep = await prep('chain', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await chain(platform.env, options, db_prep, parseInt(params.id), 0);
			break;
		case 'unrefined':
			bps = await JSON.parse(blueprints).filter((bp) => bp.type === 'unrefined');
			// check if type is in unrefined
			if (!bps.some((bp) => bp._id === params.id)) {
				throw error(400, `id is not in unrefined`);
			}
			db_prep = await prep('unrefined', options, blueprints, platform.env);
			if (!db_prep) {
				throw error(500, `db_prep is undefined`);
			}
			results = await simple(platform.env, options, db_prep, parseInt(params.id), 0);
			break;
		case 'refined':
			bps = await JSON.parse(blueprints).filter((bp) => bp.type === 'unrefined');
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
				parseInt(params.id),
				0
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
