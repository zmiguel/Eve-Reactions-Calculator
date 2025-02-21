import { prep, simple } from '$lib/server/calc';
import { error } from '@sveltejs/kit';
import { setCookie } from '$lib/cookies.js';

export const load = async ({ cookies, platform, params }) => {
	const settingsMode = cookies.get('settingsMode') || 'single';
	const suffix = settingsMode === 'single' ? '' : '_hybrid';

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

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-hybrid'));
	// check if type is in hybrid
	if (!blueprints.some((bp) => bp._id === parseInt(params.id))) {
		error(400, `id is not in hybrid`);
	}
	const db_prep = await prep('hybrid', options, blueprints, platform.env);
	if (!db_prep) {
		error(500, `db_prep is undefined`);
	}
	let results = await simple(
		platform.env,
		options,
		db_prep,
		blueprints,
		parseInt(params.id),
		0,
		true
	);

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
		results: results
	};
};

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		const settingsMode = cookies.get('settingsMode') || 'single';
		const suffix = settingsMode === 'single' ? '' : '_hybrid';

		for (const [key, value] of data.entries()) {
			setCookie(cookies, `${key}${suffix}`, value.toString());
		}
	}
};
