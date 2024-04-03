import { prep, simple, fullChain } from '$lib/server/calc.js';
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	if (params.id === undefined || params.type === undefined) {
		error(400, `params.slug is undefined`);
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
		cycles: cookies.get('cycles'),
		costIndex: cookies.get('costIndex')
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-bio'));
	let results;
	if (!blueprints.some((bp) => bp._id === params.id)) {
		error(400, `id is not in biochemical`);
	}
	const db_prep = await prep('bio', options, blueprints, platform.env);
	if (!db_prep) {
		error(500, `db_prep is undefined`);
	}

	switch (params.type) {
		case 'simple':
			results = await simple(
				platform.env,
				options,
				db_prep,
				blueprints,
				parseInt(params.id),
				0,
				true
			);
			break;
		case 'chain':
			results = await fullChain(
				platform.env,
				options,
				db_prep,
				blueprints,
				parseInt(params.id),
				0,
				false
			);
			break;
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
		results: results ? results : {}
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
