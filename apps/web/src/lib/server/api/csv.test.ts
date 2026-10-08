import { describe, expect, it } from 'vitest';
import { apiCsv, toCsv } from './csv';

describe('toCsv', () => {
	it('writes the header first and one CRLF-terminated line per row in column order', () => {
		expect(toCsv(['a', 'b'], [{ b: 2, a: 1 }, { a: 3 }])).toBe('a,b\r\n1,2\r\n3,\r\n');
		expect(toCsv(['a'], [])).toBe('a\r\n');
	});

	it('quotes fields with commas, quotes, CR or LF and doubles inner quotes (RFC 4180)', () => {
		const csv = toCsv(
			['name', 'n'],
			[{ name: 'Caesarium, "Cadmide"', n: 1 }, { name: 'a\nb', n: 2 }, { name: 'c\rd' }]
		);
		expect(csv).toBe('name,n\r\n"Caesarium, ""Cadmide""",1\r\n"a\nb",2\r\n"c\rd",\r\n');
	});

	it('keeps numbers unformatted and writes null/undefined as empty and booleans as words', () => {
		expect(toCsv(['x', 'y', 'z', 'w'], [{ x: 1234567.891, y: null, z: false, w: -0.5 }])).toBe(
			'x,y,z,w\r\n1234567.891,,false,-0.5\r\n'
		);
	});
});

describe('apiCsv', () => {
	it('answers text/csv with CORS and the given Cache-Control', async () => {
		const response = apiCsv(['a'], [{ a: 1 }], 'public, max-age=60');
		expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
		expect(await response.text()).toBe('a\r\n1\r\n');
	});
});
