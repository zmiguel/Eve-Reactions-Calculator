const esi = [
	{
		adjusted_price: 0,
		average_price: 28792386.36,
		type_id: 43691
	},
	{
		adjusted_price: 870547.8174544628,
		average_price: 868427.68,
		type_id: 32772
	},
	{
		adjusted_price: 39694.92848356895,
		average_price: 46390.44,
		type_id: 32774
	},
	{
		adjusted_price: 0,
		average_price: 774950000,
		type_id: 49153
	},
	{
		adjusted_price: 5982426.35741778,
		average_price: 5547510.67,
		type_id: 32780
	},
	{
		adjusted_price: 8.060064672359106,
		average_price: 5.91,
		type_id: 32782
	},
	{
		adjusted_price: 0,
		average_price: 120000,
		type_id: 32783
	},
	{
		adjusted_price: 27.893352978963147,
		average_price: 25.47,
		type_id: 18
	},
	{
		adjusted_price: 33571.31238697481,
		average_price: 53824.44,
		type_id: 32787
	},
	{
		adjusted_price: 58170678744.59828,
		type_id: 32788
	},
	{
		adjusted_price: 611.1336537286463,
		average_price: 1214.58,
		type_id: 21
	},
	{
		adjusted_price: 3481.1887383434064,
		average_price: 3038.71,
		type_id: 22
	},
	{
		adjusted_price: 5258665.291447555,
		type_id: 32792
	},
	{
		adjusted_price: 13711762.49297258,
		type_id: 32793
	},
	{
		adjusted_price: 474370.8794464356,
		average_price: 500000,
		type_id: 32797
	},
	{
		adjusted_price: 10964.708807799263,
		type_id: 32799
	},
	{
		adjusted_price: 86.05332212749005,
		type_id: 32801
	},
	{
		adjusted_price: 3.451811492665853,
		average_price: 3.99,
		type_id: 34
	},
	{
		adjusted_price: 7.468020634936741,
		average_price: 10.21,
		type_id: 35
	},
	{
		adjusted_price: 38.87654311921881,
		average_price: 52.63,
		type_id: 36
	},
	{
		adjusted_price: 89.64251351635791,
		average_price: 602.85,
		type_id: 37
	},
	{
		adjusted_price: 474.09744609991077,
		average_price: 910.15,
		type_id: 38
	},
	{
		adjusted_price: 565.4519223386778,
		average_price: 2172.58,
		type_id: 39
	},
	{
		adjusted_price: 2195.4428323008697,
		average_price: 3326.7,
		type_id: 40
	},
	{
		adjusted_price: 0,
		average_price: 15.94,
		type_id: 41
	}
];

const items = [
	{
		id: 29,
		name: 'Credits',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Money'
	},
	{
		id: 34,
		name: 'Tritanium',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 35,
		name: 'Pyerite',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 36,
		name: 'Mexallon',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 37,
		name: 'Isogen',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 38,
		name: 'Nocxium',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 39,
		name: 'Zydrine',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	},
	{
		id: 40,
		name: 'Megacyte',
		adjusted_price: 0,
		base_industry_price: 0,
		group: 'Mineral'
	}
];

items.forEach(async (item) => {
	const adjusted_price = esi.find((price) => price.type_id === item.id)?.adjusted_price;
	if (adjusted_price) {
		console.log(`Updating adjusted price for ${item.id} to ${adjusted_price}`);
	} else {
		console.log(`No adjusted price found for ${item.id}`);
	}
});
