import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { characters, getCoreDb, marketHubs, structureLinks, trackedTypeIds } from '@reactions/db';
import type { MarketHubRow } from '@reactions/db';
import {
	aggregateOrders,
	decryptToken,
	encryptToken,
	fetchRegionOrders,
	fetchStructureOrders,
	hasFeature,
	refreshAccessToken,
	SsoError,
	SsoInvalidGrantError,
	ssoCredentialsFor
} from '@reactions/eve';
import type { MarketOrder, OrderFilter } from '@reactions/eve';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DAY_MS } from '../dates.ts';
import { ESI_CONCURRENCY, PRICE_ARCHIVE_KEY, PRIVATE_HUB_ACTIVE_DAYS, STEP_CONFIG } from '../config.ts';
import { esiClient, httpFetch, userAgent } from '../http.ts';
import { errorMessage, failJobRun, finishJobRun, startJobRun } from '../jobs.ts';
import { publishMarketSnapshot } from '../market-snapshot.ts';
import { forEachConcurrent } from '../pool.ts';
import { StepTracker } from '../progress.ts';
import { fuzzworkRows, writePrices } from '../prices.ts';
import type { PriceCounts, PriceRow, PriceSource } from '../prices.ts';

export type PriceRefreshParams = Record<string, never>;

export interface PriceRefreshPlan {
	snapshotAt: number;
	regions: { regionId: number; hubIds: string[] }[];
	structureHubIds: string[];
}

export interface RegionCounts extends PriceCounts {
	regionId: number;
	types: number;
}

export interface StructureCounts extends PriceCounts {
	hubId: string;
	/** Where the prices came from; `null` when the hub kept its previous prices. */
	source: PriceSource | null;
	candidates: number;
}

export interface PublishCounts extends PriceCounts {
	status: 'ok' | 'partial';
	archived: number;
	bytes: number;
}

/** Step `plan`: NPC hubs grouped by region and the structure hubs due for a refresh. */
export async function planPriceRefresh(env: Env, now: number): Promise<PriceRefreshPlan> {
	const db = getCoreDb(env.DB);
	const activeSince = now - PRIVATE_HUB_ACTIVE_DAYS * DAY_MS;
	const hubs = await db
		.select({ hubId: marketHubs.hubId, kind: marketHubs.kind, regionId: marketHubs.regionId })
		.from(marketHubs)
		.where(
			and(
				eq(marketHubs.enabled, true),
				sql`(${marketHubs.kind} IN ('station', 'system') OR ${marketHubs.visibility} = 'public' OR EXISTS (
					SELECT 1 FROM structure_links l JOIN users u ON u.user_id = l.user_id
					WHERE l.structure_id = ${marketHubs.locationId} AND u.last_seen_at > ${activeSince}))`
			)
		)
		.orderBy(asc(marketHubs.regionId), asc(marketHubs.sortOrder), asc(marketHubs.hubId))
		.all();
	const regions = new Map<number, string[]>();
	const structureHubIds: string[] = [];
	for (const hub of hubs) {
		if (hub.kind === 'structure') structureHubIds.push(hub.hubId);
		else regions.set(hub.regionId, [...(regions.get(hub.regionId) ?? []), hub.hubId]);
	}
	return {
		snapshotAt: now,
		regions: [...regions].map(([regionId, hubIds]) => ({ regionId, hubIds })),
		structureHubIds
	};
}

/**
 * Step `region-<regionId>`: region orders of every tracked type (6 in flight), aggregated per hub
 * (station by `location_id`, system by `system_id`). Types that fail or are skipped once the ESI
 * guard trips come from Fuzzwork per hub.
 */
export async function refreshRegion(
	env: Env,
	regionId: number,
	hubIds: readonly string[],
	snapshotAt: number
): Promise<RegionCounts> {
	const db = getCoreDb(env.DB);
	const hubs = await db
		.select()
		.from(marketHubs)
		.where(inArray(marketHubs.hubId, [...hubIds]))
		.all();
	const typeIds = await trackedTypeIds(db);
	const client = esiClient(env);
	const rows: PriceRow[] = [];
	const fallback: number[] = [];
	await forEachConcurrent(typeIds, ESI_CONCURRENCY, async (typeId) => {
		if (client.guard.tripped()) {
			fallback.push(typeId);
			return;
		}
		let orders: MarketOrder[];
		try {
			const result = await fetchRegionOrders(client, regionId, typeId);
			if (!result.ok) throw new Error(`HTTP ${result.status}`);
			orders = result.items;
		} catch (error) {
			console.error(`[prices] region ${regionId} type ${typeId}: ${errorMessage(error)}`);
			fallback.push(typeId);
			return;
		}
		for (const hub of hubs) {
			const filter: OrderFilter =
				hub.kind === 'system'
					? { kind: 'system', systemId: hub.systemId }
					: { kind: 'station', locationId: hub.locationId };
			rows.push({ hubId: hub.hubId, typeId, source: 'esi', aggregate: aggregateOrders(orders, filter) });
		}
	});
	const esi = rows.length;
	fallback.sort((a, b) => a - b);
	for (const hub of hubs) rows.push(...(await fuzzworkRows(hub, fallback, userAgent(env))));
	await writePrices(env, rows, snapshotAt);
	return {
		regionId,
		types: typeIds.length,
		esi,
		fuzzwork: rows.length - esi,
		missing: hubs.length * typeIds.length - rows.length
	};
}

