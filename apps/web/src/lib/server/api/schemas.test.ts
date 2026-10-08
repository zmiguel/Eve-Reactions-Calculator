import { describe, expect, it } from 'vitest';
import { SystemIdParams, SystemsQuery } from './schemas';

describe('SystemsQuery', () => {
	it('applies defaults, trims q, caps the limit and parses reactionsOnly', () => {
		expect(SystemsQuery.parse({ q: ' ig ' })).toEqual({ q: 'ig', limit: 10, reactionsOnly: true });
		expect(SystemsQuery.parse({ q: 'ig', limit: '75', reactionsOnly: 'false' })).toEqual({
			q: 'ig',
			limit: 50,
			reactionsOnly: false
		});
		expect(SystemsQuery.parse({ q: 'ig', reactionsOnly: '1' }).reactionsOnly).toBe(true);
	});

	it('rejects short queries, non-integer limits and unknown booleans', () => {
		expect(SystemsQuery.safeParse({ q: ' i ' }).success).toBe(false);
		expect(SystemsQuery.safeParse({ q: 'ig', limit: '2.5' }).success).toBe(false);
		expect(SystemsQuery.safeParse({ q: 'ig', reactionsOnly: 'yes' }).success).toBe(false);
	});
});

describe('SystemIdParams', () => {
	it('accepts positive integer ids only', () => {
		expect(SystemIdParams.parse({ id: '30002647' })).toEqual({ id: 30002647 });
		expect(SystemIdParams.safeParse({ id: '-1' }).success).toBe(false);
		expect(SystemIdParams.safeParse({ id: 'abc' }).success).toBe(false);
	});
});
