// open csv file
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const bp_comp = require('./json/bp-comp.json');

// get bps with type unrefined
const unrefined = bp_comp.filter((bp) => bp.type === 'unrefined');
// make array of bp ids
const unrefined_ids = unrefined.map((bp) => bp._id);

console.log(unrefined_ids);

let to_add = [];
let bps = [];

createReadStream('./csv/invTypeMaterials.csv')
	.pipe(parse({ delimiter: ',', from_line: 2 }))
	.on('data', function (row) {
		if (unrefined_ids.includes(parseInt(row[0]))) {
			console.log(row);
			to_add.push({
				id: parseInt(row[0]),
				material_id: parseInt(row[1]),
				quantity: parseInt(row[2])
			});
		}
	})
	.on('end', function () {
		// build json from to_ids
		unrefined_ids.forEach((id) => {
			// get all to_add with id
			let mats = to_add.filter((mats) => mats.id === id);
			let outputs = [];
			mats.forEach((mat) => {
				outputs.push({
					id: mat.material_id,
					quantity: mat.quantity
				});
			});
			bps.push({
				_id: id,
				name: unrefined.find((bp) => bp._id === id).name,
				type: 'refined',
				inputs: {
					id: id,
					quantity: 1
				},
				outputs: outputs
			});
		});
		console.log(JSON.stringify(bps, null, 4));
	});
