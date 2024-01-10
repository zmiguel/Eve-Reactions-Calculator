// open csv file
import { createReadStream, createWriteStream } from 'fs';
import { parse } from 'csv-parse';

let new_csv = [];

createReadStream('./csv/mapSolarSystems.csv')
	.pipe(parse({ delimiter: ',', from_line: 2 }))
	.on('data', function (row) {
		// create new csv file with only the columns we need
		new_csv.push({
			id: row[2],
			name: row[3],
			security: row[21],
			cost_index: 0
		});
	})
	.on('end', function () {
		let writeStream = createWriteStream('./csv/systems.js');
		writeStream.write('systems = [\n');

		new_csv.sort();
		let only_systems = [];

		new_csv.forEach(function (value) {
			if (value.security < 0.5) {
				only_systems.push(`'${value.name}'`);
			}
		});
		only_systems.sort();
		only_systems.forEach(function (value) {
			writeStream.write(`${value},\n`);
		});
		writeStream.write('];');
	});

// save new_csv to csv file
