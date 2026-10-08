import { DEFAULT_CONSTANTS } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import {
	SDE_FILES,
	normalize,
	securityBand,
	slugify,
	type RawBlueprint,
	type RawSde,
	type RawType
} from '../src/index.ts';

function type(typeId: number, name: string, groupId: number, extra: Partial<RawType> = {}): RawType {
	return { typeId, name, groupId, volume: 1, portionSize: 1, published: true, basePrice: null, ...extra };
}

function blueprint(
	blueprintTypeId: number,
	productTypeId: number,
	extra: Partial<RawBlueprint> = {}
): RawBlueprint {
	return {
		blueprintTypeId,
		maxProductionLimit: 1000,
		time: 10800,
		materials: [{ typeId: 1, quantity: 100 }],
		products: [{ typeId: productTypeId, quantity: 200 }],
		skills: [{ typeId: 45746, level: 2 }],
		...extra
	};
}

/** Attribute ids used by the dogma fixtures below. */
const ATTRIBUTES = [
	{ attributeId: 1, name: 'reactionTimeBonus' },
	{ attributeId: 2, name: 'strReactionTimeMultiplier' },
	{ attributeId: 3, name: 'RefRigMatBonus' },
	{ attributeId: 4, name: 'RefRigTimeBonus' },
	{ attributeId: 5, name: 'lowSecModifier' },
	{ attributeId: 6, name: 'nullSecModifier' }
];

function raw(overrides: Partial<RawSde> = {}): RawSde {
	return {
		build: 42,
		releaseDate: '2026-01-01T00:00:00Z',
		blueprints: [blueprint(500, 600)],
		types: [type(1, 'Moon Goo', 427), type(500, 'Thing Reaction Formula', 1888), type(600, 'Thing', 428)],
		groups: [
			{ groupId: 427, name: 'Moon Materials', categoryId: 4 },
			{ groupId: 428, name: 'Intermediate Materials', categoryId: 4 },
			{ groupId: 1888, name: 'Composite Reaction Formulas', categoryId: 9 }
		],
		typeMaterials: [],
		typeDogma: [],
		dogmaAttributes: ATTRIBUTES,
		systems: [],
		regions: [],
		files: [...SDE_FILES],
		...overrides
	};
}

