import { getCoreDb, inventorySources, trackingStreams, type InventorySourceRow } from '@reactions/db';
import type { FetchFn } from '@reactions/eve';
import { and, eq, inArray } from 'drizzle-orm';
import { FEATURE_LABELS } from '#lib/account/features.js';
import type {
	ConnectionFeature,
	ConnectionsPageData,
	ConnectionView,
	InventoryAllowLink,
	InventorySourceStatus,
	TrackingStreamStatus,
	TrackingStreamView,
	TrackingView,
	WalletDivisionView
} from '#lib/inventory/types.js';
import { listCharacters } from './auth/accounts.ts';
import {
	INVENTORY_SOURCE_LIMIT,
	SWITCH_FEATURES,
	SYNC_UNAVAILABLE,
	canRead,
	connectionAddGroups,
	connectionAllowLink,
	getSource,
	listSources,
	notBeforeNotice,
	parseDivisionNames,
	poolsOf,
	requestInventorySync,
	resolveCorporations,
	type ConnectionSwitch,
	type InventorySourceKind,
	type InventorySourceListing,
	type SyncRequest
} from './inventory.ts';
import { requestLedgerRebuild } from './ledger-rebuild.ts';
import type { UpdaterApi, UpdaterNotice } from './updater.ts';

/** Every feature a connection's switches may need, in Allow link order. */
const CONNECTION_FEATURES: readonly ConnectionFeature[] = [
	'assets',
	'corp_assets',
	'tracking',
	'corp_tracking'
];

/** Wallet divisions of a corporation. */
const WALLET_DIVISIONS = [1, 2, 3, 4, 5, 6, 7];

const NOT_YOURS = 'That connection is not on your list.';

const STREAM_LABELS: Record<string, string> = {
	jobs: 'Jobs',
	transactions: 'Wallet transactions',
	journal: 'Wallet journal',
	orders: 'Orders',
	contracts: 'Contracts',
	blueprints: 'Blueprints'
};

/** Worst first: a combined line shows its worst stream. */
const STREAM_RANK: Record<TrackingStreamStatus, number> = { ok: 0, pending: 1, error: 2, denied: 3 };

const SYNCING: readonly (string | null)[] = ['pending', 'running'];

/**
 * The corporation wallet divisions a connection counts: `wallet_divisions_json` (`[1,3]`); null or
 * unreadable = every division (the updater's `walletDivisions`).
 */
function countedWalletDivisions(json: string | null): number[] {
	if (json === null) return WALLET_DIVISIONS;
	try {
		const parsed: unknown = JSON.parse(json);
		return Array.isArray(parsed) ? WALLET_DIVISIONS.filter((d) => parsed.includes(d)) : WALLET_DIVISIONS;
	} catch {
		return WALLET_DIVISIONS;
	}
}

interface StoredStream {
	stream: string;
	status: TrackingStreamStatus;
	lastError: string | null;
}

/** One stream line from the stored rows of `streams` (a missing row is `pending`): the worst of them. */
function streamLine(
	key: string,
	label: string,
	streams: readonly string[],
	stored: ReadonlyMap<string, StoredStream>
): TrackingStreamView {
	let worst: Omit<StoredStream, 'stream'> = { status: 'ok', lastError: null };
	for (const name of streams) {
		const row = stored.get(name) ?? { status: 'pending', lastError: null };
		if (STREAM_RANK[row.status] > STREAM_RANK[worst.status]) worst = row;
	}
	return { key, label, status: worst.status, lastError: worst.status === 'denied' ? worst.lastError : null };
}

/**
 * The Profit tracking part of each of the account's connections `sources` (same order): status, stream
 * lines (personal: Jobs, Wallet transactions, Wallet journal, Orders, Contracts; corporations: Jobs, one
 * line per counted wallet division, Orders, Contracts) from `tracking_streams`, and the corporation
 * wallet divisions with their names.
 */
export async function trackingViews(
	env: Env,
	userId: string,
	sources: readonly InventorySourceListing[]
): Promise<TrackingView[]> {
	const rows =
		sources.length === 0
			? []
			: await getCoreDb(env.DB)
					.select({
						sourceId: trackingStreams.sourceId,
						stream: trackingStreams.stream,
						status: trackingStreams.status,
						lastError: trackingStreams.lastError
					})
					.from(trackingStreams)
					.where(
						and(
							eq(trackingStreams.userId, userId),
							inArray(
								trackingStreams.sourceId,
								sources.map((s) => s.sourceId)
							)
						)
					);
	return sources.map((s): TrackingView => {
		const stored = new Map(rows.filter((r) => r.sourceId === s.sourceId).map((r) => [r.stream, r]));
		const line = (key: string) => streamLine(key, STREAM_LABELS[key]!, [key], stored);
		let streams: TrackingStreamView[];
		let walletDivisions: WalletDivisionView[] = [];
		if (s.kind === 'corporation') {
			const names = parseDivisionNames(s.walletNamesJson);
			const counted = countedWalletDivisions(s.walletDivisionsJson);
			walletDivisions = WALLET_DIVISIONS.map((division) => ({
				division,
				name: names[division] ?? `Division ${division}`,
				counted: counted.includes(division)
			}));
			streams = [
				line('jobs'),
				...walletDivisions
					.filter((d) => d.counted)
					.map((d) =>
						streamLine(
							`wallet:${d.division}`,
							d.name,
							[`transactions:${d.division}`, `journal:${d.division}`],
							stored
						)
					),
				line('orders'),
				line('contracts')
			];
		} else streams = ['jobs', 'transactions', 'journal', 'orders', 'contracts'].map(line);
		// The updater reads blueprints (for the ME of manufacturing jobs) only once one is needed: a line
		// only when that stream exists.
		if (stored.has('blueprints')) streams.push(line('blueprints'));
		return {
			enabled: s.trackingEnabled,
			status: s.trackingStatus as InventorySourceStatus | null,
			lastError: s.trackingLastError,
			syncedAt: s.trackingSyncedAt,
			streams,
			walletDivisions
		};
	});
}

