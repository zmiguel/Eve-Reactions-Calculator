import { prep, simple } from '$lib/server/calc';
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	if (params.id === undefined) {
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

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-hybrid'));
	// check if type is in hybrid
	if (!blueprints.some((bp) => bp._id === params.id)) {
		throw error(400, `id is not in hybrid`);
	}
	const db_prep = await prep('hybrid', options, blueprints, platform.env);
	if (!db_prep) {
		throw error(500, `db_prep is undefined`);
	}
	let results = await simple(platform.env, options, db_prep, blueprints, parseInt(params.id), 0, true);

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
