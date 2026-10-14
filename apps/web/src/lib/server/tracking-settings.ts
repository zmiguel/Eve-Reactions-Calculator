import {
	getCoreDb,
	inventorySources,
	ledgerState,
	trackedContracts,
	trackedJobs,
	users
} from '@reactions/db';
import {
	DEFAULT_CONSTANTS,
	DEFAULT_SETTINGS,
	TrackingSettings,
	facilityMaterialBonus,
	jobMaterialBonus,
	manufacturingNames,
	profileFor,
	resolveFacility,
	type Dataset,
	type IndustryActivity,
	type IndustryData,
	type Reactor
} from '@reactions/engine';
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
	NO_RIG,
	NO_STRUCTURE,
	RIG_NOT_SET,
	activitiesOf,
	rigChoicesFor,
	rigFits,
	type FacilitiesData,
	type FacilityBonusLine,
	type FacilityRigChoice,
	type FacilityStructureChoice,
	type FacilityView
} from '$lib/account/facilities';
import type { SessionUser } from './session.ts';
import { getDataset } from './data.ts';
import { facilityEve, facilityPlaces } from './facilities.ts';
import { getAccessibleHubs } from './hubs.ts';
import { ledgerReviewCount } from './ledger.ts';
import { resolveProfiles } from './profiles.ts';
import { parseStoredSettings } from './settings.ts';

export type FacilitySettings = TrackingSettings['facilities'][string];

/** ESI `activity_id`s of tracked jobs: reactions (9, or the SDE's 11) and manufacturing (1). */
const ACTIVITY_IDS: Record<IndustryActivity, readonly number[]> = { reaction: [9, 11], manufacturing: [1] };

export interface TrackingConnectionView {
	sourceId: number;
	kind: 'character' | 'corporation';
	ownerName: string;
	trackingSyncedAt: number | null;
}

/**
 * Upwell industry structures offered when the dataset has no industry data yet (no rig data, no
 * bonus known: the structure is stored for when it arrives).
 */
const STRUCTURES_WITHOUT_DATA: readonly (FacilityStructureChoice & { activity: IndustryActivity })[] = (
	[
		[35825, 'Raitaru', 'manufacturing'],
		[35826, 'Azbel', 'manufacturing'],
		[35827, 'Sotiyo', 'manufacturing'],
		[35835, 'Athanor', 'reaction'],
		[35836, 'Tatara', 'reaction']
	] as const
).map(([typeId, name, activity]) => ({ typeId, name, activity, groupId: 0, rigSize: 0, rigSlots: 0 }));

/** A manufacturing blueprint whose ME could not be read from EVE on at least one of the user's jobs. */
export interface TrackingBlueprintView {
	/** Blueprint type id as a string, the key of `TrackingSettings.blueprintMe`. */
	blueprintTypeId: string;
	name: string;
	/** Manufacturing jobs of this blueprint without a read ME. */
	jobs: number;
}

export interface TrackingSettingsPageData {
	connections: TrackingConnectionView[];
	rebuiltAt: number | null;
	dirty: boolean;
	reviewCount: number;
	hubs: { hubId: string; name: string; private: boolean }[];
	settings: TrackingSettings;
	/** Facilities of the tracked reaction and manufacturing jobs. */
	facilities: FacilitiesData;
	/** Manufacturing blueprints that need an assumed ME. */
	blueprints: TrackingBlueprintView[];
	janice: { linked: number; appraised: number };
}

/** The user's stored tracking settings; missing or unreadable JSON gives the defaults. */
export async function getTrackingSettings(env: Pick<Env, 'DB'>, userId: string): Promise<TrackingSettings> {
	const [row] = await getCoreDb(env.DB)
		.select({ json: users.trackingJson })
		.from(users)
		.where(eq(users.userId, userId));
	if (row?.json) {
		try {
			const parsed = TrackingSettings.safeParse(JSON.parse(row.json));
			if (parsed.success) return parsed.data;
		} catch {
			// Unreadable JSON: fall back to the defaults below.
		}
	}
	return TrackingSettings.parse(undefined);
}

export async function saveTrackingSettings(
	env: Pick<Env, 'DB'>,
	userId: string,
	settings: TrackingSettings
): Promise<void> {
	await getCoreDb(env.DB)
		.update(users)
		.set({ trackingJson: JSON.stringify(TrackingSettings.parse(settings)) })
		.where(eq(users.userId, userId));
}

