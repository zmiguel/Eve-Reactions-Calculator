import { describe, expect, it } from 'vitest';
import { calculateReaction } from '../src/calculate.ts';
import { MOON_MATERIAL_CLASS, sortMaterials } from '../src/constants.ts';
import { byId, makeCtx } from './fixtures/context.ts';
import { dataset } from './fixtures/dataset.ts';

const OXYGEN_FUEL_BLOCK = 4312;
const WATER = 3645;
const EVAPORITE_DEPOSITS = 16635;
const SILICATES = 16636;
const TITANIUM = 16638;
const CHROMIUM = 16641;
const CADMIUM = 16643;
const CAESIUM = 16647;
const TITANIUM_CHROMIDE = 16654;
const SILICON_DIBORITE = 16658;
const HEXITE = 16665;
const TITANIUM_CARBIDE = 16671;
const UNREFINED_HEXITE = 32825;

describe('sortMaterials', () => {
	it('orders fuel blocks, moon materials by class then name, other raw materials, intermediates, then the rest', () => {
		const shuffled = [
			TITANIUM_CARBIDE,
			CHROMIUM,
			WATER,
			TITANIUM_CHROMIDE,
			CAESIUM,
			SILICATES,
			OXYGEN_FUEL_BLOCK,
			SILICON_DIBORITE,
			CADMIUM,
			TITANIUM,
			EVAPORITE_DEPOSITS
		].map((typeId) => ({ typeId }));
		expect(sortMaterials(shuffled, dataset).map((i) => i.typeId)).toEqual([
			OXYGEN_FUEL_BLOCK,
			EVAPORITE_DEPOSITS,
			SILICATES,
			TITANIUM,
			CADMIUM,
			CHROMIUM,
			CAESIUM,
			WATER,
			SILICON_DIBORITE,
			TITANIUM_CHROMIDE,
			TITANIUM_CARBIDE
		]);
	});

	it('classifies the 20 raw moon materials, 4 per class', () => {
		const classes = Object.values(MOON_MATERIAL_CLASS);
		expect(classes).toHaveLength(20);
		for (const c of [4, 8, 16, 32, 64]) expect(classes.filter((x) => x === c)).toHaveLength(4);
		expect(MOON_MATERIAL_CLASS[CADMIUM]).toBe(16);
		expect(MOON_MATERIAL_CLASS[EVAPORITE_DEPOSITS]).toBe(4);
	});

	it('lists reprocessed outputs in the material order', () => {
		const shuffled = [HEXITE, CHROMIUM, EVAPORITE_DEPOSITS, CADMIUM, TITANIUM].map((typeId) => ({
			typeId,
			quantity: 10,
			quantityMin: null,
			quantityMax: null
		}));
		const ctx = {
			...makeCtx(),
			dataset: {
				...dataset,
				reprocess: {
					...dataset.reprocess,
					[UNREFINED_HEXITE]: { typeId: UNREFINED_HEXITE, portionSize: 1, materials: shuffled }
				}
			}
		};
		const r = calculateReaction(byId(46191), ctx, { view: 'single', outputMode: 'reprocessed' });
		expect(r.outputMode).toBe('reprocessed');
		expect(r.outputs.map((o) => o.typeId)).toEqual([EVAPORITE_DEPOSITS, TITANIUM, CADMIUM, CHROMIUM, HEXITE]);
	});
});
