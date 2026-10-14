import type { InventoryBucket } from '@reactions/eve';

/** One hangar bucket of a place, with what the last sync found in it. */
export interface InventoryBucketView {
	bucket: InventoryBucket;
	/** "Hangar", "Deliveries", or for corporations the division name or "Division N". */
	label: string;
	selected: boolean;
	/** Distinct formula types in the bucket. */
	formulas: number;
	/** Distinct material types (everything that is not a formula) in the bucket. */
	materials: number;
}

/** A station or structure of a connection holding relevant items (or selected). */
export interface InventoryPlaceView {
	locationId: number;
	kind: 'station' | 'structure' | 'unknown';
	/** Null for a structure the character cannot dock at: shown as "Structure <id>". */
	name: string | null;
	systemName: string | null;
	buckets: InventoryBucketView[];
}

export type InventorySourceStatus = 'pending' | 'running' | 'ok' | 'error' | 'denied';

/** A connection's identity, reader pool and inventory sync: a character (personal) or a corporation. */
export interface InventorySourceView {
	sourceId: number;
	kind: 'character' | 'corporation';
	/** Character name (personal) or corporation name. */
	ownerName: string;
	/** The preferred reader: the character whose token last read the assets. */
	characterId: number;
	characterName: string;
	/**
	 * Corporation sources: the other characters the user added as readers (the pool), tried in the order
	 * they were added when the preferred reader fails.
	 */
	otherReaders: InventoryReaderView[];
	status: InventorySourceStatus;
	lastError: string | null;
	lastSyncedAt: number | null;
	/** ESI `Last-Modified` of the synced data. */
	dataAsOf: number | null;
}

/** `tracking_streams.status`; a stream without a row yet is `pending`. */
export type TrackingStreamStatus = 'pending' | 'ok' | 'error' | 'denied';

/** One line of a connection's profit tracking stream list. */
export interface TrackingStreamView {
	/**
	 * `jobs`, `transactions`, `journal`, `orders`, `contracts`, or `wallet:<n>` for corporation wallet
	 * division n (its `transactions:<n>` and `journal:<n>` streams combined).
	 */
	key: string;
	/** "Jobs", "Wallet transactions", ..., or the wallet division's name ("Division n" without one). */
	label: string;
	/** Combined streams: `denied` over `error` over `pending` over `ok`. */
	status: TrackingStreamStatus;
	/** A denied stream's sentence ("<Character> needs the Accountant role"); null otherwise. */
	lastError: string | null;
}

/** A corporation wallet division on the wallet divisions form. */
export interface WalletDivisionView {
	division: number;
	/** The division's name from ESI, else "Division n". */
	name: string;
	/** Counted by profit tracking. */
	counted: boolean;
}

/** The Profit tracking part of a connection. */
export interface TrackingView {
	enabled: boolean;
	/** Null until tracking first ran. */
	status: InventorySourceStatus | null;
	lastError: string | null;
	syncedAt: number | null;
	streams: TrackingStreamView[];
	/** Corporations: divisions 1 to 7; personal connections: empty. */
	walletDivisions: WalletDivisionView[];
}

/** A connection on `/account/connections`: its Inventory switch and its Profit tracking part. */
export interface ConnectionView extends InventorySourceView {
	inventoryEnabled: boolean;
	tracking: TrackingView;
}

/** A connection's places on `/account/inventory`. */
export interface InventorySourcePlacesView extends Pick<
	InventorySourceView,
	'sourceId' | 'kind' | 'ownerName' | 'characterName' | 'status' | 'lastSyncedAt'
> {
	places: InventoryPlaceView[];
}

/** A character in a corporation source's reader pool. */
export interface InventoryReaderView {
	characterId: number;
	name: string;
}

/** One entry of the "Add a connection" select; `value` is `character:<characterId>` or `corporation:<characterId>`. */
export interface InventoryAddOption {
	value: string;
	label: string;
	/** A character whose corporation could not be looked up: listed, not selectable. */
	disabled?: boolean;
}