/**
 * `/account/connections` page data: connections (stale runs settled) with their reader pools, both
 * switches and the Profit tracking part, the add options (characters that can read a corporation but
 * have no known corporation are looked up on public ESI first, `resolveCorporations`) and an Allow link
 * for every feature a character lacks.
 */
export async function connectionsPage(
	env: Env,
	fetch: FetchFn,
	userId: string,
	now = Date.now()
): Promise<ConnectionsPageData> {
	const [characterRows, sources] = await Promise.all([
		listCharacters(env, userId),
		listSources(env, userId, now)
	]);
	const corporationSourceIds = sources.filter((s) => s.kind === 'corporation').map((s) => s.sourceId);
	const [rows, pools, tracking] = await Promise.all([
		resolveCorporations(env, fetch, characterRows, now),
		corporationSourceIds.length === 0 ? [] : poolsOf(env, userId, corporationSourceIds),
		trackingViews(env, userId, sources)
	]);
	const views = sources.map((s, i): ConnectionView => ({
		sourceId: s.sourceId,
		kind: s.kind as InventorySourceKind,
		ownerName: s.ownerName,
		characterId: s.characterId,
		characterName: s.characterName,
		otherReaders: pools
			.filter((p) => p.sourceId === s.sourceId && p.characterId !== s.characterId)
			.map((p) => ({ characterId: p.characterId, name: p.name })),
		status: s.status as InventorySourceStatus,
		lastError: s.lastError,
		lastSyncedAt: s.lastSyncedAt,
		dataAsOf: s.dataAsOf,
		inventoryEnabled: s.inventoryEnabled,
		tracking: tracking[i]!
	}));
	return {
		sources: views,
		addGroups: connectionAddGroups(rows, sources, pools, sources.length >= INVENTORY_SOURCE_LIMIT),
		allowLinks: rows.flatMap((c) =>
			CONNECTION_FEATURES.filter((f) => !canRead(c, f)).map((f) => connectionAllowLink(c, f))
		),
		limit: INVENTORY_SOURCE_LIMIT,
		refreshing: sources.some(
			(s) =>
				(s.inventoryEnabled && SYNCING.includes(s.status)) ||
				(s.trackingEnabled && SYNCING.includes(s.trackingStatus))
		)
	};
}

/**
 * Asks the updater to sync the profit tracking of `source` now (`UPDATER.triggerTrackingSync`). A
 * connection with Profit tracking off is refused with a notice; while every stream's ESI data is fresh
 * the updater answers `notBefore`. A sync already running, a missing binding or an updater that does not
 * answer become notices instead of a 500.
 */
export async function requestTrackingSync(
	env: Env,
	source: Pick<InventorySourceRow, 'sourceId' | 'ownerName' | 'trackingEnabled'>,
	now = Date.now()
): Promise<SyncRequest> {
	if (!source.trackingEnabled) {
		return {
			started: false,
			notice: { ok: false, text: `Profit tracking is off for ${source.ownerName}. Switch it on first.` }
		};
	}
	// `wrangler types` declares the binding as an untyped `Service`; its RPC surface is `UpdaterApi`.
	const updater = env.UPDATER as unknown as UpdaterApi | undefined;
	if (!updater) {
		console.error('UPDATER binding missing: tracking sync not started');
		return { started: false, notice: { ok: false, text: SYNC_UNAVAILABLE } };
	}
	try {
		const result = await updater.triggerTrackingSync(source.sourceId);
		if ('busy' in result) {
			return {
				started: false,
				notice: { ok: false, text: 'A profit tracking sync of this connection is already running.' }
			};
		}
		if ('notBefore' in result) return notBeforeNotice(source.ownerName, result.notBefore, now);
		return { started: true, notice: { ok: true, text: 'Sync started.' } };
	} catch (e) {
		console.error('UPDATER.triggerTrackingSync failed', e);
		return { started: false, notice: { ok: false, text: SYNC_UNAVAILABLE } };
	}
}

export type ConnectionOutcome =
	| { ok: true; notice: UpdaterNotice }
	| { ok: false; status: 400 | 404; message: string; allow?: InventoryAllowLink };