interface Candidate {
	userId: string;
	characterId: number;
	refreshTokenEnc: string | null;
	/** Client id of the SSO app that issued the token; `null` = the primary app. */
	ssoClientId: string | null;
}

type Attempt = { ok: true; orders: MarketOrder[] } | { ok: false; reason: string };

/**
 * Refreshes the candidate's token with the SSO app that issued it (storing the rotated one) and reads
 * the structure market. A token of an app without configured credentials is marked invalid
 * (`SSO_APP_UNKNOWN`).
 */
async function tryCandidate(env: Env, hub: MarketHubRow, candidate: Candidate): Promise<Attempt> {
	const db = getCoreDb(env.DB);
	const byCharacter = eq(characters.characterId, candidate.characterId);
	const label = `character ${candidate.characterId}`;
	let refreshToken: string;
	try {
		if (candidate.refreshTokenEnc === null) throw new Error('no stored refresh token');
		refreshToken = await decryptToken(candidate.refreshTokenEnc, env.TOKEN_ENCRYPTION_KEY);
	} catch (error) {
		const reason = `${label}: ${errorMessage(error)}`;
		await db.update(characters).set({ tokenStatus: 'invalid', lastError: reason }).where(byCharacter);
		return { ok: false, reason };
	}
	const app = ssoCredentialsFor(env, candidate.ssoClientId);
	if (!app.ok) {
		const reason = `${label}: ${app.message}`;
		await db
			.update(characters)
			.set(app.kind === 'unknown' ? { tokenStatus: 'invalid', lastError: reason } : { lastError: reason })
			.where(byCharacter);
		return { ok: false, reason };
	}
	let accessToken: string;
	try {
		const token = await refreshAccessToken({
			fetch: httpFetch,
			userAgent: userAgent(env),
			clientId: app.clientId,
			clientSecret: app.clientSecret,
			refreshToken
		});
		accessToken = token.accessToken;
		await db
			.update(characters)
			.set({
				refreshTokenEnc: await encryptToken(token.refreshToken || refreshToken, env.TOKEN_ENCRYPTION_KEY),
				lastRefreshedAt: Date.now(),
				lastError: null
			})
			.where(byCharacter);
	} catch (error) {
		const reason = `${label}: ${errorMessage(error)}`;
		const invalid =
			error instanceof SsoInvalidGrantError || (error instanceof SsoError && error.status === 401);
		await db
			.update(characters)
			.set(invalid ? { tokenStatus: 'invalid', lastError: reason } : { lastError: reason })
			.where(byCharacter);
		return { ok: false, reason };
	}
	try {
		const result = await fetchStructureOrders(esiClient(env), hub.locationId, accessToken);
		if (result.ok) return { ok: true, orders: result.items };
		if (result.status === 403)
			await db
				.update(structureLinks)
				.set({ accessStatus: 'denied' })
				.where(
					and(eq(structureLinks.userId, candidate.userId), eq(structureLinks.structureId, hub.locationId))
				);
		return { ok: false, reason: `${label}: structure market HTTP ${result.status}` };
	} catch (error) {
		return { ok: false, reason: `${label}: ${errorMessage(error)}` };
	}
}

/**
 * Step `structure-<hubId>`: tries linked characters (valid token with every structure-market scope, link
 * not denied, most recently refreshed first) until one can read the structure market. When all fail,
 * public hubs fall back to Fuzzwork and private hubs keep their previous prices; the hub's `last_error`
 * records why.
 */
