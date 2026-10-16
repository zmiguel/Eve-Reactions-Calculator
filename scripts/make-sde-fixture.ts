/**
 * Builds `packages/sde/test/fixtures/sde-mini.zip` from the local SDE folder (`references/sde/`), with
 * the industry rigs and structures of the Hoboleaks fixtures (`packages/sde/test/fixtures/hoboleaks/`).
 * Usage: `node scripts/make-sde-fixture.ts [sdeDir] [outFile]`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
	DOGMA_TYPE_IDS,
	KEY_PREFIX,
	RIG_SIZE_ATTRIBUTE_ID,
	SDE_FILES,
	STRUCTURE_CATEGORY_ID,
	englishText,
	readIndustrySources,
	type IndustrySources
} from '@reactions/sde';
import type {
	SdeBlueprintLine,
	SdeFile,
	SdeGroupLine,
	SdeSolarSystemLine,
	SdeTypeDogmaLine,
	SdeTypeLine,
	SdeTypeMaterialsLine
} from '@reactions/sde';

export const DEFAULT_SDE_DIR = fileURLToPath(new URL('../references/sde/', import.meta.url));
export const DEFAULT_FIXTURE_PATH = fileURLToPath(
	new URL('../packages/sde/test/fixtures/sde-mini.zip', import.meta.url)
);
/** Hoboleaks `industrymodifiersources.json` and `industrytargetfilters.json` (manufacturing and reaction entries). */
export const HOBOLEAKS_FIXTURE_DIR = fileURLToPath(
	new URL('../packages/sde/test/fixtures/hoboleaks/', import.meta.url)
);

export function readHoboleaksFixture(dir: string = HOBOLEAKS_FIXTURE_DIR): IndustrySources {
	const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
	return readIndustrySources(read('industrymodifiersources.json'), read('industrytargetfilters.json'));
}

/** Hubs, the default reaction system, a nullsec system, a J-space system and a highsec non-hub system. */
export const FIXTURE_SYSTEM_NAMES = [
	'Jita',
	'Perimeter',
	'Amarr',
	'Dodixie',
	'Rens',
	'Hek',
	'Ignoitton',
	'671-ST',
	'J105443',
	'Tanoo'
];

/** Copied unfiltered so tests can prove unwanted entries are skipped. */
export const UNWANTED_FIXTURE_FILE = 'races.jsonl';

export const FIXTURE_FILES: string[] = [...SDE_FILES, UNWANTED_FIXTURE_FILE];

/** Local time so the DOS timestamp in the archive is 2000-01-01 00:00 regardless of the time zone. */
const FIXED_MTIME = new Date(2000, 0, 1);

interface SdeLine {
	text: string;
	key: number | null;
}

function readLines(sdeDir: string, file: string): SdeLine[] {
	return readFileSync(join(sdeDir, file), 'utf8')
		.split('\n')
		.map((line) => line.replace(/\r$/, ''))
		.filter((line) => line.trim() !== '')
		.map((text) => {
			const match = KEY_PREFIX.exec(text);
			return { text, key: match ? Number(match[1]) : null };
		});
}

/** Unchecked: the caller names the SDE line shape (see the line interfaces in `@reactions/sde`). */
function parse<T>(line: SdeLine): T {
	return JSON.parse(line.text) as T;
}

/** Numeric `_key` of a line; every filtered file has numeric keys. */
function keyOf(line: SdeLine): number {
	return line.key ?? parse<{ _key: number }>(line)._key;
}

