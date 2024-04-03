import { error, json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, platform }) {
	// check if id in an integer
	const id = url.searchParams.get('id') ? url.searchParams.get('id') : null;
	if (id === null) {
		error(400, 'No id provided');
	}
	if (isNaN(id)) {
		error(400, 'Not a number');
	}

	const price = await platform.env.DB.prepare('SELECT * FROM prices WHERE item_id = ?')
		.bind(id)
		.all();

	return json(price.results);
}