/**
 * Turns a switch of the account's connection `sourceId` on or off. On needs the switch's feature on a
 * reader (personal: the character; corporation: a member of its reader pool), else a 400 with the Allow
 * link of the preferred reader. Inventory on starts an inventory sync; Profit tracking on starts a
 * tracking sync (and asks for a ledger rebuild when none started, so kept data counts again), off asks
 * for a ledger rebuild. Off keeps the synced data; switching on again resumes from it.
 */
export async function setSwitch(
	env: Env,
	userId: string,
	sourceId: number,
	which: ConnectionSwitch,
	on: boolean,
	now = Date.now()
): Promise<ConnectionOutcome> {
	const source = await getSource(env, userId, sourceId);
	if (!source) return { ok: false, status: 404, message: NOT_YOURS };
	const kind = source.kind as InventorySourceKind;
	const owner = source.ownerName;
	if (on) {
		const feature = SWITCH_FEATURES[which][kind];
		const [characters, pool] = await Promise.all([
			listCharacters(env, userId),
			kind === 'corporation' ? poolsOf(env, userId, [sourceId]) : []
		]);
		const readers = kind === 'corporation' ? pool.map((p) => p.characterId) : [source.characterId];
		if (!characters.some((c) => readers.includes(c.characterId) && canRead(c, feature))) {
			const preferred = characters.find((c) => c.characterId === source.characterId);
			const label = FEATURE_LABELS[feature].toLowerCase();
			return preferred
				? {
						ok: false,
						status: 400,
						message: `Allow ${label} for ${preferred.name} first.`,
						allow: connectionAllowLink(preferred, feature)
					}
				: { ok: false, status: 400, message: `No character reading ${owner} allows ${label}.` };
		}
	}
	const db = getCoreDb(env.DB);
	const mine = and(eq(inventorySources.sourceId, sourceId), eq(inventorySources.userId, userId));
	if (which === 'inventory') {
		await db.update(inventorySources).set({ inventoryEnabled: on }).where(mine);
		if (!on) {
			return {
				ok: true,
				notice: {
					ok: true,
					text: `Inventory is off for ${owner}. Its assets are kept but not used until you switch it on again.`
				}
			};
		}
		const sync = await requestInventorySync(env, { ...source, inventoryEnabled: true }, now);
		return {
			ok: true,
			notice: {
				ok: sync.started,
				text: `Inventory is on for ${owner}. ${sync.started ? 'Sync started.' : sync.notice.text}`
			}
		};
	}
	// A connection whose tracking never ran waits for its first sync.
	const firstRun = on && source.trackingStatus === null;
	await db
		.update(inventorySources)
		.set(firstRun ? { trackingEnabled: on, trackingStatus: 'pending' } : { trackingEnabled: on })
		.where(mine);
	if (!on) {
		await requestLedgerRebuild(env, userId);
		return {
			ok: true,
			notice: {
				ok: true,
				text: `Profit tracking is off for ${owner}. Its data is kept but not counted until you switch it on again.`
			}
		};
	}
	const sync = await requestTrackingSync(env, { ...source, trackingEnabled: true }, now);
	if (!sync.started) await requestLedgerRebuild(env, userId);
	return {
		ok: true,
		notice: {
			ok: sync.started,
			text: `Profit tracking is on for ${owner}. ${sync.started ? 'Sync started.' : sync.notice.text}`
		}
	};
}

/**
 * Stores the wallet divisions (1 to 7) profit tracking counts for the account's corporation connection
 * `sourceId`: every division → null (also the ones that appear later), none → 400. With Profit tracking
 * on, the ledger is rebuilt (rows of divisions no longer counted drop out).
 */
export async function saveWalletDivisions(
	env: Env,
	userId: string,
	sourceId: number,
	divisions: readonly number[]
): Promise<ConnectionOutcome> {
	const source = await getSource(env, userId, sourceId);
	if (!source) return { ok: false, status: 404, message: NOT_YOURS };
	if (source.kind !== 'corporation') {
		return { ok: false, status: 400, message: 'Only corporation connections have wallet divisions.' };
	}
	if (divisions.some((d) => !WALLET_DIVISIONS.includes(d))) {
		return { ok: false, status: 400, message: 'Pick wallet divisions 1 to 7.' };
	}
	const counted = WALLET_DIVISIONS.filter((d) => divisions.includes(d));
	if (counted.length === 0) {
		return { ok: false, status: 400, message: 'Tick at least one wallet division.' };
	}
	await getCoreDb(env.DB)
		.update(inventorySources)
		.set({
			walletDivisionsJson: counted.length === WALLET_DIVISIONS.length ? null : JSON.stringify(counted)
		})
		.where(and(eq(inventorySources.sourceId, sourceId), eq(inventorySources.userId, userId)));
	if (source.trackingEnabled) await requestLedgerRebuild(env, userId);
	return { ok: true, notice: { ok: true, text: `Wallet divisions of ${source.ownerName} saved.` } };
}
