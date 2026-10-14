import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTANTS } from '../src/constants.ts';
import { requiredQuantity, type EfficiencyProfile } from '../src/formulas.ts';
import {
	facilityMaterialBonus,
	jobMaterialBonus,
	jobMaterialModifier,
	manufacturingMaterialModifier,
	parseRigIds,
	resolveFacility,
	type ResolvedFacility
} from '../src/ledger/facility.ts';
import {
	AZBEL,
	FORTIZAR,
	FUSION_THRUSTER,
	L_SET_ADVANCED_COMPONENT_ME_II,
	L_SET_AMMUNITION_ME_II,
	L_SET_REACTOR_EFFICIENCY_II,
	METHANOFULLERENE,
	M_SET_COMPOSITE_REACTOR_ME_I,
	OUTPOST_RIG,
	PURE_STANDARD_MINDFLOOD,
	RAITARU,
	SPIKE_S,
	TATARA,
	TEST_REACTION_STRUCTURE,
	TITANIUM_CARBIDE,
	TITANIUM_CHROMIDE,
	industry
} from './fixtures/industry.ts';

const facility = (over: Partial<ResolvedFacility>): ResolvedFacility => ({
	structureTypeId: null,
	rigs: null,
	band: null,
	...over
});

describe('resolveFacility', () => {
	it("takes EVE's values and fills only the unknown ones from the settings", () => {
		expect(
			resolveFacility(
				{ typeId: AZBEL, rigs: [OUTPOST_RIG], band: 'lowsec' },
				{ structureTypeId: 0, rigs: [] }
			)
		).toEqual({ structureTypeId: AZBEL, rigs: [OUTPOST_RIG], band: 'lowsec' });
		expect(
			resolveFacility({ typeId: AZBEL, rigs: null, band: 'nullsec' }, { rigs: [L_SET_AMMUNITION_ME_II] })
		).toEqual({ structureTypeId: AZBEL, rigs: [L_SET_AMMUNITION_ME_II], band: 'nullsec' });
		expect(resolveFacility(null, { structureTypeId: 0, rigs: [] })).toEqual({
			structureTypeId: 0,
			rigs: [],
			band: null
		});
		expect(resolveFacility({ typeId: null, rigs: null, band: null }, undefined)).toEqual({
			structureTypeId: null,
			rigs: null,
			band: null
		});
	});
});

describe('parseRigIds', () => {
	it('reads arrays of positive safe integers and treats anything else as unknown', () => {
		expect(parseRigIds('[46640,37180]')).toEqual([46640, 37180]);
		expect(parseRigIds('[]')).toEqual([]);
		for (const json of [
			null,
			'',
			'nope',
			'{}',
			'46640',
			'[0]',
			'[-1]',
			'[1.5]',
			'["46640"]',
			'[9007199254740992]'
		]) {
			expect(parseRigIds(json)).toBeNull();
		}
	});
});

