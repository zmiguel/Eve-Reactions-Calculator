import { setCookie } from '$lib/cookies';

export const load = async ({ cookies, platform }) => {
	const market_systems = await JSON.parse(
		await platform.env.KV_DATA.get('systems-for-price-tracking')
	).systems;

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
		market_systems: market_systems
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
