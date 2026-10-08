import { describe, expect, it } from 'vitest';
import {
	dateParam,
	defineQuery,
	enumDefaultParam,
	enumParam,
	idListParam,
	isIsoDate,
	numberParam,
	required,
	stringParam
} from './params';

const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
	r.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('query parameter definitions', () => {
	const q = defineQuery({
		n: numberParam('A number.', { min: 0, max: 10, default: 3 }),
		i: numberParam('An integer.', { min: 1, max: 5, integer: true }),
		e: enumParam('An enum.', ['a', 'b'], 'a'),
		d: enumDefaultParam('Defaulted.', ['x', 'y'], 'x'),
		s: stringParam('Text.', { example: 'hi' }),
		day: dateParam('A day.'),
		ids: required(idListParam('Ids.', { max: 3, example: '1,2' }))
	});

	it('parses valid values, applies enum defaults and leaves other params undefined', () => {
		expect(q.schema.parse({ n: ' 2.5 ', i: '4', e: 'b', s: ' t ', day: '2026-02-28', ids: '3,1,3' })).toEqual(
			{
				n: 2.5,
				i: 4,
				e: 'b',
				d: 'x',
				s: 't',
				day: '2026-02-28',
				ids: [3, 1]
			}
		);
		expect(q.schema.parse({ ids: '1' })).toEqual({ d: 'x', ids: [1] });
	});

	it('reports one readable issue per invalid param', () => {
		const result = q.schema.safeParse({
			n: '11',
			i: '2.5',
			e: 'c',
			d: 'z',
			s: ' ',
			day: '2026-02-30',
			ids: '1,2,3,4'
		});
		expect(issues(result)).toEqual([
			'n: Must be at most 10',
			'i: Must be a whole number',
			'e: Must be one of: a, b',
			'd: Must be one of: x, y',
			's: Must not be empty',
			'day: Must be a date YYYY-MM-DD',
			'ids: At most 3 ids'
		]);
		expect(issues(q.schema.safeParse({ n: 'abc', ids: '1,a' }))).toEqual([
			'n: Must be a number',
			'ids: Must be a comma-separated list of ids'
		]);
		expect(issues(q.schema.safeParse({}))).toEqual(['ids: Required']);
	});

	it('documents every param as an OpenAPI query parameter', () => {
		expect(q.parameters.map((p) => [p.name, p.in, p.required])).toEqual([
			['n', 'query', false],
			['i', 'query', false],
			['e', 'query', false],
			['d', 'query', false],
			['s', 'query', false],
			['day', 'query', false],
			['ids', 'query', true]
		]);
		expect(q.parameters[0].schema).toEqual({ type: 'number', minimum: 0, maximum: 10, default: 3 });
		expect(q.parameters[1].schema).toEqual({ type: 'integer', minimum: 1, maximum: 5 });
		expect(q.parameters[2].schema).toEqual({ type: 'string', enum: ['a', 'b'], default: 'a' });
		expect(q.parameters[3].schema).toEqual({ type: 'string', enum: ['x', 'y'], default: 'x' });
		expect(q.parameters[5].schema).toEqual({ type: 'string', format: 'date' });
		expect(q.parameters[6]).toMatchObject({ example: '1,2', description: 'Ids.' });
	});

	it('isIsoDate accepts only real calendar days', () => {
		expect(isIsoDate('2024-02-29')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
		expect(isIsoDate('2026-1-01')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
	});
});
