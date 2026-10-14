import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SDE_DIR, FIXTURE_FILES, buildFixtureZip } from '../make-sde-fixture.ts';

const hasSde = existsSync(join(DEFAULT_SDE_DIR, 'blueprints.jsonl'));

describe.skipIf(!hasSde)('buildFixtureZip', () => {
	it('is deterministic and contains the wanted files plus races.jsonl', { timeout: 120_000 }, () => {
		const first = buildFixtureZip(DEFAULT_SDE_DIR);
		const second = buildFixtureZip(DEFAULT_SDE_DIR);
		expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);

		const entries = unzipSync(first);
		expect(Object.keys(entries)).toEqual(FIXTURE_FILES);
		expect(FIXTURE_FILES).toEqual([
			'_sde.jsonl',
			'blueprints.jsonl',
			'types.jsonl',
			'groups.jsonl',
			'typeMaterials.jsonl',
			'typeDogma.jsonl',
			'dogmaAttributes.jsonl',
			'dogmaEffects.jsonl',
			'mapSolarSystems.jsonl',
			'mapRegions.jsonl',
			'races.jsonl'
		]);
		const lines = (name: string) => new TextDecoder().decode(entries[name]).trim().split('\n');
		// 120 reaction formulas plus 385 manufacturing blueprints taking a reaction product.
		expect(lines('blueprints.jsonl')).toHaveLength(505);
		expect(lines('mapSolarSystems.jsonl')).toHaveLength(10);
		// The constants' types, the Hoboleaks fixture types and the structures with a rig size.
		expect(lines('typeDogma.jsonl')).toHaveLength(179);
		// Effects of the types with an industry material bonus.
		expect(lines('dogmaEffects.jsonl')).toHaveLength(71);
	});
});
