/** Industry bonus data and facility lookups for tests: a small slice shaped like the published game data. */
import type { IndustryData, IndustryRig } from '@reactions/engine';
import type { FakeD1 } from './fakes.ts';

export const ATHANOR = 35835;
export const TATARA = 35836;
export const RAITARU = 35825;
/** L-Set reactor rig II: every reaction kind, fits refineries (Tatara). */
export const L_REACTOR_RIG = 46497;
/** M-Set composite reactor rig: composite reactions only, fits refineries (Athanor). */
export const M_COMPOSITE_RIG = 46484;
/** Its T2: the same rig kind (group), so never fitted together with it. */
export const M_COMPOSITE_RIG_II = 46487;
/** M-Set equipment manufacturing rig: fits engineering complexes (Raitaru). */
export const M_EQUIPMENT_RIG = 43920;
/** L-Set component manufacturing rig: fits engineering complexes of rig size L (Azbel), not a Raitaru. */
export const L_COMPONENT_RIG = 37174;

const REACTOR_SECURITY: IndustryRig['security'] = { highsec: 1, lowsec: 1, nullsec: 1.1, wormhole: 1.1 };
const ENGINEERING_SECURITY: IndustryRig['security'] = {
	highsec: 1,
	lowsec: 1.9,
	nullsec: 2.1,
	wormhole: 2.1
};

/** `productFilters` maps the given composite and component products; filters 14, 16-18 as in the game. */
export function industryFixture(products: { composite?: number[]; component?: number[] } = {}): IndustryData {
	return {
		filters: [
			{ filterId: 2, name: 'Equipment', categoryIds: [7, 20, 22], groupIds: [12, 340, 448, 649] },
			{ filterId: 14, name: 'Components', categoryIds: [], groupIds: [332, 334, 716, 964] },
			{ filterId: 16, name: 'Hybrid Reactions', categoryIds: [], groupIds: [974] },
			{ filterId: 17, name: 'Biochemical Reactions', categoryIds: [], groupIds: [712, 4096] },
			{ filterId: 18, name: 'Composite Reactions', categoryIds: [], groupIds: [428, 429, 4932] }
		],
		rigs: [
			{
				typeId: L_REACTOR_RIG,
				name: 'Standup L-Set Reactor Efficiency II',
				rigSize: 3,
				groupId: 1939,
				fitsGroupIds: [1406],
				bonuses: [16, 17, 18].map((filterId) => ({
					activity: 'reaction' as const,
					material: 0.024,
					filterId
				})),
				security: REACTOR_SECURITY
			},
			{
				typeId: M_COMPOSITE_RIG,
				name: 'Standup M-Set Composite Reactor Material Efficiency I',
				rigSize: 2,
				groupId: 1934,
				fitsGroupIds: [1406],
				bonuses: [{ activity: 'reaction', material: 0.02, filterId: 18 }],
				security: REACTOR_SECURITY
			},
			{
				typeId: M_COMPOSITE_RIG_II,
				name: 'Standup M-Set Composite Reactor Material Efficiency II',
				rigSize: 2,
				groupId: 1934,
				fitsGroupIds: [1406],
				bonuses: [{ activity: 'reaction', material: 0.024, filterId: 18 }],
				security: REACTOR_SECURITY
			},
			{
				typeId: M_EQUIPMENT_RIG,
				name: 'Standup M-Set Equipment Manufacturing Material Efficiency I',
				rigSize: 2,
				groupId: 1816,
				fitsGroupIds: [1404, 1657],
				bonuses: [{ activity: 'manufacturing', material: 0.02, filterId: 2 }],
				security: ENGINEERING_SECURITY
			},
			{
				typeId: L_COMPONENT_RIG,
				name: 'Standup L-Set Advanced Component Manufacturing Efficiency I',
				rigSize: 3,
				groupId: 1860,
				fitsGroupIds: [1404],
				bonuses: [{ activity: 'manufacturing', material: 0.02, filterId: 14 }],
				security: ENGINEERING_SECURITY
			}
		],
		structures: [
			{
				typeId: RAITARU,
				name: 'Raitaru',
				groupId: 1404,
				rigSize: 2,
				rigSlots: 3,
				material: { manufacturing: 0.01 }
			},
			{ typeId: ATHANOR, name: 'Athanor', groupId: 1406, rigSize: 2, rigSlots: 3, material: {} },
			{ typeId: TATARA, name: 'Tatara', groupId: 1406, rigSize: 3, rigSlots: 3, material: {} }
		],
		productFilters: Object.fromEntries([
			...(products.composite ?? []).map((id) => [id, [18]]),
			...(products.component ?? []).map((id) => [id, [14]])
		])
	};
}

/** A `tracked_facilities` row of `userId`. */
export function insertTrackedFacility(
	db: FakeD1,
	userId: string,
	f: {
		facilityId: number;
		kind?: 'structure' | 'station' | 'unknown';
		name?: string | null;
		systemId?: number | null;
		typeId?: number | null;
		rigs?: number[] | null;
		rigsReadAt?: number | null;
	}
) {
	db.sqlite
		.prepare(
			`INSERT INTO tracked_facilities (user_id, facility_id, kind, name, system_id, type_id, rigs_json, rigs_read_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			f.facilityId,
			f.kind ?? 'structure',
			f.name ?? null,
			f.systemId ?? null,
			f.typeId ?? null,
			f.rigs === undefined || f.rigs === null ? null : JSON.stringify(f.rigs),
			f.rigsReadAt ?? null
		);
}
