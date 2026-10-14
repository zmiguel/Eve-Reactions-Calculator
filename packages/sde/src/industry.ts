import type {
	IndustryActivity,
	IndustryBand,
	IndustryData,
	IndustryFilter,
	IndustryRig,
	IndustryStructure
} from '@reactions/engine';
import {
	CAN_FIT_SHIP_GROUP_ATTRIBUTE,
	DOGMA_OPERATION_POST_MUL,
	DOGMA_OPERATION_POST_PERCENT,
	HI_SEC_MODIFIER_ATTRIBUTE_ID,
	LOW_SEC_MODIFIER_ATTRIBUTE_ID,
	NULL_SEC_MODIFIER_ATTRIBUTE_ID,
	RIG_SIZE_ATTRIBUTE_ID,
	STRUCTURE_CATEGORY_ID,
	STRUCTURE_MODULE_CATEGORY_ID,
	UPGRADE_SLOTS_LEFT_ATTRIBUTE_ID
} from './constants.ts';
import type { IndustryModifierSource, IndustrySources, RawGroup, RawSde, RawType } from './types.ts';

/** Activities the industry data covers, in the order bonuses are listed. */
const ACTIVITIES: readonly IndustryActivity[] = ['manufacturing', 'reaction'];

/** Hoboleaks file names, for error messages. */
const MODIFIER_SOURCES_FILE = 'industrymodifiersources.json';
const TARGET_FILTERS_FILE = 'industrytargetfilters.json';

/** Entries of a JSON object; throws when `value` is not one. */
function objectEntries(value: unknown, where: string): [string, unknown][] {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new Error(`${where}: not a JSON object`);
	return Object.entries(value);
}

