import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ platform }) {
	//let item_string = "16663,4312,16643,16647";
	//const prices = (await platform.env.DB.prepare((await platform.env.KV_DATA.get('query-prices-for-item-at-system')).replace('###', item_string)).bind('Jita').all()).results;

	const item = await platform.env.DB.prepare(await platform.env.KV_DATA.get('query-item-single'))
		.bind('16663')
		.first();
	const cost_index = await platform.env.DB.prepare(
		await platform.env.KV_DATA.get('query-cost-index-for-system')
	)
		.bind('Jita')
		.first('cost_index');
	const runs = 256;

	const SCI = Math.round(item.base_industry_price) * cost_index * runs;
	const FacilityTax = Math.round(item.base_industry_price) * (1 / 100) * runs;
	const SCC = Math.round(item.base_industry_price) * (1.5 / 100) * runs;
	const TIF = SCI + FacilityTax + SCC;

	const response = {
		item: item,
		cost_index: cost_index,
		SCI: SCI,
		FacilityTax: FacilityTax,
		SCC: SCC,
		TIF: TIF
	};

	return json(response);
}
