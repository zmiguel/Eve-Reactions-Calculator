import { Unzip, UnzipInflate } from 'fflate';
import { normalize } from './normalize.ts';
import { DOGMA_TYPE_IDS, type SdeFile } from './constants.ts';
import type {
	RawSde,
	SdeBlueprintLine,
	SdeDataset,
	SdeDogmaAttributeLine,
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
}

/** Matches the leading `_key` so filtered files can skip `JSON.parse` for unwanted lines. */
export const KEY_PREFIX = /^\{\s*"_key"\s*:\s*(\d+)/;

/** English text of a localized SDE field. */
export function englishText(value: SdeText | undefined): string {
	if (typeof value === 'string') return value;
	return value?.en ?? '';
}

/* JSON.parse results are typed by the line interfaces in types.ts; missing fields get defaults below. */
function createHandlers(raw: RawSde): Record<SdeFile, (line: string) => void> {
	const dogmaIds = new Set(DOGMA_TYPE_IDS);
	return {
		'_sde.jsonl': (line) => {
			const o: SdeMetaLine = JSON.parse(line);
			if (o._key !== 'sde') return;
			raw.build = o.buildNumber ?? null;
			raw.releaseDate = o.releaseDate ?? null;
		},
		'blueprints.jsonl': (line) => {
			if (!line.includes('"reaction"')) return;
			const o: SdeBlueprintLine = JSON.parse(line);
			const r = o.activities?.reaction;
			if (!r) return;
			raw.blueprints.push({
				blueprintTypeId: o.blueprintTypeID ?? o._key,
				maxProductionLimit: o.maxProductionLimit ?? 0,
				time: r.time ?? 0,
				materials: (r.materials ?? []).map((m) => ({ typeId: m.typeID, quantity: m.quantity })),
				products: (r.products ?? []).map((m) => ({ typeId: m.typeID, quantity: m.quantity })),
				skills: (r.skills ?? []).map((s) => ({ typeId: s.typeID, level: s.level }))
			});
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
			if (key && !dogmaIds.has(Number(key[1]))) return;
			const o: SdeTypeDogmaLine = JSON.parse(line);
			if (!dogmaIds.has(o._key)) return;
			raw.typeDogma.push({
				typeId: o._key,
				attributes: (o.dogmaAttributes ?? []).map((a) => ({ attributeId: a.attributeID, value: a.value }))
			});
		},
		'dogmaAttributes.jsonl': (line) => {
			const o: SdeDogmaAttributeLine = JSON.parse(line);
			raw.dogmaAttributes.push({ attributeId: o._key, name: o.name ?? '' });
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
		types: [],
		groups: [],
		typeMaterials: [],
		typeDogma: [],
		dogmaAttributes: [],
		systems: [],
		regions: [],
		files: []
	};
	const handlers = createHandlers(raw);
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

/** Streams an SDE JSONL zip and returns the normalized dataset. */
export async function parseSdeZip(
	body: ReadableStream<Uint8Array>,
	opts: ReadSdeOptions = {}
): Promise<SdeDataset> {
	return normalize(await readSdeZip(body, opts));
}
