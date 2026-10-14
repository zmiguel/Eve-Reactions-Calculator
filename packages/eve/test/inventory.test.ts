import { describe, expect, it } from 'vitest';
import { fittedStructures, resolveInventory, type AssetRow } from '../src/index.ts';
import personal from './fixtures/assets-personal.json' with { type: 'json' };
import corp from './fixtures/assets-corp.json' with { type: 'json' };

type EsiRow = (typeof personal)[number] & { is_blueprint_copy?: boolean };

function toRows(rows: readonly EsiRow[]): AssetRow[] {
	return rows.map((r) => ({
		itemId: r.item_id,
		typeId: r.type_id,
		quantity: r.quantity,
		locationId: r.location_id,
		locationType: r.location_type as AssetRow['locationType'],
		locationFlag: r.location_flag,
		isSingleton: r.is_singleton,
		...(r.is_blueprint_copy != null ? { isBlueprintCopy: r.is_blueprint_copy } : {})
	}));
}

const RELEVANT = new Set([16634, 16635, 16636, 46166]);
const JITA = 60003760;
const UNOWNED = 1035000000000;

describe('resolveInventory', () => {
	it('resolves personal assets to station/structure hangars and deliveries', () => {
		expect(resolveInventory(toRows(personal), RELEVANT)).toEqual({
			locations: [
				{ locationId: JITA, kind: 'station' },
				{ locationId: UNOWNED, kind: 'structure' }
			],
			items: [
				// station hangar item (cargo, fitting, asset safety and the loop are dropped)
				{ locationId: JITA, bucket: 'deliveries', typeId: 16634, quantity: 7 },
				{ locationId: JITA, bucket: 'hangar', typeId: 16634, quantity: 100 },
				// in a container in the hangar
				{ locationId: JITA, bucket: 'hangar', typeId: 16635, quantity: 50 },
				// container inside a container
				{ locationId: JITA, bucket: 'hangar', typeId: 16636, quantity: 5 },
				// two formula stacks, one loose and one in a container: 1 + 2
				{ locationId: JITA, bucket: 'hangar', typeId: 46166, quantity: 3 },
				{ locationId: UNOWNED, bucket: 'hangar', typeId: 16635, quantity: 9 }
			]
		});
	});

	it('resolves corporation offices, owned structures and deliveries to divisions', () => {
		expect(resolveInventory(toRows(corp), RELEVANT)).toEqual({
			locations: [
				{ locationId: 4000, kind: 'structure' },
				{ locationId: 60008494, kind: 'station' }
			],
			items: [
				{ locationId: 4000, bucket: 'div2', typeId: 16634, quantity: 30 },
				{ locationId: 60008494, bucket: 'deliveries', typeId: 16636, quantity: 4 },
				{ locationId: 60008494, bucket: 'div1', typeId: 16634, quantity: 10 },
				{ locationId: 60008494, bucket: 'div3', typeId: 16635, quantity: 20 }
			]
		});
	});

	it('terminates on a container loop and keeps nothing from it', () => {
		const loop = toRows(personal).filter((r) => r.itemId >= 2001);
		expect(loop).toHaveLength(12);
		expect(resolveInventory(loop, RELEVANT)).toEqual({ locations: [], items: [] });
	});

	it('ignores irrelevant types', () => {
		expect(resolveInventory(toRows(personal), new Set([34]))).toEqual({
			locations: [{ locationId: JITA, kind: 'station' }],
			items: [{ locationId: JITA, bucket: 'hangar', typeId: 34, quantity: 999 }]
		});
		expect(resolveInventory(toRows(corp), new Set())).toEqual({ locations: [], items: [] });
	});
});

describe('fittedStructures', () => {
	const row = (itemId: number, typeId: number, locationId: number, locationFlag: string): AssetRow => ({
		itemId,
		typeId,
		quantity: 1,
		locationId,
		locationType: locationFlag === 'AutoFit' ? 'solar_system' : 'item',
		locationFlag,
		isSingleton: true
	});
	const RAITARU = 35825;
	const ME_RIG = 37174;
	const OTHER_ME_RIG = 37175;

	it('lists owned structures with their material rigs, [] when none is fitted', () => {
		const rows = [
			row(2, RAITARU, 30004604, 'AutoFit'),
			row(1, RAITARU, 30000142, 'AutoFit'),
			row(10, OTHER_ME_RIG, 1, 'RigSlot2'),
			row(11, ME_RIG, 1, 'RigSlot0'),
			row(12, 43920, 1, 'RigSlot1'),
			row(13, ME_RIG, 1, 'Cargo'),
			row(14, 35881, 2, 'ServiceSlot0'),
			// A ship in space is not a structure.
			row(3, 670, 30004604, 'AutoFit'),
			// Rigs in a structure whose own row is not among the structure types.
			row(20, ME_RIG, 99, 'RigSlot0')
		];
		expect(fittedStructures(rows, new Set([RAITARU]), new Set([ME_RIG, OTHER_ME_RIG]))).toEqual([
			{ structureId: 1, typeId: RAITARU, systemId: 30000142, rigs: [ME_RIG, OTHER_ME_RIG] },
			{ structureId: 2, typeId: RAITARU, systemId: 30004604, rigs: [] },
			{ structureId: 99, typeId: null, systemId: null, rigs: [ME_RIG] }
		]);
	});
});