/** The user's connections with Profit tracking on. */
const trackingSources = (userId: string) =>
	and(eq(inventorySources.userId, userId), eq(inventorySources.trackingEnabled, true));

/**
 * Structures that matter for jobs of `activities`: a role material bonus for one of them, or a rig with
 * a bonus for one of them fits; by name. Without industry data, the Upwell industry structures.
 */
function structureChoices(
	industry: IndustryData | undefined,
	activities: readonly IndustryActivity[]
): FacilityStructureChoice[] {
	if (!industry) {
		return STRUCTURES_WITHOUT_DATA.filter((s) => activities.includes(s.activity)).map(
			({ activity: _, ...s }) => s
		);
	}
	return industry.structures
		.filter((s) =>
			activities.some(
				(a) =>
					(s.material[a] ?? 0) > 0 ||
					industry.rigs.some((r) => rigFits(r, s) && r.bonuses.some((b) => b.activity === a))
			)
		)
		.map(({ typeId, name, groupId, rigSize, rigSlots }) => ({ typeId, name, groupId, rigSize, rigSlots }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a product is in the bonus lines: its most specific industry target filter. */
function productKind(industry: IndustryData, activity: IndustryActivity, productTypeId: number): string {
	const ids = industry.productFilters[productTypeId] ?? [];
	const [filter] = industry.filters
		.filter((f) => ids.includes(f.filterId))
		.sort((a, b) => Number(b.groupIds.length > 0) - Number(a.groupIds.length > 0) || a.filterId - b.filterId);
	return filter?.name ?? (activity === 'reaction' ? 'Other reactions' : 'Other manufacturing');
}

/**
 * Every facility of the user's tracked reaction and manufacturing jobs (tracking-on connections): what
 * EVE told about it ({@link facilityPlaces}), the choices for what it could not tell, the stored
 * settings, and the material bonus its job products get. A reaction facility in the system of the
 * account reactor settings takes what is not known from them (as the ledger does). Most jobs first.
 */
export async function listFacilities(
	env: Pick<Env, 'DB'>,
	userId: string,
	dataset: Dataset | null,
	settings: TrackingSettings
): Promise<FacilitiesData> {
	const [{ results }, places, [account]] = await Promise.all([
		env.DB.prepare(
			`SELECT j.facility_id, j.activity_id, j.blueprint_type_id, j.product_type_id, COUNT(*) AS jobs
			FROM tracked_jobs j
			JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = j.user_id
			WHERE j.user_id = ?1 AND s.tracking_enabled = 1 AND j.activity_id IN (1, 9, 11)
			GROUP BY j.facility_id, j.activity_id, j.blueprint_type_id, j.product_type_id`
		)
			.bind(userId)
			.all<{
				facility_id: number;
				activity_id: number;
				blueprint_type_id: number;
				product_type_id: number | null;
				jobs: number;
			}>(),
		facilityPlaces(env, userId),
		getCoreDb(env.DB).select({ json: users.settingsJson }).from(users).where(eq(users.userId, userId))
	]);
	// The account reactor settings, as the ledger reads them (missing or invalid = the defaults).
	const accountSettings = parseStoredSettings(account?.json ?? null) ?? DEFAULT_SETTINGS;
	const { profiles } = await resolveProfiles(env, accountSettings, new Set());
	const industry = dataset?.industry;
	const reactions = new Map(dataset?.reactions.map((r) => [r.blueprintTypeId, r]) ?? []);
	const reactionsByProduct = new Map(dataset?.reactions.map((r) => [r.product.typeId, r]) ?? []);
	const byFacility = new Map<
		number,
		{
			jobs: Record<IndustryActivity, number>;
			products: Record<IndustryActivity, Set<number>>;
			/** Reactor of each reaction product made here. */
			reactors: Map<number, Reactor>;
		}
	>();
	for (const r of results) {
		let f = byFacility.get(r.facility_id);
		if (!f) {
			f = {
				jobs: { reaction: 0, manufacturing: 0 },
				products: { reaction: new Set(), manufacturing: new Set() },
				reactors: new Map()
			};
			byFacility.set(r.facility_id, f);
		}
		const activity: IndustryActivity = ACTIVITY_IDS.manufacturing.includes(r.activity_id)
			? 'manufacturing'
			: 'reaction';
		f.jobs[activity] += r.jobs;
		const reaction =
			activity === 'reaction'
				? (reactions.get(r.blueprint_type_id) ??
					(r.product_type_id === null ? undefined : reactionsByProduct.get(r.product_type_id)))
				: undefined;
		const product =
			activity === 'reaction'
				? (reaction?.product.typeId ?? r.product_type_id)
				: (manufacturingNames(dataset, r.blueprint_type_id).productTypeId ?? r.product_type_id);
		if (product !== null) f.products[activity].add(product);
		if (product !== null && reaction) f.reactors.set(product, reaction.reactor);
	}

	const allActivities = (['reaction', 'manufacturing'] as const).filter((a) =>
		[...byFacility.values()].some((f) => f.jobs[a] > 0)
	);
	const listedStructures = structureChoices(industry, allActivities);
	const rigs: FacilityRigChoice[] = (industry?.rigs ?? [])
		.map((r) => ({
			typeId: r.typeId,
			name: r.name,
			rigSize: r.rigSize,
			groupId: r.groupId,
			fitsGroupIds: r.fitsGroupIds,
			activities: allActivities.filter((a) => r.bonuses.some((b) => b.activity === a))
		}))
		.filter((r) => r.activities.length > 0 && listedStructures.some((s) => rigFits(r, s)))
		.sort((a, b) => a.name.localeCompare(b.name));
	const rigNames = new Map(industry?.rigs.map((r) => [r.typeId, r.name]) ?? []);

	const list = [...byFacility].map(([facilityId, f]): FacilityView => {
		const place = places.get(facilityId);
		const eve = facilityEve(place);
		const stored = settings.facilities[String(facilityId)];
		const activities = activitiesOf(f.jobs);
		const structures = structureChoices(industry, activities);
		const detectedStructure =
			eve?.typeId === null || eve?.typeId === undefined
				? null
				: {
						typeId: eve.typeId,
						name:
							eve.typeId === NO_STRUCTURE
								? 'NPC station'
								: (industry?.structures.find((s) => s.typeId === eve.typeId)?.name ??
									STRUCTURES_WITHOUT_DATA.find((s) => s.typeId === eve.typeId)?.name ??
									dataset?.types[eve.typeId]?.name ??
									'Other structure')
					};
		const resolved = resolveFacility(eve, stored);
		const structure = structures.find((s) => s.typeId === resolved.structureTypeId);
		const fitting = rigChoicesFor(rigs, structure, activities);
		const storedRigsFit =
			stored?.rigs !== undefined &&
			stored.rigs.length <= (structure?.rigSlots ?? 0) &&
			stored.rigs.every((id) => fitting.some((r) => r.typeId === id));

		// Reaction jobs here whose every reactor's settings are in this facility's system: what is not
		// known of the facility comes from those settings (the ledger computes them that way).
		const reactorsHere = [...new Set(f.reactors.values())];
		const defaultProfiles =
			place?.systemId != null &&
			reactorsHere.length > 0 &&
			reactorsHere.every((r) => profileFor(accountSettings, r).systemId === place.systemId)
				? reactorsHere.map((r) => profileFor(accountSettings, r))
				: null;
		const same = <T>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0]! : null);
		const reactorDefault = defaultProfiles && {
			structure: same(defaultProfiles.map((p) => (p.structure === 'tatara' ? 'Tatara' : 'Athanor'))),
			meRig: same(defaultProfiles.map((p) => p.meRig))
		};
		const reactionsOnly = f.jobs.manufacturing === 0;

		const bonus = new Map<string, FacilityBonusLine>();
		let reactionProfile = false;
		for (const activity of activities) {
			const fromProfile =
				activity === 'reaction' && (!industry || resolved.structureTypeId === null || resolved.rigs === null);
			if (fromProfile && !reactorDefault) {
				reactionProfile = true;
				continue;
			}
			if (!fromProfile && !industry) continue;
			for (const product of f.products[activity]) {
				const label = industry ? productKind(industry, activity, product) : 'Reactions';
				let multiplier: number;
				if (fromProfile) {
					const p = profiles[f.reactors.get(product) ?? 'composite'];
					multiplier = jobMaterialBonus(industry, product, resolved, p, DEFAULT_CONSTANTS).multiplier;
				} else multiplier = facilityMaterialBonus(industry!, activity, product, resolved).multiplier;
				const reduction = 1 - multiplier;
				const key = `${activity}:${label}:${reduction.toFixed(6)}`;
				if (!bonus.has(key)) bonus.set(key, { activity, label, reduction, fromReactorSettings: fromProfile });
			}
		}
		return {
			facilityId: String(facilityId),
			name: place?.name ?? null,
			systemName: place?.systemName ?? null,
			band: place?.band ?? null,
			jobs: f.jobs,
			detectedStructure,
			detectedRigs:
				eve?.rigs === null || eve?.rigs === undefined
					? null
					: {
							names: eve.rigs.flatMap((id) => {
								const name = rigNames.get(id);
								return name === undefined ? [] : [name];
							}),
							others: eve.rigs.filter((id) => !rigNames.has(id)).length,
							readAt: place?.rigsReadAt ?? null
						},
			structures,
			setting: { structureTypeId: stored?.structureTypeId ?? null, rigs: stored?.rigs ?? null },
			needs: {
				structure: resolved.structureTypeId === null && !(reactorDefault && reactionsOnly),
				rigs:
					industry !== undefined &&
					resolved.rigs === null &&
					(structure?.rigSlots ?? 0) > 0 &&
					!storedRigsFit &&
					!(reactorDefault && reactionsOnly)
			},
			bonus: [...bonus.values()].sort(
				(a, b) => a.activity.localeCompare(b.activity) || a.label.localeCompare(b.label)
			),
			reactionProfile,
			reactorDefault
		};
	});
	list.sort(
		(a, b) =>
			b.jobs.reaction + b.jobs.manufacturing - (a.jobs.reaction + a.jobs.manufacturing) ||
			(a.name ?? '').localeCompare(b.name ?? '') ||
			a.facilityId.localeCompare(b.facilityId)
	);
	return {
		list,
		rigs,
		industryAvailable: industry !== undefined,
		needsInput: list.filter((f) => f.needs.structure || f.needs.rigs).length
	};
}

/**
 * The `TrackingSettings.facilities` after the Facilities form: `structure-<id>` ('' = not set, 0 = NPC
 * station or other, else a listed structure), `rig-<id>` (one per rig slot: `RIG_NOT_SET` on every slot
 * = no rigs stored, `NO_RIG` = an empty slot, else a rig type id) and `rigsFor-<id>` (the structure the
 * rig selects were shown for: rigs picked for another structure are dropped) of facilities in `data`.
 * Entries of facilities not posted are kept; what EVE told is not changed.
 */
export function facilitySettingsFromForm(
	form: FormData,
	data: FacilitiesData,
	current: TrackingSettings['facilities']
): { ok: true; facilities: TrackingSettings['facilities'] } | { ok: false; error: string } {
	const views = new Map(data.list.map((f) => [f.facilityId, f]));
	const posted = new Set<string>();
	for (const key of form.keys()) {
		const id = /^(?:structure|rig|rigsFor)-(.+)$/.exec(key)?.[1];
		if (id === undefined) continue;
		if (!views.has(id)) return { ok: false, error: 'That facility is not among your tracked jobs.' };
		posted.add(id);
	}
	const facilities = { ...current };
	for (const id of posted) {
		const f = views.get(id)!;
		const stored = current[id] ?? {};
		let structureTypeId = stored.structureTypeId;
		const rawStructure = form.get(`structure-${id}`);
		if (!f.detectedStructure && rawStructure !== null) {
			if (rawStructure === '') structureTypeId = undefined;
			else {
				const typeId = Number(rawStructure);
				if (typeId !== NO_STRUCTURE && !f.structures.some((s) => s.typeId === typeId))
					return { ok: false, error: 'Pick a structure from the list.' };
				structureTypeId = typeId;
			}
		}
		const structureOf = f.detectedStructure?.typeId ?? structureTypeId ?? null;
		let rigs =
			structureOf === (f.detectedStructure?.typeId ?? stored.structureTypeId ?? null)
				? stored.rigs
				: undefined;
		if (!f.detectedRigs && form.get(`rigsFor-${id}`) === String(structureOf)) {
			const structure = f.structures.find((s) => s.typeId === structureOf);
			const values = form.getAll(`rig-${id}`).map(String);
			const picked = values.filter((v) => v !== RIG_NOT_SET && v !== NO_RIG).map(Number);
			if (picked.length > (structure?.rigSlots ?? 0)) {
				return {
					ok: false,
					error: structure
						? `A ${structure.name} has ${structure.rigSlots} rig slots.`
						: 'This structure takes no rigs.'
				};
			}
			const fitting = rigChoicesFor(data.rigs, structure, activitiesOf(f.jobs));
			if (!picked.every((typeId) => fitting.some((r) => r.typeId === typeId)))
				return { ok: false, error: 'Pick rigs that fit the structure from the lists.' };
			const kinds = picked.map((typeId) => fitting.find((r) => r.typeId === typeId)!.groupId);
			if (new Set(kinds).size !== kinds.length)
				return {
					ok: false,
					error:
						'A structure holds one rig of each kind: a T1 and a T2 of the same rig cannot both be fitted.'
				};
			// Every slot left "Not set": nothing stored (EVE's or the reactor settings' rigs apply).
			rigs = values.every((v) => v === RIG_NOT_SET) ? undefined : picked;
		}
		if (structureTypeId === undefined && rigs === undefined) delete facilities[id];
		else
			facilities[id] = {
				...(structureTypeId === undefined ? {} : { structureTypeId }),
				...(rigs === undefined ? {} : { rigs })
			};
	}
	return { ok: true, facilities };
}

/** Name of a manufacturing blueprint (`manufacturingNames` of the engine). */
function blueprintName(dataset: Dataset | null, blueprintTypeId: number): string {
	return manufacturingNames(dataset, blueprintTypeId).blueprint;
}

/**
 * Blueprints of the user's manufacturing jobs (tracking-on connections) whose ME could not be read from
 * EVE on at least one job (`blueprint_me` null), with the count of those jobs, by name.
 */
export async function listUnreadBlueprints(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string
): Promise<TrackingBlueprintView[]> {
	const rows = await getCoreDb(env.DB)
		.select({ blueprintTypeId: trackedJobs.blueprintTypeId, jobs: count() })
		.from(trackedJobs)
		.innerJoin(inventorySources, eq(inventorySources.sourceId, trackedJobs.sourceId))
		.where(
			and(
				eq(trackedJobs.userId, userId),
				inArray(trackedJobs.activityId, [...ACTIVITY_IDS.manufacturing]),
				trackingSources(userId),
				isNull(trackedJobs.blueprintMe)
			)
		)
		.groupBy(trackedJobs.blueprintTypeId);
	if (!rows.length) return [];
	const dataset = await getDataset(env);
	return rows
		.map((r) => ({
			blueprintTypeId: String(r.blueprintTypeId),
			name: blueprintName(dataset, r.blueprintTypeId),
			jobs: r.jobs
		}))
		.sort((a, b) => a.name.localeCompare(b.name) || Number(a.blueprintTypeId) - Number(b.blueprintTypeId));
}

export async function trackingSettingsPage(
	env: Pick<Env, 'DB' | 'CACHE'>,
	user: SessionUser
): Promise<TrackingSettingsPageData> {
	const db = getCoreDb(env.DB);
	const userId = user.userId;
	const [connections, [state], reviewCount, [janice], hubs, settings, dataset, blueprints] =
		await Promise.all([
			db
				.select({
					sourceId: inventorySources.sourceId,
					kind: inventorySources.kind,
					ownerName: inventorySources.ownerName,
					trackingSyncedAt: inventorySources.trackingSyncedAt
				})
				.from(inventorySources)
				.where(trackingSources(userId))
				.orderBy(asc(inventorySources.ownerName)),
			db
				// 1: a change waits for a rebuild; 2: a rebuild is running (both pending).
				.select({ rebuiltAt: ledgerState.rebuiltAt, dirty: sql<number>`${ledgerState.dirty}` })
				.from(ledgerState)
				.where(eq(ledgerState.userId, userId)),
			ledgerReviewCount(env, userId),
			db
				.select({
					linked: count(),
					// A failed appraisal leaves a retry marker (`{failures, retryAt}`) without `code`.
					appraised: sql<number>`count(json_extract(${trackedContracts.janiceJson}, '$.code'))`
				})
				.from(trackedContracts)
				.innerJoin(inventorySources, eq(inventorySources.sourceId, trackedContracts.sourceId))
				.where(
					and(
						eq(trackedContracts.userId, userId),
						isNotNull(trackedContracts.janiceCode),
						trackingSources(userId)
					)
				),
			getAccessibleHubs(env, user),
			getTrackingSettings(env, userId),
			getDataset(env),
			listUnreadBlueprints(env, userId)
		]);
	return {
		connections: connections.map((c) => ({ ...c, kind: c.kind as TrackingConnectionView['kind'] })),
		rebuiltAt: state?.rebuiltAt ?? null,
		dirty: Boolean(state?.dirty),
		reviewCount,
		hubs: hubs.map((h) => ({ hubId: h.hubId, name: h.name, private: h.private })),
		settings,
		facilities: await listFacilities(env, userId, dataset, settings),
		blueprints,
		janice: { linked: janice?.linked ?? 0, appraised: janice?.appraised ?? 0 }
	};
}
