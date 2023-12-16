export interface Env {
	// @ts-ignore
	DB: D1Database;
	// @ts-ignore
	ENDPOINTS: KVNamespace;
	// @ts-ignore
	DATA: KVNamespace;
}

async function update_adjusted_item_prices_cron(env: Env) {
	const items_query = await env.DB.prepare(await env.DATA.get('query-items'));
	const items = await items_query.all();

	// query ESI api to update adjusted price
	const esi_url =
		(await env.ENDPOINTS.get('ESI_BASE')) +
		(await env.ENDPOINTS.get('ESI_MARKET_PRICES')) +
		(await env.ENDPOINTS.get('ESI_DATA_SOURCE'));
	const esi_data = await fetch(esi_url);
	const esi_prices = await esi_data.json();
	// update adjusted price
	const update_query = await env.DATA.get('query-update-items-adjusted-price');
	// go through each item and update adjusted price
	const batch: any[] = [];
	const update_batch = env.DB.prepare(update_query);
	for (const item of items.results) {
		const adjusted_price = esi_prices.find((price) => price.type_id === item.id)?.adjusted_price;

		if (adjusted_price) {
			batch.push(update_batch.bind(adjusted_price, item.id));
		}
	}
	console.log(`items to update adjusted cost: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_base_industry_cost_cron(env: Env) {
	// update base industry cost based on the adjusted price of the material required to build the item from the blueprints
	// get updated items first
	const items_query = await env.DB.prepare(await env.DATA.get('query-items'));
	const items = await items_query.all();

	// get blueprints
	const bp_comp = JSON.parse(await env.DATA.get('bp-comp'));
	const bp_bio = JSON.parse(await env.DATA.get('bp-bio'));
	const bp_hybrid = JSON.parse(await env.DATA.get('bp-hybrid'));
	const update_indy_cost = await env.DATA.get('query-update-indy-cost');

	// batch setup
	const batch: any[] = [];
	const update_batch = env.DB.prepare(update_indy_cost);

	// get adjusted price for each material
	// composite
	for (const bp of bp_comp) {
		let indyPrice = 0;
		if(bp.type === 'refined'){
			continue;
		}
		for (const input of bp.inputs) {
			const item = items.results.find((item) => item.id === input.id)?.adjusted_price;

			if (item) {
				indyPrice += item * input.qt;
			}
		}
		// update base industry cost
		batch.push(update_batch.bind(indyPrice, bp._id));
	}

	// bio
	for (const bp of bp_bio) {
		let indyPrice = 0;
		for (const input of bp.inputs) {
			const item = items.results.find((item) => item.id === input.id)?.adjusted_price;

			if (item) {
				indyPrice += item * input.qt;
			}
		}
		// update base industry cost
		batch.push(update_batch.bind(indyPrice, bp._id));
	}

	// hybrid
	for (const bp of bp_hybrid) {
		let indyPrice = 0;
		for (const input of bp.inputs) {
			const item = items.results.find((item) => item.id === input.id)?.adjusted_price;

			if (item) {
				indyPrice += item * input.qt;
			}
		}
		// update base industry cost
		batch.push(update_batch.bind(indyPrice, bp._id));
	}

	console.log(`items to update industry cost: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_cost_index_cron(env: Env) {
	const systems_query = await env.DB.prepare(await env.DATA.get('query-systems'));
	const systems = await systems_query.all();

	// query ESI api to update adjusted price
	const esi_url =
		(await env.ENDPOINTS.get('ESI_BASE')) +
		(await env.ENDPOINTS.get('ESI_COST_INDEX')) +
		(await env.ENDPOINTS.get('ESI_DATA_SOURCE'));
	const esi_data = await fetch(esi_url);
	const esi_cost_index = await esi_data.json();
	// update cost index
	const update_query = await env.DATA.get('query-update-cost-index');
	// go through each item and update adjusted price
	const batch: any[] = [];
	const update_batch = env.DB.prepare(update_query);
	for (const system of systems.results) {
		const cost_index = esi_cost_index.find((item) => item.solar_system_id === system.id)
			?.cost_indices[5].cost_index;

		if (cost_index) {
			batch.push(update_batch.bind(cost_index, system.id));
		}
	}
	console.log(`items to update cost index: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

async function update_item_prices_cron(env: Env) {
	// get system list for price update
	const systems = JSON.parse(await env.DATA.get('systems-for-price-tracking')).systems;

	// config batch for update/creation
	const batch: any[] = [];

	const update_query = await env.DATA.get('query-update-price');
	const update_batch = env.DB.prepare(update_query);

	const create_query = await env.DATA.get('query-create-price');
	const create_batch = env.DB.prepare(create_query);

	const market_url = await env.ENDPOINTS.get('FUZZWORKS_MARKET_API');

	// go through each system and update/create price
	for (const system of systems) {
		const current_prices_db = await env.DB.prepare(await env.DATA.get('query-prices-for-system'))
			.bind(system)
			.all();

		// get items from the database and make a string of their ids separated by commas
		const items = await env.DB.prepare(await env.DATA.get('query-items')).all();
		const item_ids = items.results.map((item) => item.id).join(',');

		// get system id from database
		const system_id = await env.DB.prepare(await env.DATA.get('query-system-id'))
			.bind(system)
			.first('id');

		// get prices from fuzzworks
		const market_data = await fetch(market_url + '?types=' + item_ids + '&region=' + system_id);
		const market_prices = await market_data.json();

		if (current_prices_db.results.length > 0) {
			// go through each item and update or create the price if it doesn't exist in the database
			for (const item of items.results) {
				const price_sell = market_prices[item.id].sell?.min;
				const price_buy = market_prices[item.id].buy?.max;

				const current_price = current_prices_db.results.find((price) => price.item_id === item.id);

				if (current_price) {
					batch.push(
						update_batch.bind(
							price_sell ? price_sell : 0,
							price_buy ? price_buy : 0,
							item.id,
							system
						)
					);
				} else {
					batch.push(
						create_batch.bind(
							item.id,
							system,
							price_sell ? price_sell : 0,
							price_buy ? price_buy : 0
						)
					);
				}
			}
		} else {
			// go through each item and update or create the price if it doesn't exist in the database
			for (const item of items.results) {
				const price_sell = market_prices[item.id].sell?.min;
				const price_buy = market_prices[item.id].buy?.max;

				batch.push(
					create_batch.bind(item.id, system, price_sell ? price_sell : 0, price_buy ? price_buy : 0)
				);
			}
		}
	}

	console.log(`items to update prices: ${batch.length}`);
	const info = await env.DB.batch(batch);
	console.log(`items updated: ${info.length}`);
}

export default {
	async scheduled(event, env, ctx) {
		console.info('Running Update Adjusted Item Prices Cron');
		await update_adjusted_item_prices_cron(env);
		console.info('Running Update Base Industry Cost Cron');
		await update_base_industry_cost_cron(env);
		console.info('Running update cost index cron');
		await update_cost_index_cron(env);
		console.info('Running update item prices cron');
		await update_item_prices_cron(env);
		console.info('Done...');
	}
};