/** Pure: reads `sdeDir` and returns the deterministic fixture zip bytes. */
export function buildFixtureZip(sdeDir: string = DEFAULT_SDE_DIR): Uint8Array {
	const allBlueprints = readLines(sdeDir, 'blueprints.jsonl');
	const reactionBlueprints = allBlueprints.filter((l) => parse<SdeBlueprintLine>(l).activities?.reaction);
	const tracked = new Set<number>();
	const products = new Set<number>();
	const reactionMaterials = new Set<number>();
	for (const line of reactionBlueprints) {
		const bp = parse<SdeBlueprintLine>(line);
		const reaction = bp.activities?.reaction;
		tracked.add(bp._key);
		for (const m of reaction?.materials ?? []) {
			tracked.add(m.typeID);
			reactionMaterials.add(m.typeID);
		}
		for (const p of reaction?.products ?? []) {
			tracked.add(p.typeID);
			products.add(p.typeID);
		}
	}
	// Manufacturing blueprints taking a reaction product or making a reaction material (published or
	// not), with their blueprint and product types (for their names) and, for the material-making ones
	// (fuel blocks), the types of every material.
	const manufacturingBlueprintIds = new Set<number>();
	const manufacturingTypeIds = new Set<number>();
	for (const line of allBlueprints) {
		const bp = parse<SdeBlueprintLine>(line);
		const materials = bp.activities?.manufacturing?.materials ?? [];
		const productIds = (bp.activities?.manufacturing?.products ?? []).map((p) => p.typeID);
		const makesMaterial = productIds.some((id) => reactionMaterials.has(id));
		if (!makesMaterial && !materials.some((m) => products.has(m.typeID))) continue;
		manufacturingBlueprintIds.add(bp._key);
		manufacturingTypeIds.add(bp._key);
		for (const id of productIds) manufacturingTypeIds.add(id);
		if (makesMaterial) for (const m of materials) manufacturingTypeIds.add(m.typeID);
	}
	const blueprints = allBlueprints.filter(
		(l) => parse<SdeBlueprintLine>(l).activities?.reaction || manufacturingBlueprintIds.has(keyOf(l))
	);

	const allTypes = readLines(sdeDir, 'types.jsonl');
	const typeById = new Map(allTypes.map((l) => [keyOf(l), l]));
	const typeMaterials = readLines(sdeDir, 'typeMaterials.jsonl');
	// Reprocess outputs of reaction products ("Unrefined …" intermediates and Prismaticite minerals).
	for (const line of typeMaterials) {
		const key = keyOf(line);
		const productLine = products.has(key) ? typeById.get(key) : undefined;
		if (!productLine) continue;
		const product = parse<SdeTypeLine>(productLine);
		const name = englishText(product.name);
		if (product.groupID !== 4932 && !(product.groupID === 428 && name.startsWith('Unrefined '))) continue;
		const entry = parse<SdeTypeMaterialsLine>(line);
		for (const m of [...(entry.materials ?? []), ...(entry.randomizedMaterials ?? [])])
			tracked.add(m.materialTypeID);
	}

	// Industry: every type of the Hoboleaks fixture with full dogma (as the parser reads it), and every
	// structure with a rig size (the parser keeps rig size and slots of any type that has one).
	const allGroups = readLines(sdeDir, 'groups.jsonl');
	const categoryOfGroup = new Map(allGroups.map((l) => [keyOf(l), parse<SdeGroupLine>(l).categoryID]));
	const industry = readHoboleaksFixture();
	const industryIds = new Set(industry.modifierSources.keys());
	const fullDogmaIds = new Set(DOGMA_TYPE_IDS);
	for (const [typeId, activities] of industry.modifierSources) {
		if (Object.values(activities).some((sources) => sources.length > 0)) fullDogmaIds.add(typeId);
	}
	const structureIds = new Set(
		allTypes
			.filter((l) => categoryOfGroup.get(parse<SdeTypeLine>(l).groupID ?? 0) === STRUCTURE_CATEGORY_ID)
			.map(keyOf)
	);
	const typeDogma = readLines(sdeDir, 'typeDogma.jsonl').filter((l) => {
		const key = keyOf(l);
		if (fullDogmaIds.has(key)) return true;
		if (!structureIds.has(key) && !industryIds.has(key)) return false;
		return (parse<SdeTypeDogmaLine>(l).dogmaAttributes ?? []).some(
			(a) => a.attributeID === RIG_SIZE_ATTRIBUTE_ID
		);
	});
	const dogmaTypeIds = new Set(typeDogma.map(keyOf));
	const attributeIds = new Set(
		typeDogma.flatMap((l) => (parse<SdeTypeDogmaLine>(l).dogmaAttributes ?? []).map((a) => a.attributeID))
	);
	const effectIds = new Set(
		typeDogma
			.filter((l) => fullDogmaIds.has(keyOf(l)))
			.flatMap((l) => (parse<SdeTypeDogmaLine>(l).dogmaEffects ?? []).map((e) => e.effectID))
	);

	const types = allTypes.filter((l) => {
		const key = keyOf(l);
		return tracked.has(key) || manufacturingTypeIds.has(key) || industryIds.has(key) || dogmaTypeIds.has(key);
	});
	const groupIds = new Set(types.map((l) => parse<SdeTypeLine>(l).groupID));

	const systems = readLines(sdeDir, 'mapSolarSystems.jsonl').filter((l) =>
		FIXTURE_SYSTEM_NAMES.includes(englishText(parse<SdeSolarSystemLine>(l).name))
	);
	if (systems.length !== FIXTURE_SYSTEM_NAMES.length) {
		throw new Error(`Expected ${FIXTURE_SYSTEM_NAMES.length} fixture systems, found ${systems.length}`);
	}
	const regionIds = new Set(systems.map((l) => parse<SdeSolarSystemLine>(l).regionID));

	const selected: Record<SdeFile, SdeLine[]> = {
		'_sde.jsonl': readLines(sdeDir, '_sde.jsonl'),
		'blueprints.jsonl': blueprints,
		'types.jsonl': types,
		'groups.jsonl': allGroups.filter((l) => groupIds.has(keyOf(l))),
		'typeMaterials.jsonl': typeMaterials.filter((l) => tracked.has(keyOf(l))),
		'typeDogma.jsonl': typeDogma,
		'dogmaAttributes.jsonl': readLines(sdeDir, 'dogmaAttributes.jsonl').filter((l) =>
			attributeIds.has(keyOf(l))
		),
		'dogmaEffects.jsonl': readLines(sdeDir, 'dogmaEffects.jsonl').filter((l) => effectIds.has(keyOf(l))),
		'mapSolarSystems.jsonl': systems,
		'mapRegions.jsonl': readLines(sdeDir, 'mapRegions.jsonl').filter((l) => regionIds.has(keyOf(l)))
	};

	const files: Zippable = {};
	for (const file of SDE_FILES) files[file] = strToU8(selected[file].map((l) => l.text).join('\n') + '\n');
	files[UNWANTED_FIXTURE_FILE] = new Uint8Array(readFileSync(join(sdeDir, UNWANTED_FIXTURE_FILE)));
	return zipSync(files, { level: 9, mtime: FIXED_MTIME });
}

if (import.meta.main) {
	const [sdeDir = DEFAULT_SDE_DIR, outFile = DEFAULT_FIXTURE_PATH] = process.argv.slice(2);
	const zip = buildFixtureZip(sdeDir);
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, zip);
	console.log(`Wrote ${outFile} (${zip.length} bytes)`);
}
