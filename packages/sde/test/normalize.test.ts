import { DEFAULT_CONSTANTS } from '@reactions/engine';
import { describe, expect, it } from 'vitest';
import {
	SDE_FILES,
	normalize,
	readIndustrySources,
	securityBand,
	slugify,
	type RawBlueprint,
	type RawSde,
	type RawType,
	type RawTypeDogma
} from '../src/index.ts';

/** A real raw moon material (Hydrocarbons, R4), so the fixtures raise no UNCLASSIFIED_MOON_MATERIAL warning. */
const MOON_GOO = 16633;

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
		materials: [{ typeId: MOON_GOO, quantity: 100 }],
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
		manufacturing: [],
		types: [
			type(MOON_GOO, 'Moon Goo', 427),
			type(500, 'Thing Reaction Formula', 1888),
			type(600, 'Thing', 428)
		],
		groups: [
			{ groupId: 427, name: 'Moon Materials', categoryId: 4 },
			{ groupId: 428, name: 'Intermediate Materials', categoryId: 4 },
			{ groupId: 1888, name: 'Composite Reaction Formulas', categoryId: 9 }
		],
		typeMaterials: [],
		typeDogma: [],
		dogmaAttributes: ATTRIBUTES,
		dogmaEffects: [],
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
				materials: [{ typeId: MOON_GOO, quantity: 100 }]
			}
		]);
		expect(sde.types.map((t) => t.typeId)).toEqual([500, 600, MOON_GOO]);
		expect(sde.types[0]).toEqual({
			typeId: 500,
			name: 'Thing Reaction Formula',
			volume: 1,
			portionSize: 1,
			groupId: 1888,
			categoryId: 9,
			published: true,
			basePrice: null
		});
		expect(Object.keys(sde.dataset.types).map(Number)).toEqual([500, 600, MOON_GOO]);
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
					type(MOON_GOO, 'Moon Goo', 427),
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
					type(MOON_GOO, 'Moon Goo', 427),
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
					{ typeId: 600, materials: [{ materialTypeId: MOON_GOO, quantity: 5 }], randomizedMaterials: [] },
					{
						typeId: 601,
						materials: [{ materialTypeId: MOON_GOO, quantity: 36 }],
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
					{ typeId: MOON_GOO, quantity: 36, quantityMin: null, quantityMax: null },
					{ typeId: 34, quantity: null, quantityMin: 10, quantityMax: 20 }
				]
			}
		});
		expect(sde.types.map((t) => t.typeId)).toContain(34);
	});

	it('warns when an unrefined product has no reprocess data', () => {
		const sde = normalize(
			raw({
				types: [type(MOON_GOO, 'Moon Goo', 427), type(500, 'F', 1888), type(600, 'Unrefined Thing', 428)]
			})
		);
		expect(sde.dataset.reprocess).toEqual({});
		expect(sde.warnings).toContain('MISSING_REPROCESS:600');
	});

	it('warns about a tracked moon material without a class', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(500, 600, { materials: [{ typeId: 1, quantity: 100 }] })],
				types: [type(1, 'New Goo', 427), type(500, 'Thing Reaction Formula', 1888), type(600, 'Thing', 428)]
			})
		);
		expect(sde.dataset.reactions.map((r) => r.blueprintTypeId)).toEqual([500]);
		expect(sde.warnings.filter((w) => !w.startsWith('MISSING_CONSTANT'))).toEqual([
			'UNCLASSIFIED_MOON_MATERIAL:1'
		]);
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
		const dogma = (typeId: number, pairs: [number, number][]) => ({
			typeId,
			attributes: attrs(pairs),
			effectIds: []
		});
		const sde = normalize(
			raw({
				typeDogma: [
					dogma(45746, [[1, -5]]),
					dogma(35835, [[2, 0.9]]),
					dogma(35836, [[2, 0.7]]),
					dogma(46496, [
						[3, -3],
						[4, -25]
					]),
					dogma(46497, [
						[3, -4],
						[4, -30],
						[5, 1.2],
						[6, 1.5]
					])
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

	it('keeps published manufacturing blueprints taking a reaction product, with only those materials', () => {
		const sde = normalize(
			raw({
				blueprints: [blueprint(500, 600), blueprint(450, 601)],
				manufacturing: [
					{
						blueprintTypeId: 702,
						materials: [
							{ typeId: 34, quantity: 500 },
							{ typeId: 600, quantity: 12 }
						],
						products: [{ typeId: 802, quantity: 10 }]
					},
					{
						blueprintTypeId: 701,
						materials: [{ typeId: 600, quantity: 3 }],
						products: [{ typeId: 801, quantity: 1 }]
					},
					// No reaction product; only a product of an unpublished formula.
					{ blueprintTypeId: 703, materials: [{ typeId: 34, quantity: 1 }], products: [] },
					{ blueprintTypeId: 704, materials: [{ typeId: 601, quantity: 1 }], products: [] },
					// Unpublished blueprint, missing blueprint type, no product.
					{ blueprintTypeId: 705, materials: [{ typeId: 600, quantity: 1 }], products: [] },
					{ blueprintTypeId: 706, materials: [{ typeId: 600, quantity: 1 }], products: [] },
					{ blueprintTypeId: 707, materials: [{ typeId: 600, quantity: 1 }], products: [] }
				],
				types: [
					...raw().types,
					type(450, 'Test Reaction Blueprint', 1888, { published: false }),
					type(601, 'Test Thing', 428),
					type(701, 'A Blueprint', 100),
					type(702, 'B Blueprint', 100),
					type(801, 'A Ship', 25),
					type(705, 'Old Blueprint', 100, { published: false }),
					type(707, 'C Blueprint', 100)
				]
			})
		);
		// Names come along (the product name falls back to "Type <id>" when the type is unknown).
		expect(sde.dataset.manufacturing).toEqual([
			{
				blueprintTypeId: 701,
				name: 'A Blueprint',
				productTypeId: 801,
				productName: 'A Ship',
				productQuantity: 1,
				materials: [{ typeId: 600, quantity: 3 }]
			},
			{
				blueprintTypeId: 702,
				name: 'B Blueprint',
				productTypeId: 802,
				productName: 'Type 802',
				productQuantity: 10,
				materials: [{ typeId: 600, quantity: 12 }]
			}
		]);
		expect(sde.warnings.filter((w) => /:70\d$/.test(w))).toEqual(['MISSING_TYPE:706', 'NO_PRODUCT:707']);
		// Blueprint and product types are not added to the type tables.
		expect(sde.types.map((t) => t.typeId)).toEqual([500, 600, MOON_GOO]);
	});

	it('keeps published blueprints making a reaction material with every material, and tracks their types', () => {
		const sde = normalize(
			raw({
				manufacturing: [
					// Makes Moon Goo (a reaction material) from an ice product and a reaction product.
					{
						blueprintTypeId: 710,
						materials: [
							{ typeId: 901, quantity: 450 },
							{ typeId: 600, quantity: 2 }
						],
						products: [{ typeId: MOON_GOO, quantity: 40 }]
					},
					// Unpublished.
					{
						blueprintTypeId: 711,
						materials: [{ typeId: 902, quantity: 1 }],
						products: [{ typeId: MOON_GOO, quantity: 40 }]
					}
				],
				types: [
					...raw().types,
					type(710, 'Goo Blueprint', 100),
					type(711, 'Old Goo Blueprint', 100, { published: false }),
					type(901, 'Isotopes', 423),
					type(902, 'Water', 423)
				],
				groups: [
					...raw().groups,
					{ groupId: 423, name: 'Ice Product', categoryId: 4 },
					{ groupId: 100, name: 'Blueprints', categoryId: 9 }
				]
			})
		);
		expect(sde.dataset.manufacturing).toEqual([
			{
				blueprintTypeId: 710,
				name: 'Goo Blueprint',
				productTypeId: MOON_GOO,
				productName: 'Moon Goo',
				productQuantity: 40,
				makes: 'material',
				materials: [
					{ typeId: 901, quantity: 450 },
					{ typeId: 600, quantity: 2 }
				]
			}
		]);
		expect(sde.types.map((t) => t.typeId)).toEqual([500, 600, 710, 901, MOON_GOO]);
		expect(sde.dataset.types[901]).toMatchObject({ name: 'Isotopes', groupId: 423 });
		expect(sde.warnings.filter((w) => !w.startsWith('MISSING_CONSTANT'))).toEqual([]);
	});

	it('lists published blueprints consuming tracked materials other than reaction products, outside the dataset', () => {
		const sde = normalize(
			raw({
				manufacturing: [
					// Moon Goo (tracked, not a reaction product) and Thing (a reaction product) and an untracked type.
					{
						blueprintTypeId: 721,
						materials: [
							{ typeId: 34, quantity: 1000 },
							{ typeId: 600, quantity: 5 },
							{ typeId: MOON_GOO, quantity: 20 }
						],
						products: [{ typeId: 821, quantity: 1 }]
					},
					// Isotopes, tracked as a material of the Goo blueprint below.
					{
						blueprintTypeId: 720,
						materials: [{ typeId: 901, quantity: 7 }],
						products: [{ typeId: 820, quantity: 100 }]
					},
					// Makes Moon Goo: a fuel block-like blueprint, kept in the dataset only.
					{
						blueprintTypeId: 710,
						materials: [{ typeId: 901, quantity: 450 }],
						products: [{ typeId: MOON_GOO, quantity: 40 }]
					},
					// Only a reaction product or untracked types; unpublished; no product.
					{
						blueprintTypeId: 722,
						materials: [{ typeId: 600, quantity: 1 }],
						products: [{ typeId: 822, quantity: 1 }]
					},
					{
						blueprintTypeId: 723,
						materials: [{ typeId: 34, quantity: 1 }],
						products: [{ typeId: 823, quantity: 1 }]
					},
					{
						blueprintTypeId: 724,
						materials: [{ typeId: MOON_GOO, quantity: 1 }],
						products: [{ typeId: 824, quantity: 1 }]
					},
					{ blueprintTypeId: 725, materials: [{ typeId: MOON_GOO, quantity: 1 }], products: [] }
				],
				types: [
					...raw().types,
					type(710, 'Goo Blueprint', 100),
					type(720, 'Charge Blueprint', 100),
					type(721, 'Frigate Blueprint', 100),
					type(722, 'Thing Part Blueprint', 100),
					type(723, 'Plate Blueprint', 100),
					type(724, 'Old Blueprint', 100, { published: false }),
					type(725, 'Empty Blueprint', 100),
					type(820, 'Charge', 83),
					type(901, 'Isotopes', 423)
				],
				groups: [
					...raw().groups,
					{ groupId: 423, name: 'Ice Product', categoryId: 4 },
					{ groupId: 100, name: 'Blueprints', categoryId: 9 },
					{ groupId: 83, name: 'Projectile Ammo', categoryId: 8 }
				]
			})
		);
		// Only those materials; the product name falls back to "Type <id>" when the type is unknown.
		expect(sde.manufacturingBlueprints).toEqual([
			{
				blueprintTypeId: 720,
				name: 'Charge Blueprint',
				productTypeId: 820,
				productName: 'Charge',
				productFilters: [],
				materials: [{ typeId: 901, quantity: 7 }]
			},
			{
				blueprintTypeId: 721,
				name: 'Frigate Blueprint',
				productTypeId: 821,
				productName: 'Type 821',
				productFilters: [],
				materials: [{ typeId: MOON_GOO, quantity: 20 }]
			}
		]);
		// Blueprint 721 takes a reaction product, so the dataset keeps it for that one; nothing else is added.
		expect(sde.dataset.manufacturing?.map((b) => b.blueprintTypeId)).toEqual([710, 721, 722]);
		expect(sde.types.map((t) => t.typeId)).toEqual([500, 600, 710, 901, MOON_GOO]);
	});

	it('throws without SDE metadata', () => {
		expect(() => normalize(raw({ build: null }))).toThrow(/_sde\.jsonl/);
	});
});

describe('readIndustrySources', () => {
	it('keeps the manufacturing and reaction material sources of every type listed for them', () => {
		const sources = readIndustrySources(
			{
				'35825': {
					research_time: { material: [], cost: [{ dogmaAttributeID: 2601 }], time: [] },
					manufacturing: { material: [{ dogmaAttributeID: 2600 }], cost: [], time: [] }
				},
				'35836': { reaction: { material: [], cost: [], time: [{ dogmaAttributeID: 2721 }] } },
				'43722': { invention: { material: [], cost: [], time: [{ dogmaAttributeID: 2564 }] } }
			},
			{
				'18': { name: 'Composite Reactions', categoryIDs: [], groupIDs: [4932, 428, 429] },
				'4': { name: 'Charges', categoryIDs: [8], groupIDs: [] }
			}
		);
		expect([...sources.modifierSources]).toEqual([
			[35825, { manufacturing: [{ dogmaAttributeId: 2600, filterId: null }] }],
			[35836, { reaction: [] }]
		]);
		expect(sources.filters).toEqual([
			{ filterId: 4, name: 'Charges', categoryIds: [8], groupIds: [] },
			{ filterId: 18, name: 'Composite Reactions', categoryIds: [], groupIds: [428, 429, 4932] }
		]);
	});

	it('throws on files without the expected shape', () => {
		const filters = { '4': { name: 'Charges', categoryIDs: [8], groupIDs: [] } };
		expect(() => readIndustrySources([], filters)).toThrow(/industrymodifiersources/);
		expect(() =>
			readIndustrySources({ '1': { manufacturing: { material: [{ filterID: 14 }] } } }, filters)
		).toThrow(/industrymodifiersources/);
		expect(() => readIndustrySources({ x: {} }, filters)).toThrow(/industrymodifiersources/);
		expect(() => readIndustrySources({}, { '4': { name: 'Charges', categoryIDs: ['8'] } })).toThrow(
			/industrytargetfilters/
		);
	});
});

describe('normalize with industry sources', () => {
	const dogma = (
		typeId: number,
		attributes: Record<number, number>,
		effectIds: number[] = []
	): RawTypeDogma => ({
		typeId,
		attributes: Object.entries(attributes).map(([attributeId, value]) => ({
			attributeId: Number(attributeId),
			value
		})),
		effectIds
	});
	const percent = (effectId: number, modifiedAttributeId: number, modifyingAttributeId: number) => ({
		effectId,
		structureModifiers: [{ modifiedAttributeId, modifyingAttributeId, operation: 6 }]
	});
	const sources = readIndustrySources(
		{
			'35825': { manufacturing: { material: [{ dogmaAttributeID: 2600 }], cost: [], time: [] } },
			'35836': { reaction: { material: [], cost: [], time: [{ dogmaAttributeID: 2721 }] } },
			'37175': {
				manufacturing: {
					material: [
						{ dogmaAttributeID: 2557, filterID: 14 },
						{ dogmaAttributeID: 2658, filterID: 15 }
					]
				}
			},
			'46497': {
				reaction: {
					material: [
						{ dogmaAttributeID: 2716, filterID: 16 },
						{ dogmaAttributeID: 2718, filterID: 18 },
						{ dogmaAttributeID: 2720, filterID: 17 }
					]
				}
			},
			'90001': { manufacturing: { material: [{ dogmaAttributeID: 2557, filterID: 14 }] } },
			'90002': { manufacturing: { material: [{ dogmaAttributeID: 2557, filterID: 14 }] } },
			'90003': { manufacturing: { material: [{ dogmaAttributeID: 2557, filterID: 14 }] } }
		},
		{
			'14': { name: 'Components', categoryIDs: [], groupIDs: [334] },
			'15': { name: 'Advanced Capital Components', categoryIDs: [], groupIDs: [913] },
			'16': { name: 'Hybrid Reactions', categoryIDs: [], groupIDs: [974] },
			'17': { name: 'Biochemical Reactions', categoryIDs: [], groupIDs: [712] },
			'18': { name: 'Composite Reactions', categoryIDs: [], groupIDs: [428, 429] },
			'20': { name: 'Commodities', categoryIDs: [17], groupIDs: [] }
		}
	);
	const industryRaw = () =>
		raw({
			manufacturing: [
				{
					blueprintTypeId: 701,
					materials: [{ typeId: 600, quantity: 3 }],
					products: [{ typeId: 801, quantity: 1 }]
				}
			],
			types: [
				...raw().types,
				type(701, 'Thruster Blueprint', 100),
				type(801, 'Thruster', 334),
				type(35825, 'Raitaru', 1404),
				type(35832, 'Astrahus', 1657),
				type(35835, 'Athanor', 1406),
				type(35836, 'Tatara', 1406),
				type(37175, 'L-Set Component Rig', 1860),
				type(46497, 'L-Set Reactor Rig', 1939),
				type(90001, 'Multiplier Rig', 1860),
				type(90002, 'Broken Rig', 1860),
				type(90003, 'Unpublished Rig', 1860, { published: false })
			],
			groups: [
				...raw().groups,
				{ groupId: 334, name: 'Construction Components', categoryId: 17 },
				{ groupId: 1404, name: 'Engineering Complex', categoryId: 65 },
				{ groupId: 1406, name: 'Refinery', categoryId: 65 },
				{ groupId: 1657, name: 'Citadel', categoryId: 65 },
				{ groupId: 1860, name: 'Engineering Rig L', categoryId: 66 },
				{ groupId: 1939, name: 'Reactor Rig L', categoryId: 66 }
			],
			typeDogma: [
				dogma(35825, { 1547: 2, 1154: 3, 2600: 0.99 }),
				dogma(35832, { 1547: 2, 1154: 3 }),
				dogma(35835, { 1547: 2, 1154: 3 }),
				dogma(35836, { 1547: 3, 1154: 3 }),
				dogma(
					37175,
					{ 1547: 3, 1298: 1406, 1299: 1404, 2355: 1, 2356: 1.9, 2357: 2.1, 2594: -2.4 },
					[6824, 6888]
				),
				dogma(46497, { 1547: 3, 1300: 1406, 2356: 1, 2357: 1.1, 2714: -2.4 }, [6970, 6973, 6975]),
				dogma(90001, { 1547: 2, 1298: 1404, 3000: 0.98 }, [90]),
				dogma(90002, { 1547: 2, 1298: 1404 }),
				dogma(90003, { 1547: 2, 1298: 1404, 2594: -2 }, [6824])
			],
			dogmaAttributes: [
				...ATTRIBUTES,
				{ attributeId: 1298, name: 'canFitShipGroup01' },
				{ attributeId: 1299, name: 'canFitShipGroup02' },
				{ attributeId: 1300, name: 'canFitShipGroup03' }
			],
			dogmaEffects: [
				percent(6824, 2557, 2594),
				percent(6888, 2658, 2594),
				percent(6970, 2716, 2714),
				percent(6973, 2718, 2714),
				percent(6975, 2720, 2714),
				{
					effectId: 90,
					structureModifiers: [{ modifiedAttributeId: 2557, modifyingAttributeId: 3000, operation: 4 }]
				}
			]
		});

	it('derives rig bonuses from their effects, with security multipliers and fitted groups', () => {
		const { industry } = normalize(industryRaw(), sources).dataset;
		expect(industry?.filters.map((f) => f.filterId)).toEqual([14, 15, 16, 17, 18, 20]);
		expect(industry?.rigs).toEqual([
			{
				typeId: 37175,
				name: 'L-Set Component Rig',
				rigSize: 3,
				groupId: 1860,
				fitsGroupIds: [1404, 1406],
				bonuses: [
					{ activity: 'manufacturing', material: 0.024, filterId: 14 },
					{ activity: 'manufacturing', material: 0.024, filterId: 15 }
				],
				security: { highsec: 1, lowsec: 1.9, nullsec: 2.1, wormhole: 2.1 }
			},
			{
				typeId: 46497,
				name: 'L-Set Reactor Rig',
				rigSize: 3,
				groupId: 1939,
				fitsGroupIds: [1406],
				bonuses: [
					{ activity: 'reaction', material: 0.024, filterId: 16 },
					{ activity: 'reaction', material: 0.024, filterId: 17 },
					{ activity: 'reaction', material: 0.024, filterId: 18 }
				],
				// No highsec modifier: the dogma default 1.
				security: { highsec: 1, lowsec: 1, nullsec: 1.1, wormhole: 1.1 }
			},
			{
				typeId: 90001,
				name: 'Multiplier Rig',
				rigSize: 2,
				groupId: 1860,
				fitsGroupIds: [1404],
				bonuses: [{ activity: 'manufacturing', material: 0.02, filterId: 14 }],
				security: { highsec: 1, lowsec: 1, nullsec: 1, wormhole: 1 }
			}
		]);
	});

	it('keeps structures with a bonus, listed for an activity or of a group a rig fits', () => {
		const { industry } = normalize(industryRaw(), sources).dataset;
		// The Astrahus (Citadel) is left out: no rig of the data fits citadels.
		expect(industry?.structures).toEqual([
			{
				typeId: 35825,
				name: 'Raitaru',
				groupId: 1404,
				rigSize: 2,
				rigSlots: 3,
				material: { manufacturing: 0.01 }
			},
			{ typeId: 35835, name: 'Athanor', groupId: 1406, rigSize: 2, rigSlots: 3, material: {} },
			{ typeId: 35836, name: 'Tatara', groupId: 1406, rigSize: 3, rigSlots: 3, material: {} }
		]);
	});

	it('maps reaction and manufacturing products to the filters of their group or category', () => {
		const { industry } = normalize(industryRaw(), sources).dataset;
		expect(industry?.productFilters).toEqual({ 600: [18], 801: [14, 20] });
	});

	it('gives consuming blueprints the filters of their product, outside the dataset filters', () => {
		const base = industryRaw();
		const sde = normalize(
			{
				...base,
				manufacturing: [
					...base.manufacturing,
					{
						blueprintTypeId: 730,
						materials: [{ typeId: MOON_GOO, quantity: 4 }],
						products: [{ typeId: 830, quantity: 1 }]
					}
				],
				types: [...base.types, type(730, 'Plate Blueprint', 100), type(830, 'Plate', 334)]
			},
			sources
		);
		expect(sde.manufacturingBlueprints).toMatchObject([{ blueprintTypeId: 730, productFilters: [14, 20] }]);
		expect(sde.dataset.industry?.productFilters).toEqual({ 600: [18], 801: [14, 20] });
	});

	it('warns about bonuses it cannot derive and skips unpublished types silently', () => {
		const sde = normalize(industryRaw(), sources);
		expect(sde.warnings.filter((w) => !w.startsWith('MISSING_CONSTANT'))).toEqual([
			'UNDERIVED_INDUSTRY_BONUS:90002:manufacturing:2557'
		]);
		expect(sde.dataset.industry?.rigs.some((r) => r.typeId === 90003)).toBe(false);
	});

	it('has no industry data without the sources', () => {
		expect(normalize(industryRaw()).dataset).not.toHaveProperty('industry');
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
