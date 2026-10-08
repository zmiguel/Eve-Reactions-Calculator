import { DEFAULT_CONSTANTS } from '@reactions/engine';
import type { Reaction, ReactionConstants, Reactor, ReprocessEntry, Tier, TypeInfo } from '@reactions/engine';
import {
	ATHANOR_TYPE_ID,
	L_SET_RIG_T1_TYPE_ID,
	L_SET_RIG_T2_TYPE_ID,
	MAX_REGION_ID_EXCLUSIVE,
	REACTIONS_SKILL_ID,
	SDE_FILES,
	TATARA_TYPE_ID,
	WORMHOLE_REGION_ID_MIN
} from './constants.ts';
import type {
	RawGroup,
	RawSde,
	RawType,
	SdeDataset,
	SdeSystem,
	SdeType,
	SystemSecurityBand
} from './types.ts';

/** Reaction formula group (blueprint type `groupID`) → reactor. Molecular-Forged uses the biochemical reactor. */
const REACTOR_BY_FORMULA_GROUP: Record<number, Reactor> = {
	1888: 'composite',
	1889: 'hybrid',
	1890: 'biochemical',
	4097: 'biochemical'
};

const BOOSTER_TIER_BY_PREFIX: [string, Tier][] = [
	['Pure Synth ', 'booster_synth'],
	['Pure Standard ', 'booster_standard'],
	['Pure Improved ', 'booster_improved'],
	['Pure Strong ', 'booster_strong']
];

function tierFor(formulaGroupId: number, product: RawType): Tier {
	switch (formulaGroupId) {
		case 1889:
			return 'polymer';
		case 4097:
			return 'molecular_forged';
		case 1888:
			if (product.groupId === 429) return 'composite';
			if (product.groupId === 4932) return 'unrefined_mineral';
			if (product.groupId === 428)
				return product.name.startsWith('Unrefined ') ? 'unrefined' : 'intermediate';
			return 'other';
		case 1890:
			return BOOSTER_TIER_BY_PREFIX.find(([prefix]) => product.name.startsWith(prefix))?.[1] ?? 'other';
		default:
			return 'other';
	}
}

/** Lowercase, runs of non `[a-z0-9]` collapsed to `-`, trimmed. */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function securityBand(regionId: number, securityStatus: number): SystemSecurityBand {
	if (regionId >= WORMHOLE_REGION_ID_MIN) return 'wormhole';
	if (securityStatus <= 0) return 'nullsec';
	if (securityStatus < 0.45) return 'lowsec';
	return 'highsec';
}

function readConstants(raw: RawSde, warnings: string[]): ReactionConstants {
	const attributeIds = new Map(raw.dogmaAttributes.map((a) => [a.name, a.attributeId]));
	const dogma = new Map(raw.typeDogma.map((d) => [d.typeId, d.attributes]));
	const lookup = (typeId: number, attribute: string): number | undefined => {
		const attributeId = attributeIds.get(attribute);
		return dogma.get(typeId)?.find((a) => a.attributeId === attributeId)?.value;
	};
	/** Dogma value (optionally converted to the engine unit), or the default plus a warning when absent. */
	const read = (
		typeId: number,
		attribute: string,
		fallback: number,
		toEngine?: (v: number) => number
	): number => {
		const value = lookup(typeId, attribute);
		if (value === undefined) {
			warnings.push(`MISSING_CONSTANT:${attribute}@${typeId}`);
			return fallback;
		}
		return toEngine ? toEngine(value) : value;
	};
	// Dogma bonuses are signed percentages (e.g. -2.4) → positive fractions (0.024).
	const bonus = (v: number) => -v / 100;
	const d = DEFAULT_CONSTANTS;
	const nullsec = read(L_SET_RIG_T2_TYPE_ID, 'nullSecModifier', d.securityModifier.nullsec);
	return {
		skillTimeBonusPerLevel: read(REACTIONS_SKILL_ID, 'reactionTimeBonus', d.skillTimeBonusPerLevel, bonus),
		structureTimeMultiplier: {
			// The Athanor has no reaction time attribute: no bonus.
			athanor: lookup(ATHANOR_TYPE_ID, 'strReactionTimeMultiplier') ?? 1,
			tatara: read(TATARA_TYPE_ID, 'strReactionTimeMultiplier', d.structureTimeMultiplier.tatara)
		},
		rig: {
			none: { me: 0, te: 0 },
			t1: {
				me: read(L_SET_RIG_T1_TYPE_ID, 'RefRigMatBonus', d.rig.t1.me, bonus),
				te: read(L_SET_RIG_T1_TYPE_ID, 'RefRigTimeBonus', d.rig.t1.te, bonus)
			},
			t2: {
				me: read(L_SET_RIG_T2_TYPE_ID, 'RefRigMatBonus', d.rig.t2.me, bonus),
				te: read(L_SET_RIG_T2_TYPE_ID, 'RefRigTimeBonus', d.rig.t2.te, bonus)
			}
		},
		securityModifier: {
			lowsec: read(L_SET_RIG_T2_TYPE_ID, 'lowSecModifier', d.securityModifier.lowsec),
			nullsec,
			// The SDE has no wormhole modifier; wormhole space uses the nullsec rig bonus.
			wormhole: nullsec
		}
	};
}

