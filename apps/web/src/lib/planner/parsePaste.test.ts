import { describe, expect, it } from 'vitest';
import { dataset } from '../../../../../packages/engine/test/fixtures/dataset';
import { formulaNameIndex, parsePaste, parseQuantity, typeNameIndex } from './parsePaste';

const types = typeNameIndex(dataset);
const formulas = formulaNameIndex(dataset);
const COBALT = 16640;
const CADMIUM = 16643;
const HYDROCARBONS = 16633;

describe('parsePaste', () => {
	it('reads Name<TAB>Qty lines copied from an EVE inventory, ignoring the extra columns', () => {
		const text = 'Cobalt\t12,345\tMoon Materials\t\t\t123.45 m3\nCadmium\t7\tMoon Materials';
		expect(parsePaste(text, types)).toEqual({ quantities: { [COBALT]: 12345, [CADMIUM]: 7 }, errors: [] });
	});

	it('accepts two or more spaces as the column separator and any thousands separator', () => {
		const text = [
			'Cobalt  12.345',
			'Cadmium    1 000',
			'Hydrocarbons\t1\u00a0234\u00a0567',
			'Titanium\t9'
		].join('\n');
		expect(parsePaste(text, types).quantities).toEqual({
			[COBALT]: 12345,
			[CADMIUM]: 1000,
			[HYDROCARBONS]: 1234567,
			16638: 9
		});
	});

	it('matches names case-insensitively, skips blank lines and sums duplicates', () => {
		const text = '\n  cobalt\t10\r\n\r\nCOBALT\t5\n   \nCobalt  1,000\n';
		expect(parsePaste(text, types)).toEqual({ quantities: { [COBALT]: 1015 }, errors: [] });
	});

	it('counts a line without a quantity as one unit', () => {
		expect(parsePaste('Cobalt\nCadmium\t\tMoon Materials', types).quantities).toEqual({
			[COBALT]: 1,
			[CADMIUM]: 1
		});
	});

	it('reports unknown names and malformed quantities with their line numbers', () => {
		const result = parsePaste('Cobalt\t5\nPlutonium\t3\n\nCadmium\t1,23\nCadmium\t-4', types);
		expect(result.quantities).toEqual({ [COBALT]: 5 });
		expect(result.errors).toEqual([
			{ line: 2, text: 'Plutonium', reason: 'unknown_name' },
			{ line: 4, text: '1,23', reason: 'invalid_quantity' },
			{ line: 5, text: '-4', reason: 'invalid_quantity' }
		]);
	});

	it('matches formulas by formula name, not by product name', () => {
		const result = parsePaste('Carbon Polymers Reaction Formula\t2\nCarbon Polymers\t1', formulas);
		expect(result.quantities).toEqual({ 46167: 2 });
		expect(result.errors).toEqual([{ line: 2, text: 'Carbon Polymers', reason: 'unknown_name' }]);
	});
});

describe('parseQuantity', () => {
	it('reads whole quantities with or without thousands separators', () => {
		expect(['35280000', '35,280,000', ' 35.280.000 ', '35 280 000', "35'280'000"].map(parseQuantity)).toEqual(
			[35_280_000, 35_280_000, 35_280_000, 35_280_000, 35_280_000]
		);
	});

	it('rejects anything else', () => {
		expect(['', 'abc', '1,23', '-5', '1.5', '12,3456'].map(parseQuantity)).toEqual([
			null,
			null,
			null,
			null,
			null,
			null
		]);
	});
});
