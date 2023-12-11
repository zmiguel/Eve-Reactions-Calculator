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
		let writeStream = createWriteStream('./csv/systems.csv');
		writeStream.write('id,name,security,cost_index\n');
		new_csv.forEach(function (value) {
			writeStream.write(`${value.id},${value.name},${value.security},${value.cost_index}\n`);
		});
	});

// save new_csv to csv file
