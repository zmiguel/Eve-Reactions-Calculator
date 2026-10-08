import { createReadStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONSTANTS, type Tier } from '@reactions/engine';
import { Zip, ZipPassThrough } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSdeZip, type SdeDataset } from '../src/index.ts';
import { fixtureBytes, streamOf } from './helpers.ts';

const EXPECTED_TIERS: Record<Tier, number> = {
	intermediate: 24,
	composite: 17,
	unrefined: 17,
	unrefined_mineral: 8,
	polymer: 9,
	booster_synth: 8,
	booster_standard: 8,
	booster_improved: 8,
	booster_strong: 8,
	molecular_forged: 12,
	other: 0
};

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
	return counts;
}

/** Assertions that hold for the fixture and for the full SDE build 3421648. */
function expectBuild3421648(sde: SdeDataset) {
	const { reactions } = sde.dataset;
	expect(sde.build).toBe(3421648);
	expect(sde.dataset.sdeBuild).toBe(3421648);
	expect(sde.releaseDate).toBe('2026-07-03T11:54:23Z');
	expect(reactions).toHaveLength(119);
	expect(countBy(reactions, (r) => r.reactor)).toEqual({ composite: 66, biochemical: 44, hybrid: 9 });
	const tiers = countBy(reactions, (r) => r.tier);
	for (const [tier, count] of Object.entries(EXPECTED_TIERS)) expect(tiers[tier] ?? 0, tier).toBe(count);
	expect(new Set(reactions.map((r) => r.slug)).size).toBe(119);
	expect(reactions.map((r) => r.blueprintTypeId)).toEqual(
		[...reactions.map((r) => r.blueprintTypeId)].sort((a, b) => a - b)
	);
	expect(reactions.some((r) => r.blueprintTypeId === 45732)).toBe(false);
	expect(sde.dataset.constants).toEqual(DEFAULT_CONSTANTS);
	expect(sde.types).toHaveLength(307);
	expect(Object.keys(sde.dataset.types)).toHaveLength(307);
	expect(Object.keys(sde.dataset.reprocess)).toHaveLength(25);
	expect(sde.warnings).toEqual([]);

	const band = (name: string) => sde.systems.find((s) => s.name === name)?.securityBand;
	expect(band('Ignoitton')).toBe('lowsec');
	expect(band('671-ST')).toBe('nullsec');
	expect(band('J105443')).toBe('wormhole');
	expect(band('Jita')).toBe('highsec');
	expect(band('Perimeter')).toBe('highsec');
	expect(band('Tanoo')).toBe('highsec');
}

describe('parseSdeZip on the sde-mini fixture', () => {
	let sde: SdeDataset;
	const entries: [string, boolean][] = [];
	beforeAll(async () => {
		sde = await parseSdeZip(streamOf(fixtureBytes()), {
			onEntry: (name, started) => entries.push([name, started])
		});
	});

	it('matches the SDE build 3421648 reaction, type and system facts', () => {
		expectBuild3421648(sde);
		expect(entries).toContainEqual(['races.jsonl', false]);
	});

	it('normalizes Caesarium Cadmide', () => {
		expect(sde.dataset.reactions.find((r) => r.blueprintTypeId === 46166)).toEqual({
			blueprintTypeId: 46166,
			slug: 'caesarium-cadmide',
			name: 'Caesarium Cadmide',
			formulaName: 'Caesarium Cadmide Reaction Formula',
			reactor: 'composite',
			tier: 'intermediate',
			baseTimeSeconds: 10800,
			maxRuns: 1000,
			requiredSkillLevel: 2,
			product: { typeId: 16663, quantity: 200 },
			materials: [
				{ typeId: 4312, quantity: 5 },
				{ typeId: 16643, quantity: 100 },
				{ typeId: 16647, quantity: 100 }
			]
		});
		expect(sde.dataset.types[16663]).toEqual({
			typeId: 16663,
			name: 'Caesarium Cadmide',
			volume: 0.2,
			portionSize: 1,
			groupId: 428
		});
		expect(sde.types.find((t) => t.typeId === 46166)).toMatchObject({
			categoryId: 9,
			published: true,
			basePrice: 10000000
		});
	});

	it('builds reprocess entries for unrefined products', () => {
		expect(sde.dataset.reprocess[32825]).toEqual({
			typeId: 32825,
			portionSize: 1,
			materials: [{ typeId: 16665, quantity: 36, quantityMin: null, quantityMax: null }]
		});
		expect(sde.dataset.reprocess[90283]).toEqual({
			typeId: 90283,
			portionSize: 100,
			materials: [{ typeId: 34, quantity: null, quantityMin: 368000, quantityMax: 496800 }]
		});
	});

	it('keeps the fixture systems with their regions', () => {
		expect(sde.systems).toHaveLength(10);
		expect(sde.systems.find((s) => s.systemId === 30002647)).toEqual({
			systemId: 30002647,
			name: 'Ignoitton',
			regionId: 10000032,
			securityStatus: 0.438755,
			securityBand: 'lowsec'
		});
		expect(sde.regions.map((r) => r.regionId)).toEqual(
			expect.arrayContaining([10000002, 10000032, 10000043, 10000030, 10000042, 10000058])
		);
	});
});

/** Streams a stored (uncompressed) zip of every file in `dir` without buffering the archive. */
function zipDirectoryStream(dir: string): ReadableStream<Uint8Array> {
	const names = readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isFile())
		.map((d) => d.name)
		.sort();
	const pending: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error) throw error;
		pending.push(chunk);
	});
	let next = 0;
	let entry: ZipPassThrough | null = null;
	let source: AsyncIterator<Buffer> | null = null;
	let ended = false;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			while (pending.length === 0) {
				if (ended) return controller.close();
				if (!entry || !source) {
					if (next === names.length) {
						zip.end();
						ended = true;
						continue;
					}
					entry = new ZipPassThrough(names[next]);
					zip.add(entry);
					source = createReadStream(join(dir, names[next++]), { highWaterMark: 1 << 20 })[
						Symbol.asyncIterator
					]();
				}
				const chunk = await source.next();
				if (chunk.done) {
					entry.push(new Uint8Array(0), true);
					entry = null;
				} else entry.push(chunk.value, false);
			}
			for (const chunk of pending.splice(0)) controller.enqueue(chunk);
		}
	});
}

const SDE_DIR = process.env.SDE_DIR;

describe.skipIf(!SDE_DIR)('parseSdeZip on the full local SDE (SDE_DIR)', () => {
	it('yields the same facts as the fixture', { timeout: 600_000 }, async () => {
		const started: string[] = [];
		const sde = await parseSdeZip(zipDirectoryStream(SDE_DIR as string), {
			onEntry: (name, isStarted) => {
				if (isStarted) started.push(name);
			}
		});
		expectBuild3421648(sde);
		expect(started).not.toContain('races.jsonl');
		expect(sde.systems).toHaveLength(8089);
	});
});
