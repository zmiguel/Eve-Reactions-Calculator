import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SVG, renderOg } from '../render-og.ts';

describe('renderOg', () => {
	it('renders a 1200×630 PNG', () => {
		const png = renderOg(readFileSync(DEFAULT_SVG, 'utf8'));
		expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		expect(new TextDecoder().decode(png.subarray(12, 16))).toBe('IHDR');
		expect(view.getUint32(16)).toBe(1200);
		expect(view.getUint32(20)).toBe(630);
	});
});
