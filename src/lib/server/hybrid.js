export async function prep(options, blueprints, env) {
	let materials = [];
	blueprints.forEach((bp) => {
		// check if item is already in list
		if (!materials.includes(bp._id)) {
			materials.push(bp._id);
		}
		bp.inputs.forEach((input) => {
			if (!materials.includes(input.id)) {
				materials.push(input.id);
			}
		});
	});
	// make string of items for query
	let item_string = '';
	materials.forEach((item) => {
		item_string += item + ',';
	});
	item_string = item_string.slice(0, -1);
	let system_string = '"' + options.inMarket + '","' + options.outMarket + '"';
	let db_calls = [
		{
			name: 'prices',
			call: env.DB.prepare(
				(await env.KV_DATA.get('query-prices-for-item-at-system'))
					.replace('###', item_string)
					.replace('$$$', system_string)
			)
		},
		{
			name: 'items',
			call: env.DB.prepare(
				(await env.KV_DATA.get('query-select-items-by-id')).replace('###', item_string)
			)
		},
		{
			name: 'cost_index',
			call: env.DB.prepare(await env.KV_DATA.get('query-cost-index-for-system')).bind(
				options.system
			)
		}
	];
	let prices, items, cost_index;
	// execute calls
	await Promise.all(
		db_calls.map(async (call) => {
			switch (call.name) {
				case 'prices':
					prices = (await call.call.all()).results;
					break;
				case 'items':
					items = (await call.call.all()).results;
					break;
				case 'cost_index':
					cost_index = await call.call.first('cost_index');
					break;
			}
		})
	);
	return {
		prices: prices,
		items: items,
		cost_index: cost_index
	};
}

