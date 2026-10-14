import { Unzip, UnzipInflate } from 'fflate';
import { normalize } from './normalize.ts';
import {
	DOGMA_TYPE_IDS,
	RIG_SIZE_ATTRIBUTE_ID,
	UPGRADE_SLOTS_LEFT_ATTRIBUTE_ID,
	type SdeFile
} from './constants.ts';
import type {
	IndustrySources,
	RawDogmaEffect,
	RawSde,
	SdeBlueprintLine,
	SdeDataset,
	SdeDogmaAttributeLine,
	SdeDogmaEffectLine,
	SdeGroupLine,
	SdeMetaLine,
	SdeRegionLine,
	SdeSolarSystemLine,
	SdeText,
	SdeTypeDogmaLine,
	SdeTypeLine,
	SdeTypeMaterialsLine
} from './types.ts';

export interface ReadSdeOptions {
	/** Called for every archive entry; `started` is true when the entry is decompressed and parsed. */
	onEntry?: (name: string, started: boolean) => void;
	/**
	 * Game client industry data (`readIndustrySources`): its types' dogma is read and the dataset gets
	 * `industry`. Without it the dataset has no industry data.
	 */
	industry?: IndustrySources;
}

/** Matches the leading `_key` so filtered files can skip `JSON.parse` for unwanted lines. */
export const KEY_PREFIX = /^\{\s*"_key"\s*:\s*(\d+)/;

/** English text of a localized SDE field. */
export function englishText(value: SdeText | undefined): string {
	if (typeof value === 'string') return value;
	return value?.en ?? '';
}

/* JSON.parse results are typed by the line interfaces in types.ts; missing fields get defaults below. */
function createHandlers(
	raw: RawSde,
	industry: IndustrySources | undefined
): Record<SdeFile, (line: string) => void> {
	// Full dogma: the constants' types and every type with an industry material bonus.
	const dogmaIds = new Set(DOGMA_TYPE_IDS);
	for (const [typeId, activities] of industry?.modifierSources ?? []) {
		if (Object.values(activities).some((sources) => sources.length > 0)) dogmaIds.add(typeId);
	}
	const rigSize = new RegExp(`"attributeID"\\s*:\\s*${RIG_SIZE_ATTRIBUTE_ID}\\b`);
	return {
		'_sde.jsonl': (line) => {
			const o: SdeMetaLine = JSON.parse(line);
			if (o._key !== 'sde') return;
			raw.build = o.buildNumber ?? null;
			raw.releaseDate = o.releaseDate ?? null;
		},
		'blueprints.jsonl': (line) => {
			if (!line.includes('"reaction"') && !line.includes('"manufacturing"')) return;
			const o: SdeBlueprintLine = JSON.parse(line);
			const blueprintTypeId = o.blueprintTypeID ?? o._key;
			const r = o.activities?.reaction;
			if (r) {
				raw.blueprints.push({
					blueprintTypeId,
					maxProductionLimit: o.maxProductionLimit ?? 0,
					time: r.time ?? 0,
					materials: (r.materials ?? []).map((m) => ({ typeId: m.typeID, quantity: m.quantity })),
					products: (r.products ?? []).map((m) => ({ typeId: m.typeID, quantity: m.quantity })),
					skills: (r.skills ?? []).map((s) => ({ typeId: s.typeID, level: s.level }))
				});
			}
			const m = o.activities?.manufacturing;
			if (m) {
				raw.manufacturing.push({
					blueprintTypeId,
					materials: (m.materials ?? []).map((x) => ({ typeId: x.typeID, quantity: x.quantity })),
					products: (m.products ?? []).map((x) => ({ typeId: x.typeID, quantity: x.quantity }))
				});
			}
		},
		'types.jsonl': (line) => {
			const o: SdeTypeLine = JSON.parse(line);
			raw.types.push({
				typeId: o._key,
				name: englishText(o.name),
				groupId: o.groupID ?? 0,
				volume: o.volume ?? null,
				portionSize: o.portionSize ?? null,
				published: o.published === true,
				basePrice: o.basePrice ?? null
			});
		},
		'groups.jsonl': (line) => {
			const o: SdeGroupLine = JSON.parse(line);
			raw.groups.push({ groupId: o._key, name: englishText(o.name), categoryId: o.categoryID ?? 0 });
		},
		'typeMaterials.jsonl': (line) => {
			const o: SdeTypeMaterialsLine = JSON.parse(line);
			raw.typeMaterials.push({
				typeId: o._key,
				materials: (o.materials ?? []).map((m) => ({
					materialTypeId: m.materialTypeID,
					quantity: m.quantity
				})),
				randomizedMaterials: (o.randomizedMaterials ?? []).map((m) => ({
					materialTypeId: m.materialTypeID,
					quantityMin: m.quantityMin,
					quantityMax: m.quantityMax
				}))
			});
		},
		'typeDogma.jsonl': (line) => {
			const key = KEY_PREFIX.exec(line);
			if (key && !dogmaIds.has(Number(key[1])) && !rigSize.test(line)) return;
			const o: SdeTypeDogmaLine = JSON.parse(line);
			const attributes = (o.dogmaAttributes ?? []).map((a) => ({
				attributeId: a.attributeID,
				value: a.value
			}));
			if (dogmaIds.has(o._key)) {
				raw.typeDogma.push({
					typeId: o._key,
					attributes,
					effectIds: (o.dogmaEffects ?? []).map((e) => e.effectID)
				});
				return;
			}
			// Any other type with a rig size (a structure, a rig or a ship): rig size and slots only.
			if (!attributes.some((a) => a.attributeId === RIG_SIZE_ATTRIBUTE_ID)) return;
			raw.typeDogma.push({
				typeId: o._key,
				attributes: attributes.filter(
					(a) => a.attributeId === RIG_SIZE_ATTRIBUTE_ID || a.attributeId === UPGRADE_SLOTS_LEFT_ATTRIBUTE_ID
				),
				effectIds: []
			});
		},
		'dogmaAttributes.jsonl': (line) => {
			const o: SdeDogmaAttributeLine = JSON.parse(line);
			raw.dogmaAttributes.push({ attributeId: o._key, name: o.name ?? '' });
		},
		'dogmaEffects.jsonl': (line) => {
			if (!line.includes('"structureID"')) return;
			const o: SdeDogmaEffectLine = JSON.parse(line);
			const structureModifiers: RawDogmaEffect['structureModifiers'] = [];
			for (const m of o.modifierInfo ?? []) {
				if (m.domain !== 'structureID' || m.func !== 'ItemModifier') continue;
				if (m.modifiedAttributeID === undefined || m.modifyingAttributeID === undefined) continue;
				structureModifiers.push({
					modifiedAttributeId: m.modifiedAttributeID,
					modifyingAttributeId: m.modifyingAttributeID,
					operation: m.operation ?? 0
				});
			}
			if (structureModifiers.length > 0) raw.dogmaEffects.push({ effectId: o._key, structureModifiers });
		},
		'mapSolarSystems.jsonl': (line) => {
			const o: SdeSolarSystemLine = JSON.parse(line);
			raw.systems.push({
				systemId: o._key,
				name: englishText(o.name),
				regionId: o.regionID,
				constellationId: o.constellationID,
				securityStatus: o.securityStatus ?? 0
			});
		},
		'mapRegions.jsonl': (line) => {
			const o: SdeRegionLine = JSON.parse(line);
			raw.regions.push({ regionId: o._key, name: englishText(o.name) });
		}
	};
}

export interface LineSplitter {
	push(chunk: Uint8Array): void;
	end(): void;
}

/** Streaming UTF-8 line splitter; empty lines are skipped, `\r\n` endings tolerated. */
export function createLineSplitter(onLine: (line: string, lineNumber: number) => void): LineSplitter {
	const decoder = new TextDecoder();
	let buffer = '';
	let lineNumber = 0;
	const emit = (line: string) => {
		lineNumber++;
		const text = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (text.trim() !== '') onLine(text, lineNumber);
	};
	const drain = (from: number) => {
		let start = 0;
		let nl = buffer.indexOf('\n', from);
		while (nl !== -1) {
			emit(buffer.slice(start, nl));
			start = nl + 1;
			nl = buffer.indexOf('\n', start);
		}
		if (start > 0) buffer = buffer.slice(start);
	};
	return {
		push(chunk) {
			const from = buffer.length;
			buffer += decoder.decode(chunk, { stream: true });
			drain(from);
		},
		end() {
			const from = buffer.length;
			buffer += decoder.decode();
			drain(from);
			if (buffer !== '') emit(buffer);
			buffer = '';
		}
	};
}

/**
 * Streams an SDE JSONL zip and extracts the raw projections the normalizer needs.
 * Only the entries in `SDE_FILES` are inflated; works in Workers and Node (Web Streams only).
 */
export async function readSdeZip(
	body: ReadableStream<Uint8Array>,
	opts: ReadSdeOptions = {}
): Promise<RawSde> {
	const raw: RawSde = {
		build: null,
		releaseDate: null,
		blueprints: [],
		manufacturing: [],
		types: [],
		groups: [],
		typeMaterials: [],
		typeDogma: [],
		dogmaAttributes: [],
		dogmaEffects: [],
		systems: [],
		regions: [],
		files: []
	};
	const handlers = createHandlers(raw, opts.industry);
	let failure: unknown = null;
	let hasFailed = false;
	const fail = (error: unknown) => {
		if (hasFailed) return;
		hasFailed = true;
		failure = error;
	};

	const unzip = new Unzip((file) => {
		const name = file.name.slice(file.name.lastIndexOf('/') + 1);
		const handler = Object.hasOwn(handlers, name) ? handlers[name as SdeFile] : undefined;
		opts.onEntry?.(file.name, handler !== undefined);
		if (!handler) return;
		const splitter = createLineSplitter((line, lineNumber) => {
			try {
				handler(line);
			} catch (error) {
				throw new Error(`${name}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`, {
					cause: error
				});
			}
		});
		file.ondata = (error, chunk, final) => {
			if (hasFailed) return;
			if (error) return fail(error);
			try {
				splitter.push(chunk);
				if (final) {
					splitter.end();
					raw.files.push(name);
				}
			} catch (e) {
				fail(e);
			}
		};
		file.start();
	});
	unzip.register(UnzipInflate);

	const reader = body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			unzip.push(value, false);
			if (hasFailed) throw failure;
		}
		unzip.push(new Uint8Array(0), true);
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (hasFailed) throw failure;
	return raw;
}

/** Streams an SDE JSONL zip and returns the normalized dataset (with `industry` when `opts.industry` is given). */
export async function parseSdeZip(
	body: ReadableStream<Uint8Array>,
	opts: ReadSdeOptions = {}
): Promise<SdeDataset> {
	return normalize(await readSdeZip(body, opts), opts.industry);
}
