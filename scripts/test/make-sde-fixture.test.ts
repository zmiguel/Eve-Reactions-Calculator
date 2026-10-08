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
			'mapSolarSystems.jsonl',
			'mapRegions.jsonl',
			'races.jsonl'
		]);
		const lines = (name: string) => new TextDecoder().decode(entries[name]).trim().split('\n');
		expect(lines('blueprints.jsonl')).toHaveLength(120);
		expect(lines('mapSolarSystems.jsonl')).toHaveLength(10);
		expect(lines('typeDogma.jsonl')).toHaveLength(19);
	});
});