function isId(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

function idList(value: unknown, where: string): number[] {
	if (!Array.isArray(value) || !value.every(isId)) throw new Error(`${where}: not a list of ids`);
	return [...value].sort((a, b) => a - b);
}

function numericKey(key: string, where: string): number {
	if (!/^\d+$/.test(key)) throw new Error(`${where}: key ${key} is not an id`);
	return Number(key);
}

/**
 * Checks and reduces the two Hoboleaks files (`industrymodifiersources.json`,
 * `industrytargetfilters.json`, parsed JSON) to the manufacturing and reaction material bonus sources
 * and the target filters. Throws when a file does not have the expected shape.
 */
export function readIndustrySources(modifierSources: unknown, targetFilters: unknown): IndustrySources {
	const sources: IndustrySources['modifierSources'] = new Map();
	for (const [key, activities] of objectEntries(modifierSources, MODIFIER_SOURCES_FILE)) {
		const where = `${MODIFIER_SOURCES_FILE} ${key}`;
		const typeId = numericKey(key, MODIFIER_SOURCES_FILE);
		const byActivity = new Map(objectEntries(activities, where));
		const listed: Partial<Record<IndustryActivity, IndustryModifierSource[]>> = {};
		for (const activity of ACTIVITIES) {
			const entry = byActivity.get(activity);
			if (entry === undefined) continue;
			const material = new Map(objectEntries(entry, `${where}.${activity}`)).get('material') ?? [];
			if (!Array.isArray(material)) throw new Error(`${where}.${activity}.material: not a list`);
			listed[activity] = material.map((source: unknown) => {
				const fields = new Map(objectEntries(source, `${where}.${activity}.material`));
				const dogmaAttributeId = fields.get('dogmaAttributeID');
				const filterId = fields.get('filterID') ?? null;
				if (!isId(dogmaAttributeId) || (filterId !== null && !isId(filterId)))
					throw new Error(`${where}.${activity}.material: bad source`);
				return { dogmaAttributeId, filterId };
			});
		}
		if (Object.keys(listed).length > 0) sources.set(typeId, listed);
	}
	const filters: IndustryFilter[] = [];
	for (const [key, filter] of objectEntries(targetFilters, TARGET_FILTERS_FILE)) {
		const where = `${TARGET_FILTERS_FILE} ${key}`;
		const fields = new Map(objectEntries(filter, where));
		const name = fields.get('name');
		if (typeof name !== 'string') throw new Error(`${where}.name: not a string`);
		filters.push({
			filterId: numericKey(key, TARGET_FILTERS_FILE),
			name,
			categoryIds: idList(fields.get('categoryIDs'), `${where}.categoryIDs`),
			groupIds: idList(fields.get('groupIDs'), `${where}.groupIDs`)
		});
	}
	filters.sort((a, b) => a.filterId - b.filterId);
	return { modifierSources: sources, filters };
}

/** Removes the binary noise of `1 - 0.99` and `2.4 / 100` (dogma values have few decimals). */
function tidy(value: number): number {
	return Math.round(value * 1e10) / 1e10;
}

/**
 * Builds `Dataset.industry` from the SDE dogma and the game client industry data: every published rig
 * with a manufacturing or reaction material bonus, every published structure with such a bonus, listed
 * for those activities or of a group such a rig fits, and the filters of every product in `products`.
 * Bonuses whose value cannot be derived from dogma are skipped with a warning.
 */
export function buildIndustryData(
	raw: RawSde,
	sources: IndustrySources,
	products: Iterable<number>,
	warnings: string[]
): IndustryData {
	const typesById = new Map<number, RawType>(raw.types.map((t) => [t.typeId, t]));
	const groupsById = new Map<number, RawGroup>(raw.groups.map((g) => [g.groupId, g]));
	const dogma = new Map(
		raw.typeDogma.map((d) => [
			d.typeId,
			{ attributes: new Map(d.attributes.map((a) => [a.attributeId, a.value])), effectIds: d.effectIds }
		])
	);
	const effects = new Map(raw.dogmaEffects.map((e) => [e.effectId, e.structureModifiers]));
	const fitAttributeIds = raw.dogmaAttributes
		.filter((a) => CAN_FIT_SHIP_GROUP_ATTRIBUTE.test(a.name))
		.map((a) => a.attributeId);
	const categoryOf = (type: RawType) => groupsById.get(type.groupId)?.categoryId;
	const attribute = (typeId: number, attributeId: number) => dogma.get(typeId)?.attributes.get(attributeId);

	/**
	 * Material reduction (fraction) of `typeId` for a source naming structure attribute `attributeId`:
	 * the structure's own multiplier (Raitaru 0.99 → 0.01), or the value a rig's effect applies to it
	 * (`PostPercent` −2.4 → 0.024, `PostMul` 0.98 → 0.02). Null when it cannot be derived.
	 */
	const reduction = (typeId: number, attributeId: number): number | null => {
		const own = attribute(typeId, attributeId);
		if (own !== undefined) return tidy(1 - own);
		for (const effectId of dogma.get(typeId)?.effectIds ?? []) {
			const modifier = effects.get(effectId)?.find((m) => m.modifiedAttributeId === attributeId);
			if (!modifier) continue;
			const value = attribute(typeId, modifier.modifyingAttributeId);
			if (value === undefined) return null;
			if (modifier.operation === DOGMA_OPERATION_POST_PERCENT) return tidy(-value / 100);
			if (modifier.operation === DOGMA_OPERATION_POST_MUL) return tidy(1 - value);
			return null;
		}
		return null;
	};

	const rigs: IndustryRig[] = [];
	const structureIds = new Set<number>();
	for (const [typeId, activities] of [...sources.modifierSources].sort(([a], [b]) => a - b)) {
		const type = typesById.get(typeId);
		if (!type) {
			warnings.push(`MISSING_TYPE:${typeId}`);
			continue;
		}
		if (!type.published) continue;
		const category = categoryOf(type);
		if (category === STRUCTURE_CATEGORY_ID) {
			structureIds.add(typeId);
			continue;
		}
		const bonuses: IndustryRig['bonuses'] = [];
		for (const activity of ACTIVITIES) {
			for (const source of activities[activity] ?? []) {
				const material = reduction(typeId, source.dogmaAttributeId);
				if (material === null) {
					warnings.push(`UNDERIVED_INDUSTRY_BONUS:${typeId}:${activity}:${source.dogmaAttributeId}`);
					continue;
				}
				if (material !== 0) bonuses.push({ activity, material, filterId: source.filterId });
			}
		}
		if (bonuses.length === 0) continue;
		if (category !== STRUCTURE_MODULE_CATEGORY_ID) {
			warnings.push(`UNKNOWN_INDUSTRY_SOURCE:${typeId}`);
			continue;
		}
		bonuses.sort(
			(a, b) =>
				ACTIVITIES.indexOf(a.activity) - ACTIVITIES.indexOf(b.activity) ||
				(a.filterId ?? 0) - (b.filterId ?? 0)
		);
		const nullsec = attribute(typeId, NULL_SEC_MODIFIER_ATTRIBUTE_ID) ?? 1;
		const security: Record<IndustryBand, number> = {
			highsec: attribute(typeId, HI_SEC_MODIFIER_ATTRIBUTE_ID) ?? 1,
			lowsec: attribute(typeId, LOW_SEC_MODIFIER_ATTRIBUTE_ID) ?? 1,
			nullsec,
			// The SDE has no wormhole modifier; wormhole space uses the nullsec one.
			wormhole: nullsec
		};
		rigs.push({
			typeId,
			name: type.name,
			rigSize: attribute(typeId, RIG_SIZE_ATTRIBUTE_ID) ?? 0,
			groupId: type.groupId,
			fitsGroupIds: [
				...new Set(
					fitAttributeIds.flatMap((id) => {
						const group = attribute(typeId, id);
						return group === undefined ? [] : [group];
					})
				)
			].sort((a, b) => a - b),
			bonuses,
			security
		});
	}

	// Structures of a group an ME rig fits (the Athanor and citadels have no bonus of their own).
	const fittedGroups = new Set(rigs.flatMap((r) => r.fitsGroupIds));
	for (const type of raw.types) {
		if (type.published && fittedGroups.has(type.groupId) && categoryOf(type) === STRUCTURE_CATEGORY_ID)
			structureIds.add(type.typeId);
	}
	const structures: IndustryStructure[] = [];
	for (const typeId of [...structureIds].sort((a, b) => a - b)) {
		const type = typesById.get(typeId)!;
		const rigSize = attribute(typeId, RIG_SIZE_ATTRIBUTE_ID);
		const rigSlots = attribute(typeId, UPGRADE_SLOTS_LEFT_ATTRIBUTE_ID);
		if (rigSize === undefined || rigSlots === undefined) warnings.push(`MISSING_DOGMA:${typeId}`);
		const material: IndustryStructure['material'] = {};
		for (const activity of ACTIVITIES) {
			let multiplier = 1;
			for (const source of sources.modifierSources.get(typeId)?.[activity] ?? []) {
				const value = source.filterId === null ? reduction(typeId, source.dogmaAttributeId) : null;
				if (value === null) {
					warnings.push(`UNDERIVED_INDUSTRY_BONUS:${typeId}:${activity}:${source.dogmaAttributeId}`);
					continue;
				}
				multiplier *= 1 - value;
			}
			if (multiplier !== 1) material[activity] = tidy(1 - multiplier);
		}
		structures.push({
			typeId,
			name: type.name,
			groupId: type.groupId,
			rigSize: rigSize ?? 0,
			rigSlots: rigSlots ?? 0,
			material
		});
	}

	const productFilters: Record<number, number[]> = {};
	for (const typeId of [...new Set(products)].sort((a, b) => a - b)) {
		const type = typesById.get(typeId);
		if (!type) continue;
		const category = categoryOf(type);
		productFilters[typeId] = sources.filters
			.filter(
				(f) =>
					f.groupIds.includes(type.groupId) || (category !== undefined && f.categoryIds.includes(category))
			)
			.map((f) => f.filterId);
	}

	return { filters: sources.filters, rigs, structures, productFilters };
}