export async function refreshStructureHub(
	env: Env,
	hubId: string,
	snapshotAt: number
): Promise<StructureCounts> {
	const db = getCoreDb(env.DB);
	const hub = await db.select().from(marketHubs).where(eq(marketHubs.hubId, hubId)).get();
	// Removed (last link gone, admin delete) since the plan step: nothing to refresh, not a failure.
	if (!hub) return { hubId, candidates: 0, source: null, esi: 0, fuzzwork: 0, missing: 0 };
	const typeIds = await trackedTypeIds(db);
	const linked = await db
		.select({
			userId: structureLinks.userId,
			characterId: characters.characterId,
			refreshTokenEnc: characters.refreshTokenEnc,
			ssoClientId: characters.ssoClientId,
			scopes: characters.scopes
		})
		.from(structureLinks)
		.innerJoin(characters, eq(characters.characterId, structureLinks.characterId))
		.where(
			and(
				eq(structureLinks.structureId, hub.locationId),
				eq(structureLinks.accessStatus, 'ok'),
				eq(characters.tokenStatus, 'ok')
			)
		)
		.orderBy(desc(characters.lastRefreshedAt), asc(characters.characterId))
		.all();
	const candidates = linked.filter((c) => hasFeature(c.scopes, 'structures'));
	const counts = { hubId, candidates: candidates.length };
	const byHub = eq(marketHubs.hubId, hubId);

	const reasons: string[] = [];
	for (const candidate of candidates) {
		const attempt = await tryCandidate(env, hub, candidate);
		if (!attempt.ok) {
			reasons.push(attempt.reason);
			continue;
		}
		const byType = new Map<number, MarketOrder[]>(typeIds.map((t) => [t, []]));
		for (const order of attempt.orders) byType.get(order.typeId)?.push(order);
		const filter: OrderFilter = { kind: 'structure', locationId: hub.locationId };
		const rows = [...byType].map(([typeId, orders]): PriceRow => ({
			hubId,
			typeId,
			source: 'esi_structure',
			aggregate: aggregateOrders(orders, filter)
		}));
		await writePrices(env, rows, snapshotAt);
		await db.update(marketHubs).set({ lastSuccessAt: Date.now(), lastError: null }).where(byHub);
		return { ...counts, source: 'esi_structure', esi: rows.length, fuzzwork: 0, missing: 0 };
	}

	const reason = reasons.length > 0 ? reasons.join('; ') : 'no linked character with a valid token';
	await db.update(marketHubs).set({ lastError: reason }).where(byHub);
	if (hub.visibility !== 'public')
		return { ...counts, source: null, esi: 0, fuzzwork: 0, missing: typeIds.length };
	const rows = await fuzzworkRows(hub, typeIds, userAgent(env));
	await writePrices(env, rows, snapshotAt);
	return {
		...counts,
		source: rows.length > 0 ? 'fuzzwork' : null,
		esi: 0,
		fuzzwork: rows.length,
		missing: typeIds.length - rows.length
	};
}

async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Step `publish`: KV `market:v1`, every row of this refresh gzipped to R2
 * `prices/raw/YYYY/MM/DD/<snapshotAt>.json.gz`, `job_runs` → `ok` (or `partial` when any price came
 * from Fuzzwork or is missing).
 */
export async function publishPrices(
	env: Env,
	runId: string,
	snapshotAt: number,
	steps: readonly PriceCounts[]
): Promise<PublishCounts> {
	await publishMarketSnapshot(env);
	const { results } = await env.HISTORY_DB.prepare(
		`SELECT snapshot_at AS snapshotAt, hub_id AS hubId, type_id AS typeId, buy_max AS buyMax,
			sell_min AS sellMin, buy_p5 AS buyP5, sell_p5 AS sellP5, buy_volume AS buyVolume,
			sell_volume AS sellVolume, source
		FROM price_snapshots WHERE snapshot_at = ? ORDER BY hub_id, type_id`
	)
		.bind(snapshotAt)
		.all();
	const body = await gzip(JSON.stringify(results));
	await env.ARCHIVE.put(PRICE_ARCHIVE_KEY(snapshotAt), body, {
		httpMetadata: { contentType: 'application/gzip' }
	});
	const sum = (key: keyof PriceCounts) => steps.reduce((total, s) => total + s[key], 0);
	const totals = { esi: sum('esi'), fuzzwork: sum('fuzzwork'), missing: sum('missing') };
	const status = totals.fuzzwork + totals.missing > 0 ? 'partial' : 'ok';
	const counts: PublishCounts = { status, ...totals, archived: results.length, bytes: body.byteLength };
	await finishJobRun(env, runId, status, { snapshotAt, ...counts, steps: steps.length });
	return counts;
}

/**
 * Refreshes every hub's prices: instance `prices-<slot ms>` (cron) or `prices-manual-<ms>` (RPC).
 * Step results are counts only; prices travel through D1.
 */
export class PriceRefreshWorkflow extends WorkflowEntrypoint<Env, PriceRefreshParams> {
	override async run(
		event: Readonly<WorkflowEvent<PriceRefreshParams>>,
		step: WorkflowStep
	): Promise<PublishCounts> {
		const runId = event.instanceId;
		const startedAt = event.timestamp.getTime();
		await startJobRun(this.env, runId, 'prices', startedAt);
		const steps = new StepTracker(this.env, step, runId);
		try {
			const plan = await steps.do('plan', STEP_CONFIG, () => planPriceRefresh(this.env, Date.now()));
			steps.total = 1 + plan.regions.length + plan.structureHubIds.length + 1;
			const counts: PriceCounts[] = [];
			for (const { regionId, hubIds } of plan.regions)
				counts.push(
					await steps.do(`region-${regionId}`, STEP_CONFIG, () =>
						refreshRegion(this.env, regionId, hubIds, plan.snapshotAt)
					)
				);
			for (const hubId of plan.structureHubIds)
				counts.push(
					await steps.do(`structure-${hubId}`, STEP_CONFIG, () =>
						refreshStructureHub(this.env, hubId, plan.snapshotAt)
					)
				);
			return await steps.do('publish', STEP_CONFIG, () =>
				publishPrices(this.env, runId, plan.snapshotAt, counts)
			);
		} catch (error) {
			await failJobRun(this.env, runId, 'prices', startedAt, error);
			throw error;
		}
	}
}
