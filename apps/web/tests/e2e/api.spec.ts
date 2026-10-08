import { expect, test } from './fixtures';

test('API v2 profits as JSON @smoke', async ({ request }) => {
	const response = await request.get('/api/v2/profits?reactor=composite');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('application/json');
	const body = (await response.json()) as {
		asOf: string;
		rows: { slug: string; reactor: string; profit: number }[];
	};
	expect(body.asOf).toBeTruthy();
	expect(body.rows.length).toBeGreaterThan(0);
	for (const row of body.rows) {
		expect(row.reactor).toBe('composite');
		expect(row.slug).toMatch(/^[a-z0-9-]+$/);
		expect(typeof row.profit).toBe('number');
	}
});

test('API v2 profits as CSV @smoke', async ({ request }) => {
	const response = await request.get('/api/v2/profits?reactor=composite&format=csv');
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/csv');
	const [header, ...rows] = (await response.text()).trim().split(/\r?\n/);
	expect(header.split(',')).toEqual(expect.arrayContaining(['slug', 'name', 'reactor', 'profit']));
	expect(rows.length).toBeGreaterThan(0);
});

test('API v1 answers 410 Gone @smoke', async ({ request }) => {
	const response = await request.get('/api/v1/anything');
	expect(response.status()).toBe(410);
	const body = (await response.json()) as { error: { code: string } };
	expect(body.error.code).toBe('API_V1_REMOVED');
});
