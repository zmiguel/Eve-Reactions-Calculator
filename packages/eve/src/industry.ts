import type { EsiClient } from './esi.ts';
import { isStationId, type InventoryItem, type ResolvedInventory } from './inventory.ts';

/**
 * `activity_id` values of a reaction job. ESI reports reactions as 9 (seen on live corporation jobs on
 * 2026-10-12: Titanium Carbide Reaction Formula jobs); the SDE's industry activity "Reactions" is 11,
 * which is accepted too. Reaction formulas fit no other activity.
 */
export const REACTION_ACTIVITY_IDS: ReadonlySet<number> = new Set([9, 11]);

/** `activity_id` of a manufacturing job (profit tracking reads the ones that use reaction products). */
export const MANUFACTURING_ACTIVITY_ID = 1;

export type IndustryJobStatus = 'active' | 'cancelled' | 'delivered' | 'paused' | 'ready' | 'reverted';

/** One row of `/characters/{id}/industry/jobs` or `/corporations/{id}/industry/jobs`. Dates are unix ms. */
export interface IndustryJobRow {
	jobId: number;
	installerId: number;
	activityId: number;
	blueprintId: number;
	blueprintTypeId: number;
	/** Absent on some activities (e.g. research). */
	productTypeId: number | null;
	/** Station or structure the job runs in (`station_id` for characters, `location_id` for corporations). */
	stationId: number;
	facilityId: number;
	outputLocationId: number;
	status: IndustryJobStatus;
	runs: number;
	/** Installation cost in ISK. */
	cost: number | null;
	startDate: number;
	endDate: number;
	completedDate: number | null;
}

interface EsiIndustryJobRow {
	job_id: number;
	installer_id: number;
	activity_id: number;
	blueprint_id: number;
	blueprint_type_id: number;
	product_type_id?: number;
	station_id?: number;
	location_id?: number;
	facility_id: number;
	output_location_id: number;
	status: IndustryJobStatus;
	runs: number;
	cost?: number;
	start_date: string;
	end_date: string;
	completed_date?: string;
}

export type IndustryJobPage =
	| {
			ok: true;
			items: IndustryJobRow[];
			pages: number;
			lastModified: number | null;
			expiresAt: number | null;
	  }
	| { ok: false; status: number; retryAfter: number | null };

export interface IndustryJobOptions {
	/** Adds finished jobs (delivered, cancelled, reverted) of the last 90 days. */
	includeCompleted?: boolean;
}

function mapJob(row: EsiIndustryJobRow): IndustryJobRow {
	return {
		jobId: row.job_id,
		installerId: row.installer_id,
		activityId: row.activity_id,
		blueprintId: row.blueprint_id,
		blueprintTypeId: row.blueprint_type_id,
		productTypeId: row.product_type_id ?? null,
		stationId: (row.station_id ?? row.location_id)!,
		facilityId: row.facility_id,
		outputLocationId: row.output_location_id,
		status: row.status,
		runs: row.runs,
		cost: row.cost ?? null,
		startDate: Date.parse(row.start_date),
		endDate: Date.parse(row.end_date),
		completedDate: row.completed_date ? Date.parse(row.completed_date) : null
	};
}

async function fetchJobPage(client: EsiClient, path: string, accessToken: string): Promise<IndustryJobPage> {
	const res = await client.get<EsiIndustryJobRow[]>(path, { accessToken });
	if (res.status < 200 || res.status >= 300)
		return { ok: false, status: res.status, retryAfter: res.retryAfter };
	return {
		ok: true,
		items: (res.data ?? []).map(mapJob),
		pages: res.pages,
		lastModified: res.lastModified,
		expiresAt: res.expiresAt
	};
}

/** `/characters/{id}/industry/jobs` (scope `esi-industry.read_character_jobs.v1`, not paged). Non-2XX is returned, not thrown. */
export function fetchCharacterIndustryJobs(
	client: EsiClient,
	characterId: number,
	accessToken: string,
	options: IndustryJobOptions = {}
): Promise<IndustryJobPage> {
	const query = options.includeCompleted ? '?include_completed=true' : '';
	return fetchJobPage(client, `/characters/${characterId}/industry/jobs${query}`, accessToken);
}

/** One page of `/corporations/{id}/industry/jobs` (scope `esi-industry.read_corporation_jobs.v1`, role Factory_Manager). */
export function fetchCorporationIndustryJobs(
	client: EsiClient,
	corporationId: number,
	accessToken: string,
	page: number,
	options: IndustryJobOptions = {}
): Promise<IndustryJobPage> {
	const query = options.includeCompleted ? `include_completed=true&page=${page}` : `page=${page}`;
	return fetchJobPage(client, `/corporations/${corporationId}/industry/jobs?${query}`, accessToken);
}

/** Job states that still hold the installed formula. */
const HOLDING_STATUSES: Partial<Record<IndustryJobStatus, true>> = {
	active: true,
	paused: true,
	ready: true
};

/**
 * Formulas installed in reaction jobs: every active, paused or ready reaction job whose formula is in
 * `relevant` counts that formula once, in bucket `jobs` at the job's station or structure. Pure; same
 * shape and order as `resolveInventory`.
 */
export function jobsInventory(
	jobs: readonly IndustryJobRow[],
	relevant: ReadonlySet<number>
): ResolvedInventory {
	const locations = new Map<number, ResolvedInventory['locations'][number]>();
	const items = new Map<string, InventoryItem>();
	for (const job of jobs) {
		if (!REACTION_ACTIVITY_IDS.has(job.activityId) || !HOLDING_STATUSES[job.status]) continue;
		if (!relevant.has(job.blueprintTypeId)) continue;
		const locationId = job.stationId;
		if (!locations.has(locationId))
			locations.set(locationId, { locationId, kind: isStationId(locationId) ? 'station' : 'structure' });
		const key = `${locationId}:${job.blueprintTypeId}`;
		const item = items.get(key);
		if (item) item.quantity += 1;
		else items.set(key, { locationId, bucket: 'jobs', typeId: job.blueprintTypeId, quantity: 1 });
	}
	return {
		locations: [...locations.values()].sort((a, b) => a.locationId - b.locationId),
		items: [...items.values()].sort((a, b) => a.locationId - b.locationId || a.typeId - b.typeId)
	};
}
