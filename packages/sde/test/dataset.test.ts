import { createReadStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONSTANTS, type Tier } from '@reactions/engine';
import { Zip, ZipPassThrough } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSdeZip, type SdeDataset } from '../src/index.ts';
import { fixtureBytes, industryFixture, streamOf } from './helpers.ts';

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
	// 307 reaction types and reprocess outputs, plus the four fuel block blueprints and 11 of their
	// materials (Oxygen is a reaction material already).
	expect(sde.types).toHaveLength(322);
	expect(Object.keys(sde.dataset.types)).toHaveLength(322);
	expect(Object.keys(sde.dataset.reprocess)).toHaveLength(25);
	expect(sde.warnings).toEqual([]);

	const manufacturing = sde.dataset.manufacturing ?? [];
	expect(manufacturing).toHaveLength(358);
	expect(manufacturing.map((m) => m.blueprintTypeId)).toEqual(
		[...manufacturing.map((m) => m.blueprintTypeId)].sort((a, b) => a - b)
	);
	const reactionProducts = new Set(reactions.map((r) => r.product.typeId));
	for (const m of manufacturing) {
		expect(m.materials.length).toBeGreaterThan(0);
		if (m.makes === 'material') continue;
		for (const material of m.materials) expect(reactionProducts.has(material.typeId)).toBe(true);
	}
	// The fuel blocks are the only reaction materials made by manufacturing: every material kept.
	expect(manufacturing.filter((m) => m.makes === 'material').map((m) => m.blueprintTypeId)).toEqual([
		4313, 4314, 4315, 4316
	]);
	expect(manufacturing.find((m) => m.blueprintTypeId === 4316)).toEqual({
		blueprintTypeId: 4316,
		name: 'Hydrogen Fuel Block Blueprint',
		productTypeId: 4246,
		productName: 'Hydrogen Fuel Block',
		productQuantity: 40,
		makes: 'material',
		materials: [
			{ typeId: 9848, quantity: 1 },
			{ typeId: 44, quantity: 4 },
			{ typeId: 3689, quantity: 4 },
			{ typeId: 9832, quantity: 9 },
			{ typeId: 16275, quantity: 20 },
			{ typeId: 3683, quantity: 22 },
			{ typeId: 16272, quantity: 170 },
			{ typeId: 16273, quantity: 350 },
			{ typeId: 17889, quantity: 450 }
		]
	});
	// Its blueprint and materials have names (and so prices).
	for (const typeId of [4316, 9848, 44, 3689, 9832, 16275, 16272, 16273, 17889])
		expect(sde.dataset.types[typeId]?.name).toBeTruthy();
	// Fusion Thruster: every material is a reaction product.
	expect(manufacturing.find((m) => m.blueprintTypeId === 17349)).toEqual({
		blueprintTypeId: 17349,
		name: 'Fusion Thruster Blueprint',
		productTypeId: 11532,
		productName: 'Fusion Thruster',
		productQuantity: 1,
		materials: [
			{ typeId: 16672, quantity: 13 },
			{ typeId: 16680, quantity: 3 },
			{ typeId: 16683, quantity: 1 }
		]
	});
	// Mjolnir Fury Light Missile: only Phenolic Composites is kept (not R.A.M., EM Pulse Generator, …).
	expect(manufacturing.find((m) => m.blueprintTypeId === 2614)).toMatchObject({
		blueprintTypeId: 2614,
		productTypeId: 2613,
		productQuantity: 5000,
		materials: [{ typeId: 16680, quantity: 12 }]
	});
	// Unpublished blueprint (Cerebral Accelerator) taking a reaction product.
	expect(manufacturing.some((m) => m.blueprintTypeId === 2839)).toBe(false);

	const band = (name: string) => sde.systems.find((s) => s.name === name)?.securityBand;
	expect(band('Ignoitton')).toBe('lowsec');
	expect(band('671-ST')).toBe('nullsec');
	expect(band('J105443')).toBe('wormhole');
	expect(band('Jita')).toBe('highsec');
	expect(band('Perimeter')).toBe('highsec');
	expect(band('Tanoo')).toBe('highsec');

	expectIndustry(sde);
}

