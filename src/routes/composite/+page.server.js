import { prep, simple, chain, refined } from '$lib/server/calc';
import { error } from '@sveltejs/kit';

export const load = async ({ cookies, platform }) => {
	const settingsMode = cookies.get('settingsMode') || 'single';
	const suffix = settingsMode === 'single' ? '' : '_composite';

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
	const simple_blueprints = await blueprints.filter((bp) => bp.type === 'simple');
	const complex_blueprints = await blueprints.filter((bp) => bp.type === 'complex');
	const unrefined_blueprints = await blueprints.filter((bp) => bp.type === 'unrefined');

	const db_prep = [
		{ type: 'simple' },
		{ type: 'complex' },
		{ type: 'chain' },
		{ type: 'unrefined' },
		{ type: 'refined' }
	];

	let db_prep_simple, db_prep_complex, db_prep_unrefined, db_prep_chain, db_prep_refined;
	await Promise.all(
		db_prep.map(async (db) => {
			switch (db.type) {
				case 'simple':
					db_prep_simple = await prep('simple', options, blueprints, platform.env);
					break;
				case 'complex':
					db_prep_complex = await prep('complex', options, blueprints, platform.env);
					break;
				case 'chain':
					db_prep_chain = await prep('chain', options, blueprints, platform.env);
					break;
				case 'unrefined':
					db_prep_unrefined = await prep('unrefined', options, blueprints, platform.env);
					break;
				case 'refined':
					db_prep_refined = await prep('refined', options, blueprints, platform.env);
					break;
			}
		})
	);

	if (!db_prep_simple) {
		error(500, `db_prep_simple is undefined`);
	}
	if (!db_prep_complex) {
		error(500, `db_prep_complex is undefined`);
	}
	if (!db_prep_chain) {
		error(500, `db_prep_complex is undefined`);
	}
	if (!db_prep_unrefined) {
		error(500, `db_prep_unrefined is undefined`);
	}
	if (!db_prep_refined) {
		error(500, `db_prep_refined is undefined`);
	}

	const all_bps = [
		{ type: 'simple', blueprints: simple_blueprints },
		{ type: 'complex', blueprints: complex_blueprints },
		{ type: 'chain', blueprints: complex_blueprints },
		{ type: 'unrefined', blueprints: unrefined_blueprints },
		{ type: 'refined', blueprints: unrefined_blueprints }
	];

	let simple_results = [];
	let complex_results = [];
	let chain_results = [];
	let unrefined_results = [];
	let refined_results = [];
	await Promise.all(
		all_bps.map(async (bps) => {
			switch (bps.type) {
				case 'simple':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							simple_results.push(
								await simple(platform.env, options, db_prep_simple, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
				case 'complex':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							complex_results.push(
								await simple(
									platform.env,
									options,
									db_prep_complex,
									blueprints,
									parseInt(bp._id),
									0
								)
							);
						})
					);
					break;
				case 'chain':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							chain_results.push(
								await chain(
									'complex',
									platform.env,
									options,
									db_prep_chain,
									blueprints,
									parseInt(bp._id),
									0
								)
							);
						})
					);
					break;
				case 'unrefined':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							unrefined_results.push(
								await simple(
									platform.env,
									options,
									db_prep_unrefined,
									blueprints,
									parseInt(bp._id),
									0,
									false,
									360
								)
							);
						})
					);
					break;
				case 'refined':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							refined_results.push(
								await refined(
									platform.env,
									options,
									db_prep_unrefined,
									db_prep_refined,
									blueprints,
									parseInt(bp._id),
									0
								)
							);
						})
					);
					break;
			}
		})
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
		results: {
			simple: simple_results,
			complex: complex_results,
			chain: chain_results,
			unrefined: unrefined_results,
			refined: refined_results
		}
	};
};