describe('normalize', () => {
	it('maps a formula to a reaction and restricts types to tracked ids', () => {
		const sde = normalize(
			raw({ types: [...raw().types, type(999, 'Untracked', 427)], typeDogma: [], dogmaAttributes: [] })
		);
		expect(sde.dataset.reactions).toEqual([
			{
				blueprintTypeId: 500,
				slug: 'thing',
				name: 'Thing',
				formulaName: 'Thing Reaction Formula',
				reactor: 'composite',
				tier: 'intermediate',
				baseTimeSeconds: 10800,
				maxRuns: 1000,
				requiredSkillLevel: 2,
				product: { typeId: 600, quantity: 200 },
				materials: [{ typeId: 1, quantity: 100 }]
			}
		]);
		expect(sde.types.map((t) => t.typeId)).toEqual([1, 500, 600]);
		expect(sde.types[1]).toEqual({
			typeId: 500,
			name: 'Thing Reaction Formula',
			volume: 1,
			portionSize: 1,
			groupId: 1888,
			categoryId: 9,
			published: true,
			basePrice: null
		});
		expect(Object.keys(sde.dataset.types).map(Number)).toEqual([1, 500, 600]);
		expect(sde.dataset.sdeBuild).toBe(42);
	});

	it('skips formulas of unknown groups with a warning', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(500, 600), blueprint(501, 601)],
				types: [...raw().types, type(501, 'Odd Reaction Formula', 9999), type(601, 'Odd', 428)]
			})
		);
		expect(sde.dataset.reactions.map((r) => r.blueprintTypeId)).toEqual([500]);
		expect(sde.warnings).toContain('UNKNOWN_FORMULA_GROUP:9999');
		expect(sde.types.some((t) => t.typeId === 501 || t.typeId === 601)).toBe(false);
	});

	it('drops unpublished formulas silently', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(500, 600), blueprint(450, 601)],
				types: [
					...raw().types,
					type(450, 'Test Reaction Blueprint', 1888, { published: false }),
					type(601, 'X', 428)
				]
			})
		);
		expect(sde.dataset.reactions.map((r) => r.blueprintTypeId)).toEqual([500]);
		expect(sde.warnings.filter((w) => !w.startsWith('MISSING_CONSTANT'))).toEqual([]);
	});

	it('suffixes colliding slugs with the blueprint type id, sorted by blueprint id', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(502, 602), blueprint(501, 601)],
				types: [
					type(1, 'Moon Goo', 427),
					type(501, 'A Formula', 1888),
					type(502, 'B Formula', 1888),
					type(601, 'Foo Bar', 428),
					type(602, 'Foo-Bar!', 428)
				]
			})
		);
		expect(sde.dataset.reactions.map((r) => [r.blueprintTypeId, r.slug])).toEqual([
			[501, 'foo-bar'],
			[502, 'foo-bar-502']
		]);
	});

	it('assigns reactors and tiers per formula and product group', () => {
		const cases: [number, string, number, string, string][] = [
			[1888, 'Composite Thing', 429, 'composite', 'composite'],
			[1888, 'Unrefined Thing', 428, 'composite', 'unrefined'],
			[1888, 'Rock', 4932, 'composite', 'unrefined_mineral'],
			[1888, 'Mystery', 1, 'composite', 'other'],
			[1889, 'C3-FTM Acid', 974, 'hybrid', 'polymer'],
			[1890, 'Pure Synth Mindflood Booster', 712, 'biochemical', 'booster_synth'],
			[1890, 'Pure Standard Mindflood Booster', 712, 'biochemical', 'booster_standard'],
			[1890, 'Pure Improved Mindflood Booster', 712, 'biochemical', 'booster_improved'],
			[1890, 'Pure Strong Mindflood Booster', 712, 'biochemical', 'booster_strong'],
			[1890, 'Gas Thing', 712, 'biochemical', 'other'],
			[4097, 'Forged Thing', 4096, 'biochemical', 'molecular_forged']
		];
		const sde = normalize(
			raw({
				blueprints: cases.map((_, i) => blueprint(1000 + i, 2000 + i)),
				types: [
					type(1, 'Moon Goo', 427),
					...cases.flatMap(([formulaGroup, name, productGroup], i) => [
						type(1000 + i, `${name} Reaction Formula`, formulaGroup),
						type(2000 + i, name, productGroup)
					])
				]
			})
		);
		expect(sde.dataset.reactions.map((r) => [r.name, r.reactor, r.tier])).toEqual(
			cases.map(([, name, , reactor, tier]) => [name, reactor, tier])
		);
		expect(sde.warnings).toContain('UNKNOWN_TIER:1003');
		expect(sde.warnings).toContain('UNKNOWN_TIER:1009');
	});

	it('defaults the required skill level to 1', () => {
		const sde = normalize(raw({ blueprints: [blueprint(500, 600, { skills: [] })] }));
		expect(sde.dataset.reactions[0].requiredSkillLevel).toBe(1);
	});

	it('builds reprocess entries for unrefined products only and tracks their outputs', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(500, 600), blueprint(501, 601)],
				types: [
					...raw().types,
					type(501, 'Unrefined Formula', 1888),
					type(601, 'Unrefined Thing', 428),
					type(34, 'Tritanium', 18)
				],
				typeMaterials: [
					{ typeId: 600, materials: [{ materialTypeId: 1, quantity: 5 }], randomizedMaterials: [] },
					{
						typeId: 601,
						materials: [{ materialTypeId: 1, quantity: 36 }],
						randomizedMaterials: [{ materialTypeId: 34, quantityMin: 10, quantityMax: 20 }]
					}
				]
			})
		);
		expect(sde.dataset.reprocess).toEqual({
			601: {
				typeId: 601,
				portionSize: 1,
				materials: [
					{ typeId: 1, quantity: 36, quantityMin: null, quantityMax: null },
					{ typeId: 34, quantity: null, quantityMin: 10, quantityMax: 20 }
				]
			}
		});
		expect(sde.types.map((t) => t.typeId)).toContain(34);
	});

	it('warns when an unrefined product has no reprocess data', () => {
		const sde = normalize(
			raw({ types: [type(1, 'Moon Goo', 427), type(500, 'F', 1888), type(600, 'Unrefined Thing', 428)] })
		);
		expect(sde.dataset.reprocess).toEqual({});
		expect(sde.warnings).toContain('MISSING_REPROCESS:600');
	});

	it('falls back to DEFAULT_CONSTANTS with a warning per missing dogma value', () => {
		const sde = normalize(raw());
		expect(sde.dataset.constants).toEqual(DEFAULT_CONSTANTS);
		expect(sde.warnings).toEqual([
			'MISSING_CONSTANT:nullSecModifier@46497',
			'MISSING_CONSTANT:reactionTimeBonus@45746',
			'MISSING_CONSTANT:strReactionTimeMultiplier@35836',
			'MISSING_CONSTANT:RefRigMatBonus@46496',
			'MISSING_CONSTANT:RefRigTimeBonus@46496',
			'MISSING_CONSTANT:RefRigMatBonus@46497',
			'MISSING_CONSTANT:RefRigTimeBonus@46497',
			'MISSING_CONSTANT:lowSecModifier@46497'
		]);
	});

	it('reads constants from dogma', () => {
		const attrs = (pairs: [number, number][]) =>
			pairs.map(([attributeId, value]) => ({ attributeId, value }));
		const sde = normalize(
			raw({
				typeDogma: [
					{ typeId: 45746, attributes: attrs([[1, -5]]) },
					{ typeId: 35835, attributes: attrs([[2, 0.9]]) },
					{ typeId: 35836, attributes: attrs([[2, 0.7]]) },
					{
						typeId: 46496,
						attributes: attrs([
							[3, -3],
							[4, -25]
						])
					},
					{
						typeId: 46497,
						attributes: attrs([
							[3, -4],
							[4, -30],
							[5, 1.2],
							[6, 1.5]
						])
					}
				]
			})
		);
		expect(sde.dataset.constants).toEqual({
			skillTimeBonusPerLevel: 0.05,
			structureTimeMultiplier: { athanor: 0.9, tatara: 0.7 },
			rig: { none: { me: 0, te: 0 }, t1: { me: 0.03, te: 0.25 }, t2: { me: 0.04, te: 0.3 } },
			securityModifier: { lowsec: 1.2, nullsec: 1.5, wormhole: 1.5 }
		});
		expect(sde.warnings).toEqual([]);
	});

	it('keeps known-space systems with security bands and their regions', () => {
		const sde = normalize(
			raw({
				systems: [
					{ systemId: 3, name: 'Low', regionId: 10000001, constellationId: 1, securityStatus: 0.4 },
					{ systemId: 1, name: 'High', regionId: 10000001, constellationId: 1, securityStatus: 0.45 },
					{ systemId: 2, name: 'Null', regionId: 10000001, constellationId: 1, securityStatus: 0 },
					{ systemId: 4, name: 'J1', regionId: 11000001, constellationId: 2, securityStatus: -0.99 },
					{ systemId: 5, name: 'Abyss', regionId: 12000000, constellationId: 3, securityStatus: -1 }
				],
				regions: [
					{ regionId: 12000000, name: 'Abyssal' },
					{ regionId: 10000001, name: 'Derelik' }
				]
			})
		);
		expect(sde.systems.map((s) => [s.systemId, s.securityBand])).toEqual([
			[1, 'highsec'],
			[2, 'nullsec'],
			[3, 'lowsec'],
			[4, 'wormhole']
		]);
		expect(sde.regions).toEqual([{ regionId: 10000001, name: 'Derelik' }]);
	});

	it('warns about wanted files missing from the archive', () => {
		const sde = normalize(raw({ files: SDE_FILES.filter((f) => f !== 'mapSolarSystems.jsonl') }));
		expect(sde.warnings).toContain('MISSING_FILE:mapSolarSystems.jsonl');
	});

	it('throws without SDE metadata', () => {
		expect(() => normalize(raw({ build: null }))).toThrow(/_sde\.jsonl/);
	});
});

describe('slugify', () => {
	it('lowercases and collapses non-alphanumerics', () => {
		expect(slugify('Caesarium Cadmide')).toBe('caesarium-cadmide');
		expect(slugify('C3-FTM Acid')).toBe('c3-ftm-acid');
		expect(slugify("  Pure Strong 'X' Booster!  ")).toBe('pure-strong-x-booster');
	});
});

describe('securityBand', () => {
	it('classifies by region and security status', () => {
		expect(securityBand(11000033, -0.99)).toBe('wormhole');
		expect(securityBand(10000058, -0.015971)).toBe('nullsec');
		expect(securityBand(10000032, 0.438755)).toBe('lowsec');
		expect(securityBand(10000002, 0.945913)).toBe('highsec');
	});
});
