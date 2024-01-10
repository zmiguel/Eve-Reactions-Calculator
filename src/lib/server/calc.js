/**
 * @param {String} type
 * @param {Object[]} blueprints
 * @returns {Object[]}
 */
function get_item_string_for_type(type, blueprints){
	let materials = [], item_string = ''
	if (type === 'simple') {
		blueprints.filter((bp) => bp.type === 'simple').forEach((bp) => {
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
	} else if (type === 'complex') {
		blueprints.filter((bp) => bp.type === 'complex').forEach((bp) => {
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
	} else if (type === 'chain') {
		blueprints.filter((bp) => {
			return (bp.type === 'simple' || bp.type === 'complex');
		}).forEach((bp) => {
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
	} else if (type === 'unrefined') {
		blueprints.filter((bp) => {
			return (bp.type === 'unrefined');
		}).forEach((bp) => {
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
	} else if (type === 'refined') {
		blueprints.filter((bp) => {
			return (bp.type === 'unrefined' || bp.type === 'refined');
		}).forEach((bp) => {
			if (bp.type === 'unrefined'){
				// check if item is already in list
				if (!materials.includes(bp._id)) {
					materials.push(bp._id);
				}
				bp.inputs.forEach((input) => {
					if (!materials.includes(input.id)) {
						materials.push(input.id);
					}
				});
			} else {
				if (!materials.includes(bp._id)) {
					materials.push(bp._id);
				}
				bp.outputs.forEach((input) => {
					if (!materials.includes(input.id)) {
						materials.push(input.id);
					}
				});
			}
		});
	} else if (type === 'hybrid') {
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
	} else if (type === 'bio') {
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
	}

	materials.forEach((item) => {
		item_string += item + ',';
	});
	item_string = item_string.slice(0, -1);

	return item_string
}

/**
 * Prepares the necessary data based on the type of blueprint.
 *
 * @param {string} type - The type of blueprint. Can be 'simple', 'complex', 'chain', 'unrefined', or 'refined'.
 * @param {Object} options - The options for the preparation. Includes 'inMarket', 'outMarket', and 'system'.
 * @param {Object[]} blueprints - The blueprints Object.
 * @param {Object} env - The environment object. Includes 'DB' and 'KV_DATA'.
 *
 * @returns {Promise<Object>} - The promise that resolves to an object containing 'prices', 'items', and 'cost_index'.
 *
 * @throws {Error} - Throws an error if 'prices', 'items', or 'cost_index' is undefined.
 */
export async function prep(type, options, blueprints, env) {
	let item_string = get_item_string_for_type(type, blueprints)
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

export async function simple(env, options, db, blueprints, material, amount, advanced = false) {
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

	const blueprint = blueprints.find((bp) => {
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
		let amount = Math.ceil(item.qt * runs * material_bonus);
		if ( item.qt === 1 ) {
			amount = Math.ceil(item.qt * runs);
		}
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

export async function chain(type, env, options, db, blueprints, material, amount, advanced = false) {
	// Get blueprint data for this material
	const blueprint = blueprints.find((bp) => {
		return bp._id === material && bp.type === type;
	});

	// Sanity Check
	if (blueprint === undefined) {
		console.log('Blueprint not found | material: ' + material);
		return;
	}

	if (advanced) {
		amount = parseInt(options.cycles) * parseInt(blueprint.output.qt);
	}

	// Actually calculate the costs
	// get data from simple
	let base = await simple(env, options, db, blueprints, material, amount, advanced);
	base.intermediates = {};
	base.intermediates.input = JSON.parse(JSON.stringify(base.input));
	base.intermediates.taxes = JSON.parse(JSON.stringify(base.taxes));
	base.intermediates.taxes_total = base.taxes_total;

	// calculate intermediate remaining items

	if (base.remaining.quantity === undefined) {
		base.remaining = [];
	} else {
		base.remaining = [base.remaining];
	}

	// new inputs array
	let new_inputs = [];
	let new_inputs_total = 0;

	// get the simple for each input if it is a bp in bp-comp
	let input_simple = [];
	await Promise.all(
		base.input.map(async (input_mat) => {
			let mat = blueprints.find((bp) => {
				return bp._id === input_mat.id && bp.type === 'simple';
			});
			if (mat !== undefined) {
				// material exists, get simple of this.
				let simple_mat = await simple(env, options, db, blueprints, input_mat.id, input_mat.quantity);
				input_simple.push(simple_mat);
			} else {
				new_inputs.push(input_mat);
				new_inputs_total += input_mat.price;
			}
		})
	);

	// sum all taxes && and to new input array
	input_simple.forEach((simple_mat) => {
		base.taxes.system += simple_mat.taxes.system;
		base.taxes.facility += simple_mat.taxes.facility;
		base.taxes.scc += simple_mat.taxes.scc;
		base.taxes.total += simple_mat.taxes.total;
		base.taxes_total += simple_mat.taxes_total;

		// for each input...
		simple_mat.input.forEach((simple_input) => {
			// check if item already exists in new input array
			let mat = new_inputs.find((in_mat) => {
				return in_mat.id === simple_input.id;
			});
			if (mat === undefined) {
				// doesn't exist so we just add it
				new_inputs.push(simple_input);
				new_inputs_total += simple_input.price;
			} else {
				// already exists so we have to add to it
				mat.price += simple_input.price;
				mat.quantity += simple_input.quantity;
				new_inputs_total += simple_input.price;
			}
		});

		// add remaining items to base
		let remaining = simple_mat.remaining;
		if (remaining.quantity !== 0) {
			let mat = base.remaining.find((in_mat) => {
				return in_mat.id === remaining.id;
			});
			if (mat === undefined) {
				// doesn't exist so we just add it
				base.remaining.push(remaining);
			} else {
				// already exists so we have to add to it
				mat.quantity += remaining.quantity;
				mat.price += remaining.price;
			}
		}
	});

	base.input = new_inputs;
	base.input_total = new_inputs_total;
	// Calculate the profit
	base.profit = base.output_total - base.input_total - base.taxes_total;
	base.profit_per = (base.profit / base.output_total) * 100;
	// Style
	if (base.profit > 0) {
		base.style = 'table-success';
	} else if (base.profit < 0) {
		base.style = 'table-danger';
	} else {
		base.style = 'table-warning';
	}

	return base;
}

export async function refined(env, options, db_unrefined, db_refined, blueprints, material, amount, advanced = false) {
	// Get blueprint data for this material
	const blueprint = blueprints.find((bp) => {
		return bp._id === material && bp.type === 'refined';
	});

	// Sanity Check
	if (blueprint === undefined) {
		console.log('Blueprint not found | material: ' + material);
		return;
	}

	// Actually calculate the costs
	// get data from simple
	let base = await simple(env, options, db_unrefined, blueprints, material, amount, advanced);
	base.intermediates = base.output;

	base.output_total = 0;
	base.profit = 0;
	base.profit_per = 0;
	// modify the output to be reprocessed items
	const input = base.output;

	let outputs = [];
	blueprint.outputs.forEach((item) => {
		let temp = {
			id: item.id,
			name: db_refined.items.find((items) => {
				return items.id === item.id;
			}).name,
			quantity: item.quantity * input.quantity * 0.6,
			price:
				db_refined.prices.find((price) => {
					return price.item_id === item.id && price.system === options.outMarket;
				})[options.output] *
				item.quantity *
				input.quantity *
				0.6
		};
		outputs.push(temp);
		base.output_total += temp.price;
	});
	base.output = outputs;

	// Calculate the profit
	base.profit = base.output_total - base.input_total - base.taxes_total;
	base.profit_per = (base.profit / base.output_total) * 100;

	// Style
	if (base.profit > 0) {
		base.style = 'table-success';
	} else if (base.profit < 0) {
		base.style = 'table-danger';
	} else {
		base.style = 'table-warning';
	}

	// return all data
	return base;
}
