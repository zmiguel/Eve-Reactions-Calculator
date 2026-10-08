import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { SDE_FILES, createLineSplitter, parseSdeZip, readSdeZip } from '../src/index.ts';
import { fixtureBytes, streamOf } from './helpers.ts';

function collectLines(chunks: Uint8Array[]): string[] {
	const lines: string[] = [];
	const splitter = createLineSplitter((line) => lines.push(line));
	for (const chunk of chunks) splitter.push(chunk);
	splitter.end();
	return lines;
}

describe('createLineSplitter', () => {
	it('splits lines across chunk boundaries, including inside multi-byte characters', () => {
		const bytes = strToU8('{"a":"タヌー"}\n{"b":2}\n');
		const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
		expect(collectLines(chunks)).toEqual(['{"a":"タヌー"}', '{"b":2}']);
	});

	it('handles CRLF endings, blank lines and a missing trailing newline', () => {
		expect(collectLines([strToU8('one\r\n\r\ntwo\n  \nthree')])).toEqual(['one', 'two', 'three']);
	});

	it('reports 1-based line numbers counting blank lines', () => {
		const numbers: number[] = [];
		const splitter = createLineSplitter((_line, n) => numbers.push(n));
		splitter.push(strToU8('a\n\nb\n'));
		splitter.end();
		expect(numbers).toEqual([1, 3]);
	});
});

describe('readSdeZip', () => {
	it('starts only the wanted entries of the fixture and never races.jsonl', async () => {
		const entries: [string, boolean][] = [];
		const raw = await readSdeZip(streamOf(fixtureBytes(), 4096), {
			onEntry: (name, started) => entries.push([name, started])
		});
		expect(entries).toContainEqual(['races.jsonl', false]);
		expect(entries.filter(([, started]) => started).map(([name]) => name)).toEqual([...SDE_FILES]);
		expect([...raw.files].sort()).toEqual([...SDE_FILES].sort());
		expect(raw.build).toBe(3421648);
		expect(raw.releaseDate).toBe('2026-07-03T11:54:23Z');
	});

	it('projects raw lines from the fixture', async () => {
		const raw = await readSdeZip(streamOf(fixtureBytes()));
		expect(raw.blueprints).toHaveLength(120);
		expect(raw.blueprints.find((b) => b.blueprintTypeId === 46166)).toEqual({
			blueprintTypeId: 46166,
			maxProductionLimit: 1000,
			time: 10800,
			materials: expect.arrayContaining([{ typeId: 4312, quantity: 5 }]),
			products: [{ typeId: 16663, quantity: 200 }],
			skills: [{ typeId: 45746, level: 2 }]
		});
		expect(raw.types.find((t) => t.typeId === 46166)).toEqual({
			typeId: 46166,
			name: 'Caesarium Cadmide Reaction Formula',
			groupId: 1888,
			volume: 0.01,
			portionSize: 1,
			published: true,
			basePrice: 10000000
		});
		expect(raw.typeMaterials.find((m) => m.typeId === 90283)?.randomizedMaterials).toEqual([
			{ materialTypeId: 34, quantityMin: 368000, quantityMax: 496800 }
		]);
		expect(raw.typeDogma.map((d) => d.typeId).sort((a, b) => a - b)).toEqual([
			35835, 35836, 45746, 45748, 45749, 46484, 46485, 46486, 46487, 46488, 46489, 46490, 46491, 46492, 46493,
			46494, 46495, 46496, 46497
		]);
		expect(raw.systems.find((s) => s.name === '671-ST')).toMatchObject({
			systemId: 30004604,
			regionId: 10000058
		});
	});

	it('matches entries by base name inside folders and skips unknown files', async () => {
		const zip = zipSync({
			'sde/_sde.jsonl': strToU8('{"_key":"sde","buildNumber":7,"releaseDate":"2026-01-01T00:00:00Z"}\n'),
			'sde/mapRegions.jsonl': strToU8('{"_key":10000002,"name":{"en":"The Forge"}}\n'),
			'sde/notes.txt': strToU8('ignored')
		});
		const entries: [string, boolean][] = [];
		const raw = await readSdeZip(streamOf(zip), {
			onEntry: (name, started) => entries.push([name, started])
		});
		expect(entries).toEqual([
			['sde/_sde.jsonl', true],
			['sde/mapRegions.jsonl', true],
			['sde/notes.txt', false]
		]);
		expect(raw.build).toBe(7);
		expect(raw.regions).toEqual([{ regionId: 10000002, name: 'The Forge' }]);
		expect(raw.files).toEqual(['_sde.jsonl', 'mapRegions.jsonl']);
	});

	it('rejects with the file and line of a malformed line', async () => {
		const zip = zipSync({
			'groups.jsonl': strToU8('{"_key":1,"name":{"en":"A"},"categoryID":2}\n{broken\n')
		});
		await expect(readSdeZip(streamOf(zip))).rejects.toThrow(/^groups\.jsonl:2: /);
	});
	it('rejects a truncated archive', async () => {
		const bytes = fixtureBytes();
		await expect(readSdeZip(streamOf(bytes.slice(0, bytes.length >> 1)))).rejects.toThrow();
	});
});

describe('parseSdeZip', () => {
	it('rejects an archive without SDE metadata', async () => {
		const zip = zipSync({ 'races.jsonl': strToU8('{"_key":1}\n') });
		await expect(parseSdeZip(streamOf(zip))).rejects.toThrow(/_sde\.jsonl/);
	});
});