/** An `<optgroup>` of the "Add a connection" select. */
export interface InventoryAddGroup {
	label: 'Characters' | 'Corporations';
	options: InventoryAddOption[];
}

/** A feature a connection's switch needs: Inventory → (corporation) assets, Profit tracking → (corporation) tracking. */
export type ConnectionFeature = 'assets' | 'corp_assets' | 'tracking' | 'corp_tracking';

/** A character lacking a feature: "Allow" link to grant it. */
export interface InventoryAllowLink {
	characterId: number;
	characterName: string;
	feature: ConnectionFeature;
	href: string;
}

export type InventoryRole = 'fuel' | 'raw' | 'intermediate' | 'product';

export interface InventoryMaterialView {
	typeId: number;
	name: string;
	quantity: number;
	/** Net realisable value per unit at the output side; null when unpriced. */
	unitValue: number | null;
	/** `quantity × unitValue`; null when unpriced. */
	value: number | null;
	/**
	 * What the ledger says was paid (profit tracking): the average unit cost of the type's remaining FIFO
	 * lots and how many of `quantity` that covers (the rest is "unknown"); null when no lot holds any.
	 */
	paid: { unitCost: number; covered: number } | null;
}

export interface InventoryFormulaView {
	blueprintTypeId: number;
	name: string;
	count: number;
	/** Place names holding it ("Jita IV - Moon 4 - Caldari Navy Assembly Plant · Hangar"). */
	places: string[];
}

/** "What you have": selected places only. */
export interface InventorySummaryView {
	formulas: InventoryFormulaView[];
	materials: Record<InventoryRole, InventoryMaterialView[]>;
	/** Sum of the priced material values. */
	totalValue: number;
	/** The user has a profit tracking ledger: the "Paid" column is shown. */
	showPaid: boolean;
	/** Why the summary is empty: no connection with Inventory on, or nothing selected / nothing found; null when it has items. */
	empty: 'no_sources' | 'no_selection' | null;
}

/** `/account/connections` page data. */
export interface ConnectionsPageData {
	sources: ConnectionView[];
	/** Non-empty groups only. */
	addGroups: InventoryAddGroup[];
	/** Every feature a connection may need that a character lacks (in character order). */
	allowLinks: InventoryAllowLink[];
	/** `INVENTORY_SOURCE_LIMIT`. */
	limit: number;
	/** Some switched-on sync is `running` or `pending`: the page refreshes itself every 10 s. */
	refreshing: boolean;
}

/** `/account/inventory` page data. */
export interface InventoryPageData {
	/** Connections with Inventory on only. */
	sources: InventorySourcePlacesView[];
	summary: InventorySummaryView;
	/** Some connection is `running` or `pending`: the page refreshes itself every 10 s. */
	refreshing: boolean;
}

/**
 * Form actions of `/account/connections` (all `POST`, work without JS):
 * - `?/add`: field `source` = an `InventoryAddOption.value`.
 * - `?/sync`: field `sourceId` (inventory sync).
 * - `?/syncTracking`: field `sourceId` (profit tracking sync).
 * - `?/switch`: fields `sourceId`, `feature` = `inventory` | `tracking`, `on` = `1` | `0`.
 * - `?/walletDivisions`: field `sourceId`, repeated field `division` = 1 to 7 (the counted ones).
 * - `?/remove`: field `sourceId`.
 * - `?/removeReader`: fields `sourceId`, `characterId` (a reader of a corporation connection's pool).
 * Form action of `/account/inventory`:
 * - `?/select`: field `sourceId`, repeated field `place` = `<locationId>:<bucket>` (the checked buckets),
 *   optional `mode` = `all` | `none` (the "Select all" / "Select none" submit buttons; ignore `place`).
 * Results: `{ notice: { ok: boolean, text: string } }` or `fail(status, { error: string, allow?: InventoryAllowLink })`.
 */
export type ConnectionAction =
	'add' | 'sync' | 'syncTracking' | 'switch' | 'walletDivisions' | 'remove' | 'removeReader';
export type InventoryAction = 'select';