describe('facilityMaterialBonus', () => {
	const azbel = facility({
		structureTypeId: AZBEL,
		rigs: [L_SET_AMMUNITION_ME_II, L_SET_ADVANCED_COMPONENT_ME_II],
		band: 'nullsec'
	});

	it('applies the structure and only the installed rig whose filter matches the product', () => {
		const thruster = facilityMaterialBonus(industry, 'manufacturing', FUSION_THRUSTER, azbel);
		expect(thruster.parts.map((p) => [p.kind, p.typeId])).toEqual([
			['structure', AZBEL],
			['rig', L_SET_ADVANCED_COMPONENT_ME_II]
		]);
		// 0.99 × (1 − 0.024 × 2.1) = 0.99 × 0.9496.
		expect(thruster.parts[1].reduction).toBeCloseTo(0.0504, 12);
		expect(thruster.multiplier).toBeCloseTo(0.940104, 12);

		const spike = facilityMaterialBonus(industry, 'manufacturing', SPIKE_S, azbel);
		expect(spike.parts.map((p) => p.typeId)).toEqual([AZBEL, L_SET_AMMUNITION_ME_II]);
		expect(spike.multiplier).toBeCloseTo(0.940104, 12);
	});

	it('gives no rig bonus to a product no installed rig covers', () => {
		const result = facilityMaterialBonus(
			industry,
			'manufacturing',
			FUSION_THRUSTER,
			facility({ structureTypeId: AZBEL, rigs: [L_SET_AMMUNITION_ME_II], band: 'nullsec' })
		);
		expect(result.parts.map((p) => p.kind)).toEqual(['structure']);
		expect(result.multiplier).toBeCloseTo(0.99, 12);
	});

	it('applies bonuses without a filter to every product, even one with no filter', () => {
		const raitaru = facilityMaterialBonus(
			industry,
			'manufacturing',
			1,
			facility({ structureTypeId: RAITARU })
		);
		expect(raitaru.parts).toEqual([{ kind: 'structure', typeId: RAITARU, name: 'Raitaru', reduction: 0.01 }]);
		expect(raitaru.multiplier).toBeCloseTo(0.99, 12);
		// The Outpost rig (3 %, no security multiplier) in a Fortizar (no role bonus), nullsec.
		const outpost = facilityMaterialBonus(
			industry,
			'manufacturing',
			1,
			facility({ structureTypeId: FORTIZAR, rigs: [OUTPOST_RIG], band: 'nullsec' })
		);
		expect(outpost.parts.map((p) => [p.typeId, p.reduction])).toEqual([[OUTPOST_RIG, 0.03]]);
		expect(outpost.multiplier).toBeCloseTo(0.97, 12);
	});

	it('scales rig bonuses by the band; wormhole as nullsec, unknown as highsec', () => {
		const at = (band: ResolvedFacility['band']) =>
			facilityMaterialBonus(
				industry,
				'manufacturing',
				FUSION_THRUSTER,
				facility({ structureTypeId: FORTIZAR, rigs: [L_SET_ADVANCED_COMPONENT_ME_II], band })
			).multiplier;
		expect(at('highsec')).toBeCloseTo(0.976, 12);
		expect(at(null)).toBeCloseTo(0.976, 12);
		// 1 − 0.024 × 1.9.
		expect(at('lowsec')).toBeCloseTo(0.9544, 12);
		// 1 − 0.024 × 2.1.
		expect(at('nullsec')).toBeCloseTo(0.9496, 12);
		expect(at('wormhole')).toBeCloseTo(0.9496, 12);
	});

	it('adds nothing for other activities, unknown types, unknown rigs or missing industry data', () => {
		const reactorRig = facility({ structureTypeId: TATARA, rigs: [L_SET_REACTOR_EFFICIENCY_II] });
		expect(facilityMaterialBonus(industry, 'manufacturing', TITANIUM_CARBIDE, reactorRig)).toEqual({
			multiplier: 1,
			parts: []
		});
		// Azbel's role bonus is manufacturing only.
		expect(
			facilityMaterialBonus(
				industry,
				'reaction',
				TITANIUM_CARBIDE,
				facility({ structureTypeId: AZBEL, rigs: [] })
			).parts
		).toEqual([]);
		expect(
			facilityMaterialBonus(
				industry,
				'manufacturing',
				FUSION_THRUSTER,
				facility({ structureTypeId: 0, rigs: [999_999] })
			)
		).toEqual({ multiplier: 1, parts: [] });
		expect(facilityMaterialBonus(undefined, 'manufacturing', FUSION_THRUSTER, azbel)).toEqual({
			multiplier: 1,
			parts: []
		});
	});
});

describe('manufacturingMaterialModifier', () => {
	it('multiplies blueprint ME and the facility bonus for the product', () => {
		// ME 10, Azbel with the L-Set Advanced Component ME II in nullsec: 0.9 × 0.99 × 0.9496.
		const mm = manufacturingMaterialModifier(
			10,
			industry,
			FUSION_THRUSTER,
			facility({ structureTypeId: AZBEL, rigs: [L_SET_ADVANCED_COMPONENT_ME_II], band: 'nullsec' })
		);
		expect(mm).toBeCloseTo(0.8460936, 12);
		// 10 runs × 75 × mm = 634.5702 → 635; 10 × 150 × mm = 1269.1404 → 1270; 1 run × 1 → 1.
		expect(requiredQuantity(10, 75, mm)).toBe(635);
		expect(requiredQuantity(10, 150, mm)).toBe(1270);
		expect(requiredQuantity(1, 1, mm)).toBe(1);
	});

	it('counts unknown rigs as none and an unknown structure as no structure', () => {
		const at = (over: Partial<ResolvedFacility>) =>
			manufacturingMaterialModifier(10, industry, FUSION_THRUSTER, facility(over));
		expect(at({ structureTypeId: AZBEL, rigs: null, band: 'nullsec' })).toBeCloseTo(0.891, 12);
		// 0.9 × (1 − 0.024 × 2.1).
		expect(
			at({ structureTypeId: null, rigs: [L_SET_ADVANCED_COMPONENT_ME_II], band: 'wormhole' })
		).toBeCloseTo(0.85464, 12);
		expect(at({})).toBeCloseTo(0.9, 12);
		expect(
			manufacturingMaterialModifier(0, undefined, FUSION_THRUSTER, facility({ structureTypeId: AZBEL }))
		).toBe(1);
	});
});

