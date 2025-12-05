import { prep, simple, chain, refined, eraticRepro } from '$lib/server/calc';
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	if (params.id === undefined || params.type === undefined) {
		error(400, `params.slug is undefined`);
	}

	const settingsMode = cookies.get('settingsMode') || 'single';
	const suffix = settingsMode === 'single' ? '' : '_composite';

	// check for cycles cookie depending on settingsMode with suffix and set it if it doesn't exist
	if (!cookies.get(`cycles${suffix}`)) {
		setCookie(cookies, `cycles${suffix}`, cookies.get('cycles') || '50');
	}

	let options = {
		input: cookies.get(`input${suffix}`),
		inMarket: cookies.get(`inMarket${suffix}`),
		output: cookies.get(`output${suffix}`),
		outMarket: cookies.get(`outMarket${suffix}`),
		brokers: cookies.get(`brokers${suffix}`),
		sales: cookies.get(`sales${suffix}`),
		skill: cookies.get(`skill${suffix}`),
		facility: cookies.get(`facility${suffix}`),
		rigs: cookies.get(`rigs${suffix}`),
		space: cookies.get(`space${suffix}`),
		system: cookies.get(`system${suffix}`),
		tax: cookies.get(`indyTax${suffix}`),
		scc: cookies.get(`sccTax${suffix}`),
		duration: cookies.get(`duration${suffix}`),
		cycles: cookies.get(`cycles${suffix}`),
		costIndex: cookies.get(`costIndex${suffix}`)
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-comp'));
	let bps, db_prep, db_prep_refined, db_prep_unrefined, results;

	switch (params.type) {
		case 'simple':
			bps = await blueprints.filter((bp) => bp.type === 'simple');
			// check if type is in simple
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in simple`);
			}
			db_prep = await prep('simple', options, blueprints, platform.env);
			if (!db_prep) {
				error(500, `db_prep is undefined`);
			}
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

		case 'complex':
			bps = await blueprints.filter((bp) => bp.type === 'complex');
			// check if type is in complex
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in complex`);
			}
			db_prep = await prep('complex', options, blueprints, platform.env);
			if (!db_prep) {
				error(500, `db_prep is undefined`);
			}
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
			bps = await blueprints.filter((bp) => bp.type === 'complex');
			// check if type is in chain
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in chain`);
			}
			db_prep = await prep('chain', options, blueprints, platform.env);
			if (!db_prep) {
				error(500, `db_prep is undefined`);
			}
			results = await chain(
				'complex',
				platform.env,
				options,
				db_prep,
				blueprints,
				parseInt(params.id),
				0,
				true
			);
			break;

		case 'unrefined':
			bps = await blueprints.filter((bp) => bp.type === 'unrefined');
			// check if type is in unrefined
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in unrefined`);
			}
			db_prep = await prep('unrefined', options, blueprints, platform.env);
			if (!db_prep) {
				error(500, `db_prep is undefined`);
			}
			results = await simple(
				platform.env,
				options,
				db_prep,
				blueprints,
				parseInt(params.id),
				0,
				true,
				360
			);
			break;

		case 'refined':
			bps = await blueprints.filter((bp) => bp.type === 'unrefined');
			// check if type is in refined
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in refined`);
			}
			db_prep_unrefined = await prep('refined', options, blueprints, platform.env);
			db_prep_refined = await prep('refined', options, blueprints, platform.env);
			if (!db_prep_unrefined || !db_prep_refined) {
				error(500, `db_prep is undefined`);
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

		case 'eratic':
			bps = await blueprints.filter((bp) => bp.type === 'eratic');
			// check if type is in eratic
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in eratic`);
			}
			db_prep = await prep('eratic', options, blueprints, platform.env);
			if (!db_prep) {
				error(500, `db_prep is undefined`);
			}
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

		case 'eratic-repro':
			bps = await blueprints.filter((bp) => bp.type === 'eratic-repro');
			// check if type is in eratic-repro
			if (!bps.some((bp) => bp._id === parseInt(params.id))) {
				error(400, `id is not in eratic-repro`);
			}
			db_prep_unrefined = await prep('eratic', options, blueprints, platform.env);
			db_prep_refined = await prep('eratic-repro', options, blueprints, platform.env);
			if (!db_prep_unrefined || !db_prep_refined) {
				error(500, `db_prep is undefined`);
			}
			results = await eraticRepro(
				platform.env,
				options,
				db_prep_unrefined,
				db_prep_refined,
				blueprints,
				parseInt(params.id),
				0,
				true,
				360,
				0.9063
			);
			break;

		default:
			error(
				400,
				`type is not in simple, complex, chain, unrefined, refined, eratic, or eratic-repro`
			);
	}

	return {
		input: cookies.get(`input${suffix}`),
		inMarket: cookies.get(`inMarket${suffix}`),
		output: cookies.get(`output${suffix}`),
		outMarket: cookies.get(`outMarket${suffix}`),
		brokers: cookies.get(`brokers${suffix}`),
		sales: cookies.get(`sales${suffix}`),
		skill: cookies.get(`skill${suffix}`),
		facility: cookies.get(`facility${suffix}`),
		rigs: cookies.get(`rigs${suffix}`),
		space: cookies.get(`space${suffix}`),
		system: cookies.get(`system${suffix}`),
		tax: cookies.get(`indyTax${suffix}`),
		scc: cookies.get(`sccTax${suffix}`),
		duration: cookies.get(`duration${suffix}`),
		cycles: cookies.get(`cycles${suffix}`),
		type: params.type,
		name: bps.find((bp) => bp._id === parseInt(params.id)).name,
		results: results
	};
};

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		const settingsMode = cookies.get('settingsMode') || 'single';
		const suffix = settingsMode === 'single' ? '' : '_composite';

		for (const [key, value] of data.entries()) {
			setCookie(cookies, `${key}${suffix}`, value.toString());
		}
	}
};