export async function hybrid(env, options, db, material, amount, advanced = false) {
	// Calculate material bonus
	let material_bonus = 1;
	switch (options.rigs) {
		case '0':
			if (options.space === 'nullsec') {
				material_bonus = 1 - 1.1 / 100;
			} else {
				material_bonus = 1;
			}
			break;
		case '1':
			if (options.space === 'nullsec') {
				material_bonus = 1 - (2 * 1.1) / 100;
			} else {
				material_bonus = 1 - 2 / 100;
			}
			break;
		case '2':
			if (options.space === 'nullsec') {
				material_bonus = 1 - (2.4 * 1.1) / 100;
			} else {
				material_bonus = 1 - 2.4 / 100;
			}
			break;
		default:
			break;
	}

	// Calculate time bonus
	// skill bonus
	let time_per_run = 180 * (1 - (4 * parseInt(options.skill)) / 100);
	// Facility bonus
	if (options.facility === 'medium') {
		time_per_run = time_per_run * 1;
	} else if (options.facility === 'large') {
		time_per_run = time_per_run * (1 - 25 / 100);
	}
	// Rig bonus
	switch (options.rigs) {
		case '0':
			if (options.space === 'nullsec') {
				time_per_run = time_per_run * (1 - 1.1 / 100);
			}
			break;
		case '1':
			if (options.space === 'nullsec') {
				time_per_run = time_per_run * (1 - (20 * 1.1) / 100);
			} else {
				time_per_run = time_per_run * (1 - 20 / 100);
			}
			break;
		case '2':
			if (options.space === 'nullsec') {
				time_per_run = time_per_run * (1 - (24 * 1.1) / 100);
			} else {
				time_per_run = time_per_run * (1 - 24 / 100);
			}
			break;
		default:
			time_per_run = 180;
			break;
	}

	// Calculate how many cycles per job
	const cycles = Math.floor(parseInt(options.duration) / time_per_run);

	// Get blueprint data for this material
	const blueprints = await env.KV_DATA.get('bp-hybrid');
	const blueprint = JSON.parse(blueprints).find((bp) => {
		return bp._id === material;
	});

	// Sanity Check
	if (blueprint === undefined) {
		console.log('Blueprint not found | material: ' + material);
		return;
	}

	// calculate the cycle data
	let cycle_data = {
		cycle_time: Math.round(parseInt(options.cycles) * time_per_run),
		num_cycles: 1,
		total_time: parseInt(options.duration)
	};
	if (advanced) {
		cycle_data = {
			cycle_time: Math.round(parseInt(options.cycles) * time_per_run),
			num_cycles: Math.floor(parseInt(options.duration) / (parseInt(options.cycles) * time_per_run)),
			total_time: Math.round(parseInt(options.cycles) * time_per_run) * Math.floor(parseInt(options.duration) / (parseInt(options.cycles) * time_per_run))
		};
		amount = parseInt(options.cycles) * parseInt(blueprint.output.qt);
	}

	// Should be fine
	// Calculate total of items to build based on the requested amount
	const difference = amount % parseInt(blueprint.output.qt);
	let items_to_make;
	let remaining_items = 0;
	if (difference === 0) {
		items_to_make = amount;
	} else {
		items_to_make = amount + (parseInt(blueprint.output.qt) - difference);
		remaining_items = parseInt(blueprint.output.qt) - difference;
	}
	// check if we should just calculate for the items request or max for the time
	let runs = 0;
	if (amount !== 0) {
		runs = items_to_make / parseInt(blueprint.output.qt);
	} else {
		runs = cycles;
	}

	// Calculate the Total Installation Fee
	// TIF = EIV * ((SCI * bonuses) + FacilityTax + SCC + AlphaClone)
	// Source: https://www.eveonline.com/news/view/viridian-expansion-notes
	const output_item = db.items.find((item) => {
		return item.id === blueprint.output.id;
	});
	const SCI = Math.round(output_item.base_industry_price) * db.cost_index * runs;
	const FacilityTax =
		Math.round(output_item.base_industry_price) * (parseFloat(options.tax) / 100) * runs;
	const SCC = Math.round(output_item.base_industry_price) * (parseFloat(options.scc) / 100) * runs;
	const TIF = SCI + FacilityTax + SCC;

	// Actually calculate the costs
	// inputs
	let inputs = [];
	blueprint.inputs.forEach((item) => {
		// calculate amount with material bonus
		const amount = Math.ceil(item.qt * runs * material_bonus);
		// find price for this item * amount
		const price =
			db.prices.find((price) => {
				return price.item_id === item.id && price.system === options.inMarket;
			})[options.input] * amount;
		// add to inputs
		inputs.push({
			id: item.id,
			name: db.items.find((i) => {
				return i.id === item.id;
			}).name,
			quantity: amount,
			price: price
		});
	});
	// output
	const output = {
		id: blueprint.output.id,
		name: db.items.find((items) => {
			return items.id === blueprint.output.id;
		}).name,
		quantity: blueprint.output.qt * runs,
		price:
			db.prices.find((price) => {
				return price.item_id === blueprint.output.id && price.system === options.outMarket;
			})[options.output] *
			blueprint.output.qt *
			runs
	};

	// Calculate the total cost
	let total = 0;
	inputs.forEach((input) => {
		total += input.price;
	});

	// Calculate the profit
	const profit = output.price - total - TIF;

	// Calculate remaining
	let remaining_outputs = {};
	if (remaining_items !== 0) {
		remaining_outputs = {
			id: blueprint.output.id,
			name: output.name,
			quantity: remaining_items,
			price:
				db.prices.find((price) => {
					return price.item_id === blueprint.output.id && price.system === options.outMarket;
				})[options.output] * remaining_items
		};
	}

	// Multipliers
	// number of runs
	if (advanced) {
		// multiply all inputs and output by cycle_data.num_cycles
		inputs.forEach((input) => {
			input.quantity *= cycle_data.num_cycles;
			input.price *= cycle_data.num_cycles;
		});
		output.quantity *= cycle_data.num_cycles;
		output.price *= cycle_data.num_cycles;
	}

	// Style
	let style;
	if (profit > 0) {
		style = 'table-success';
	} else if (profit < 0) {
		style = 'table-danger';
	} else {
		style = 'table-warning';
	}

	// return all data
	return {
		name: output.name,
		input: inputs,
		input_total: total * cycle_data.num_cycles,
		taxes: {
			system: SCI * cycle_data.num_cycles,
			facility: FacilityTax * cycle_data.num_cycles,
			scc: SCC * cycle_data.num_cycles,
			total: TIF * cycle_data.num_cycles
		},
		taxes_total: TIF * cycle_data.num_cycles,
		output: output,
		output_total: output.price,
		profit: profit * cycle_data.num_cycles,
		profit_per: (profit / output.price) * 100,
		runs: runs * cycle_data.num_cycles,
		remaining: remaining_outputs,
		cycle_data: cycle_data,
		style: style
	};
}
