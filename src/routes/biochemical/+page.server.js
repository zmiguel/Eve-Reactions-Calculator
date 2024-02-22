import { prep, simple, chain } from '$lib/server/calc';
import { error } from '@sveltejs/kit';

export const load = async ({ cookies, platform }) => {
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
		duration: cookies.get('duration')
	};

	const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-bio'));
	const synth_blueprints = await blueprints.filter((bp) => bp.type === 'synth');
	const standard_blueprints = await blueprints.filter((bp) => bp.type === 'stand');
	const improved_blueprints = await blueprints.filter((bp) => bp.type === 'impro');
	const strong_blueprints = await blueprints.filter((bp) => bp.type === 'strong');
	const molecular_blueprints = await blueprints.filter((bp) => bp.type === 'molecular');

	const db_prep = await prep('bio', options, blueprints, platform.env);

	if (!db_prep) {
		throw error(500, `db_prep is undefined`);
	}

	const all_bps = [
		{ Type: 'synth', blueprints: synth_blueprints },
		{ Type: 'standard', blueprints: standard_blueprints },
		{ Type: 'improved', blueprints: improved_blueprints },
		{ Type: 'improved_chain', blueprints: improved_blueprints },
		{ Type: 'strong', blueprints: strong_blueprints },
		{ Type: 'strong_chain', blueprints: strong_blueprints },
		{ Type: 'molecular', blueprints: molecular_blueprints }
	];

	let results_synth = [];
	let results_standard = [];
	let results_improved = [];
	let results_improved_chain = [];
	let results_strong = [];
	let results_strong_chain = [];
	let results_molecular = [];

	await Promise.all(
		all_bps.map(async (bps) => {
			switch (bps.Type) {
				case 'synth':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_synth.push(
								await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
				case 'standard':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_standard.push(
								await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
				case 'improved':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_improved.push(
								await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
				case 'improved_chain':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_improved_chain.push(
								await chain(
									'impro',
									platform.env,
									options,
									db_prep,
									blueprints,
									parseInt(bp._id),
									0
								)
							);
						})
					);
					break;
				case 'strong':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_strong.push(
								await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
				case 'strong_chain':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_strong_chain.push(
								await chain(
									'strong',
									platform.env,
									options,
									db_prep,
									blueprints,
									parseInt(bp._id),
									0
								)
							);
						})
					);
					break;
				case 'molecular':
					await Promise.all(
						bps.blueprints.map(async (bp) => {
							results_molecular.push(
								await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0)
							);
						})
					);
					break;
			}
		})
	);

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
		results: {
			synth: results_synth,
			standard: results_standard,
			improved: results_improved,
			improved_chain: results_improved_chain,
			strong: results_strong,
			strong_chain: results_strong_chain,
			molecular: results_molecular
		}
	};
};