describe('jobMaterialBonus', () => {
	const fallback: EfficiencyProfile = {
		structure: 'athanor',
		meRig: 't1',
		teRig: 'none',
		reactionsSkill: 5,
		securityBand: 'lowsec'
	};
	const bonus = (product: number, over: Partial<ResolvedFacility>) =>
		jobMaterialBonus(industry, product, facility(over), fallback, DEFAULT_CONSTANTS);

	it('applies the L-Set reactor rig to each reaction kind', () => {
		const tatara = { structureTypeId: TATARA, rigs: [L_SET_REACTOR_EFFICIENCY_II] };
		for (const product of [METHANOFULLERENE, PURE_STANDARD_MINDFLOOD, TITANIUM_CHROMIDE, TITANIUM_CARBIDE]) {
			const nullsec = bonus(product, { ...tatara, band: 'nullsec' });
			expect(nullsec.source).toBe('facility');
			expect(nullsec.profileRig).toBeNull();
			expect(nullsec.parts.map((p) => p.typeId)).toEqual([L_SET_REACTOR_EFFICIENCY_II]);
			// 1 − 0.024 × 1.1.
			expect(nullsec.multiplier).toBeCloseTo(0.9736, 12);
			// 1 − 0.024 × 1.
			expect(bonus(product, { ...tatara, band: 'lowsec' }).multiplier).toBeCloseTo(0.976, 12);
		}
	});

	it("gives no bonus when the facility's rigs are known and none covers the product", () => {
		const composite = {
			structureTypeId: TATARA,
			rigs: [M_SET_COMPOSITE_REACTOR_ME_I],
			band: 'nullsec' as const
		};
		expect(bonus(METHANOFULLERENE, composite)).toEqual({
			multiplier: 1,
			source: 'facility',
			parts: [],
			profileRig: null
		});
		// 1 − 0.02 × 1.1.
		expect(bonus(TITANIUM_CARBIDE, composite).multiplier).toBeCloseTo(0.978, 12);
		expect(bonus(TITANIUM_CARBIDE, { structureTypeId: TATARA, rigs: [] }).multiplier).toBe(1);
	});

	it("scales known rigs with the profile's band when the facility's band is unknown or highsec", () => {
		const tatara = { structureTypeId: TATARA, rigs: [L_SET_REACTOR_EFFICIENCY_II] };
		const nullsecProfile: EfficiencyProfile = { ...fallback, securityBand: 'nullsec' };
		const at = (band: ResolvedFacility['band']) =>
			jobMaterialBonus(
				industry,
				TITANIUM_CARBIDE,
				facility({ ...tatara, band }),
				nullsecProfile,
				DEFAULT_CONSTANTS
			);
		// 1 − 0.024 × 1.1 (the profile's nullsec), not 1 − 0.024 × 1 (highsec).
		expect(at(null).source).toBe('facility');
		expect(at(null).multiplier).toBeCloseTo(0.9736, 12);
		expect(at('highsec').multiplier).toBeCloseTo(0.9736, 12);
		// A known band wins over the profile's: 1 − 0.024 × 1.
		expect(at('lowsec').multiplier).toBeCloseTo(0.976, 12);
		// Profile in lowsec: 1 − 0.024 × 1.
		expect(bonus(TITANIUM_CARBIDE, { ...tatara, band: null }).multiplier).toBeCloseTo(0.976, 12);
	});

	it("uses the profile's ME rig when the structure is unknown, on the facility's band when known", () => {
		const unknown = bonus(TITANIUM_CARBIDE, { rigs: [L_SET_REACTOR_EFFICIENCY_II] });
		expect(unknown.source).toBe('profile');
		expect(unknown.parts).toEqual([]);
		// T1 in the profile's lowsec: 1 − 0.02 × 1.
		expect(unknown.multiplier).toBeCloseTo(0.98, 12);
		expect(unknown.profileRig?.meRig).toBe('t1');
		expect(unknown.profileRig?.reduction).toBeCloseTo(0.02, 12);
		// 1 − 0.02 × 1.1.
		expect(bonus(TITANIUM_CARBIDE, { band: 'wormhole' }).multiplier).toBeCloseTo(0.978, 12);
		// Highsec has no reaction band: the profile's stays.
		expect(bonus(TITANIUM_CARBIDE, { band: 'highsec' }).multiplier).toBeCloseTo(0.98, 12);
		// No industry data in the dataset: the profile too.
		const noData = jobMaterialBonus(
			undefined,
			TITANIUM_CARBIDE,
			facility({ structureTypeId: TATARA, rigs: [L_SET_REACTOR_EFFICIENCY_II], band: 'nullsec' }),
			fallback,
			DEFAULT_CONSTANTS
		);
		expect(noData.source).toBe('profile');
		expect(noData.multiplier).toBeCloseTo(0.978, 12);
	});

	it("uses the structure's role bonus and the profile's ME rig when the rigs are unknown", () => {
		const tatara = bonus(TITANIUM_CARBIDE, { structureTypeId: TATARA, band: 'nullsec' });
		expect(tatara.source).toBe('structure_profile_rig');
		expect(tatara.parts).toEqual([]);
		expect(tatara.multiplier).toBeCloseTo(0.978, 12);
		const refinery = bonus(TITANIUM_CARBIDE, { structureTypeId: TEST_REACTION_STRUCTURE, band: 'nullsec' });
		expect(refinery.parts.map((p) => [p.kind, p.reduction])).toEqual([['structure', 0.01]]);
		// 0.99 × (1 − 0.02 × 1.1).
		expect(refinery.multiplier).toBeCloseTo(0.96822, 12);
		expect(
			jobMaterialModifier(
				industry,
				TITANIUM_CARBIDE,
				facility({ structureTypeId: TEST_REACTION_STRUCTURE, band: 'nullsec' }),
				fallback,
				DEFAULT_CONSTANTS
			)
		).toBe(refinery.multiplier);
	});
});
