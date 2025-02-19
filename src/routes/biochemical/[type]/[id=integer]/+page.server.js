import { prep, simple, fullChain } from '$lib/server/calc.js';
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	if (params.id === undefined || params.type === undefined) {
		error(400, `params.slug is undefined`);
	}

	const settingsMode = cookies.get('settingsMode') || 'single';
	const suffix = settingsMode === 'single' ? '' : '_biochemical';

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
		results: results ? results : {}
	};
};

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		const settingsMode = cookies.get('settingsMode') || 'single';
		const suffix = settingsMode === 'single' ? '' : '_biochemical';

		for (const [key, value] of data.entries()) {
			setCookie(cookies, `${key}${suffix}`, value.toString());
		}
	}
};
