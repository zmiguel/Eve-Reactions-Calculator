import { describe, expect, it } from 'vitest';
import {
	formatDuration,
	formatIsk,
	formatIskFull,
	formatNumber,
	formatPct,
	formatRelative,
	formatUtc
} from './format';

describe('formatIsk', () => {
	it.each([
		[1_234_567, '1.23M'],
		[4_560_000_000, '4.56B'],
		[-4_560_000_000, '-4.56B'],
		[12_500, '12.50K'],
		[2.5e12, '2.50T'],
		[950, '950'],
		[12.345, '12.35'],
		[0, '0'],
		[null, 'n/a'],
		[Number.NaN, 'n/a']
	])('%s → %s', (value, expected) => {
		expect(formatIsk(value)).toBe(expected);
	});

	it('full value for titles', () => {
		expect(formatIskFull(1234567.891)).toBe('1,234,567.89 ISK');
		expect(formatIskFull(null)).toBe('n/a');
	});
});

describe('formatPct / formatNumber', () => {
	it('formats with fixed digits', () => {
		expect(formatPct(12.345)).toBe('12.3%');
		expect(formatPct(-3, 2)).toBe('-3.00%');
		expect(formatPct(null)).toBe('n/a');
		expect(formatNumber(12268)).toBe('12,268');
		expect(formatNumber(4769.28, 1)).toBe('4,769.3');
	});
});

describe('formatDuration', () => {
	it.each([
		[4769.28, '1h 19m 29s'],
		[86400 * 7, '7d'],
		[90061, '1d 1h 1m'],
		[45, '45s'],
		[0, '0s'],
		[-1, 'n/a']
	])('%s s → %s', (seconds, expected) => {
		expect(formatDuration(seconds)).toBe(expected);
	});
});

describe('formatUtc', () => {
	it('prints minutes in UTC', () => {
		expect(formatUtc(Date.UTC(2026, 9, 6, 12, 5, 59))).toBe('2026-10-06 12:05 UTC');
		expect(formatUtc(null)).toBe('n/a');
	});
});

describe('formatRelative', () => {
	const now = Date.UTC(2026, 9, 6, 12);
	it.each([
		[now - 10_000, 'just now'],
		[now - 5 * 60_000, '5 min ago'],
		[now - 3 * 3_600_000, '3 h ago'],
		[now - 2 * 86_400_000, '2 d ago'],
		[now + 4 * 60_000, 'in 4 min'],
		[null, 'n/a']
	])('%s → %s', (ms, expected) => {
		expect(formatRelative(ms, now)).toBe(expected);
	});
});