/** Industry data of build 3421648 joined with the Hoboleaks fixtures. */
function expectIndustry(sde: SdeDataset) {
	const industry = sde.dataset.industry!;
	expect(industry.filters).toHaveLength(18);
	expect(industry.rigs).toHaveLength(123);
	// Engineering complexes, citadels (with the faction Fortizars) and refineries.
	expect(industry.structures.map((s) => s.typeId)).toEqual([
		35825, 35826, 35827, 35832, 35833, 35834, 35835, 35836, 40340, 47512, 47513, 47514, 47515, 47516
	]);
	const structure = (typeId: number) => industry.structures.find((s) => s.typeId === typeId);
	expect(structure(35825)).toEqual({
		typeId: 35825,
		name: 'Raitaru',
		groupId: 1404,
		rigSize: 2,
		rigSlots: 3,
		material: { manufacturing: 0.01 }
	});
	expect(structure(35827)).toMatchObject({ rigSize: 4, material: { manufacturing: 0.01 } });
	expect(structure(35835)).toMatchObject({ name: 'Athanor', rigSize: 2, material: {} });
	expect(structure(35836)).toMatchObject({ name: 'Tatara', rigSize: 3, material: {} });
	expect(structure(35833)).toMatchObject({ name: 'Fortizar', rigSize: 3, material: {} });

	const rig = (typeId: number) => industry.rigs.find((r) => r.typeId === typeId);
	expect(rig(37175)).toEqual({
		typeId: 37175,
		name: 'Standup L-Set Advanced Component Manufacturing Efficiency II',
		rigSize: 3,
		// One kind with its T1 (37174): never fitted together.
		groupId: 1860,
		fitsGroupIds: [1404, 1406, 1657],
		bonuses: [
			{ activity: 'manufacturing', material: 0.024, filterId: 14 },
			{ activity: 'manufacturing', material: 0.024, filterId: 15 }
		],
		security: { highsec: 1, lowsec: 1.9, nullsec: 2.1, wormhole: 2.1 }
	});
	expect(rig(46497)).toMatchObject({
		name: 'Standup L-Set Reactor Efficiency II',
		rigSize: 3,
		groupId: 1939,
		fitsGroupIds: [1406],
		bonuses: [
			{ activity: 'reaction', material: 0.024, filterId: 16 },
			{ activity: 'reaction', material: 0.024, filterId: 17 },
			{ activity: 'reaction', material: 0.024, filterId: 18 }
		],
		security: { highsec: 1, lowsec: 1, nullsec: 1.1, wormhole: 1.1 }
	});
	// Outpost conversion rig: 3 % on every manufacturing product, no security multiplier.
	expect(rig(48023)).toMatchObject({
		fitsGroupIds: [1657],
		bonuses: [{ activity: 'manufacturing', material: 0.03, filterId: null }],
		security: { highsec: 1, lowsec: 1, nullsec: 1, wormhole: 1 }
	});
	// Every rig fits a structure of its size and every structure takes a rig of its size.
	for (const r of industry.rigs) {
		expect(
			industry.structures.some((s) => r.fitsGroupIds.includes(s.groupId) && s.rigSize === r.rigSize),
			r.name
		).toBe(true);
	}
	for (const s of industry.structures) {
		expect(
			industry.rigs.some((r) => r.fitsGroupIds.includes(s.groupId) && r.rigSize === s.rigSize),
			s.name
		).toBe(true);
	}

	// Fusion Thruster (Construction Components) → Components; Titanium Carbide (Composite) and Titanium
	// Chromide (Intermediate Materials) → Composite Reactions; Methanofullerene → Hybrid Reactions.
	expect(industry.productFilters[11532]).toEqual([14]);
	expect(industry.productFilters[16671]).toEqual([18]);
	expect(industry.productFilters[16654]).toEqual([18]);
	expect(industry.productFilters[30306]).toEqual([16]);
	const products = [
		...sde.dataset.reactions.map((r) => r.product.typeId),
		...(sde.dataset.manufacturing ?? []).map((m) => m.productTypeId)
	];
	expect(
		Object.keys(industry.productFilters)
			.map(Number)
			.sort((a, b) => a - b)
	).toEqual([...new Set(products)].sort((a, b) => a - b));
}

describe('parseSdeZip on the sde-mini fixture', () => {
	let sde: SdeDataset;
	const entries: [string, boolean][] = [];
	beforeAll(async () => {
		sde = await parseSdeZip(streamOf(fixtureBytes()), {
			onEntry: (name, started) => entries.push([name, started]),
			industry: industryFixture()
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

	it('lists the capital components consuming minerals, with only those materials', () => {
		// The fixture keeps only blueprints that take a reaction product or make a reaction material.
		expect(sde.manufacturingBlueprints).toHaveLength(202);
		expect(sde.manufacturingBlueprints.find((b) => b.blueprintTypeId === 21038)).toEqual({
			blueprintTypeId: 21038,
			name: 'Capital Construction Parts Blueprint',
			productTypeId: 21037,
			productName: 'Capital Construction Parts',
			// Capital Components: which rig bonuses apply.
			productFilters: [13],
			// Its Reinforced Carbon Fiber (a reaction product) stays a `Dataset.manufacturing` material.
			materials: [
				{ typeId: 40, quantity: 210 },
				{ typeId: 39, quantity: 413 },
				{ typeId: 38, quantity: 750 },
				{ typeId: 37, quantity: 9000 },
				{ typeId: 34, quantity: 30000 },
				{ typeId: 36, quantity: 30000 },
				{ typeId: 35, quantity: 105000 }
			]
		});
		// No fuel block blueprint and no material-making blueprint.
		const makers = new Set(
			sde.dataset.manufacturing?.filter((b) => b.makes === 'material').map((b) => b.blueprintTypeId)
		);
		expect(sde.manufacturingBlueprints.some((b) => makers.has(b.blueprintTypeId))).toBe(false);
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
			},
			industry: industryFixture()
		});
		expectBuild3421648(sde);
		expect(started).not.toContain('races.jsonl');
		expect(sde.systems).toHaveLength(8089);
	});
});