/** Turns the raw SDE projections into the engine dataset plus reference tables. */
export function normalize(raw: RawSde): SdeDataset {
	if (raw.build === null) throw new Error('SDE metadata (_sde.jsonl buildNumber) missing');
	const warnings: string[] = SDE_FILES.filter((file) => !raw.files.includes(file)).map(
		(file) => `MISSING_FILE:${file}`
	);
	const typesById = new Map(raw.types.map((t) => [t.typeId, t]));
	const groupsById = new Map<number, RawGroup>(raw.groups.map((g) => [g.groupId, g]));
	const typeMaterials = new Map(raw.typeMaterials.map((m) => [m.typeId, m]));

	const reactions: Reaction[] = [];
	const reprocess: Record<number, ReprocessEntry> = {};
	const usedSlugs = new Set<string>();
	const blueprints = [...raw.blueprints].sort((a, b) => a.blueprintTypeId - b.blueprintTypeId);
	for (const bp of blueprints) {
		const formula = typesById.get(bp.blueprintTypeId);
		if (!formula) {
			warnings.push(`MISSING_TYPE:${bp.blueprintTypeId}`);
			continue;
		}
		if (!formula.published) continue;
		const reactor = REACTOR_BY_FORMULA_GROUP[formula.groupId];
		if (!reactor) {
			warnings.push(`UNKNOWN_FORMULA_GROUP:${formula.groupId}`);
			continue;
		}
		const productMaterial = bp.products[0];
		const product = productMaterial && typesById.get(productMaterial.typeId);
		if (!product) {
			warnings.push(
				productMaterial ? `MISSING_TYPE:${productMaterial.typeId}` : `NO_PRODUCT:${bp.blueprintTypeId}`
			);
			continue;
		}
		const tier = tierFor(formula.groupId, product);
		if (tier === 'other') warnings.push(`UNKNOWN_TIER:${bp.blueprintTypeId}`);
		let slug = slugify(product.name);
		if (usedSlugs.has(slug)) slug = `${slug}-${bp.blueprintTypeId}`;
		usedSlugs.add(slug);
		reactions.push({
			blueprintTypeId: bp.blueprintTypeId,
			slug,
			name: product.name,
			formulaName: formula.name,
			reactor,
			tier,
			baseTimeSeconds: bp.time,
			maxRuns: bp.maxProductionLimit,
			requiredSkillLevel: bp.skills.find((s) => s.typeId === REACTIONS_SKILL_ID)?.level ?? 1,
			product: { typeId: productMaterial.typeId, quantity: productMaterial.quantity },
			materials: bp.materials.map((m) => ({ typeId: m.typeId, quantity: m.quantity }))
		});
		if (tier !== 'unrefined' && tier !== 'unrefined_mineral') continue;
		const yields = typeMaterials.get(product.typeId);
		if (!yields) {
			warnings.push(`MISSING_REPROCESS:${product.typeId}`);
			continue;
		}
		reprocess[product.typeId] = {
			typeId: product.typeId,
			portionSize: product.portionSize ?? 1,
			materials: [
				...yields.materials.map((m) => ({
					typeId: m.materialTypeId,
					quantity: m.quantity,
					quantityMin: null,
					quantityMax: null
				})),
				...yields.randomizedMaterials.map((m) => ({
					typeId: m.materialTypeId,
					quantity: null,
					quantityMin: m.quantityMin,
					quantityMax: m.quantityMax
				}))
			]
		};
	}

	const trackedIds = new Set<number>();
	for (const r of reactions) {
		trackedIds.add(r.blueprintTypeId);
		trackedIds.add(r.product.typeId);
		for (const m of r.materials) trackedIds.add(m.typeId);
	}
	for (const entry of Object.values(reprocess)) for (const m of entry.materials) trackedIds.add(m.typeId);

	const types: SdeType[] = [];
	const datasetTypes: Record<number, TypeInfo> = {};
	for (const typeId of [...trackedIds].sort((a, b) => a - b)) {
		const t = typesById.get(typeId);
		if (!t) {
			warnings.push(`MISSING_TYPE:${typeId}`);
			continue;
		}
		const group = groupsById.get(t.groupId);
		if (!group) warnings.push(`MISSING_GROUP:${t.groupId}`);
		const info: TypeInfo = {
			typeId,
			name: t.name,
			volume: t.volume ?? 0,
			portionSize: t.portionSize ?? 1,
			groupId: t.groupId
		};
		datasetTypes[typeId] = info;
		types.push({
			...info,
			categoryId: group?.categoryId ?? 0,
			published: t.published,
			basePrice: t.basePrice
		});
	}

	const systems: SdeSystem[] = raw.systems
		.filter((s) => s.regionId < MAX_REGION_ID_EXCLUSIVE)
		.sort((a, b) => a.systemId - b.systemId)
		.map((s) => ({
			systemId: s.systemId,
			name: s.name,
			regionId: s.regionId,
			securityStatus: s.securityStatus,
			securityBand: securityBand(s.regionId, s.securityStatus)
		}));
	const regions = raw.regions
		.filter((r) => r.regionId < MAX_REGION_ID_EXCLUSIVE)
		.sort((a, b) => a.regionId - b.regionId)
		.map((r) => ({ regionId: r.regionId, name: r.name }));

	return {
		build: raw.build,
		releaseDate: raw.releaseDate ?? '',
		dataset: {
			sdeBuild: raw.build,
			reactions,
			types: datasetTypes,
			reprocess,
			constants: readConstants(raw, warnings)
		},
		types,
		regions,
		systems,
		warnings: [...new Set(warnings)]
	};
}
