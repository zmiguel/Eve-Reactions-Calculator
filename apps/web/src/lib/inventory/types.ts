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

/** A station or structure of a source holding relevant items (or selected). */
export interface InventoryPlaceView {
	locationId: number;
	kind: 'station' | 'structure' | 'unknown';
	/** Null for a structure the character cannot dock at: shown as "Structure <id>". */
	name: string | null;
	systemName: string | null;
	buckets: InventoryBucketView[];
}

export type InventorySourceStatus = 'pending' | 'running' | 'ok' | 'error' | 'denied';

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
	places: InventoryPlaceView[];
}

/** A character in a corporation source's reader pool. */
export interface InventoryReaderView {
	characterId: number;
	name: string;
}

/** One entry of the "Add inventory" select; `value` is `character:<characterId>` or `corporation:<characterId>`. */
export interface InventoryAddOption {
	value: string;
	label: string;
	/** A character whose corporation could not be looked up: listed, not selectable. */
	disabled?: boolean;
}

/** An `<optgroup>` of the "Add inventory" select. */
export interface InventoryAddGroup {
	label: 'Personal assets' | 'Corporation assets';
	options: InventoryAddOption[];
}

/** A character lacking a feature: "Allow" link to grant it. */
export interface InventoryAllowLink {
	characterId: number;
	characterName: string;
	feature: 'assets' | 'corp_assets';
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
	/** Why the summary is empty: no sources yet, or nothing selected / nothing found; null when it has items. */
	empty: 'no_sources' | 'no_selection' | null;
}

/** `/account/inventory` page data. */
export interface InventoryPageData {
	sources: InventorySourceView[];
	/** Non-empty groups only. */
	addGroups: InventoryAddGroup[];
	allowLinks: InventoryAllowLink[];
	/** `INVENTORY_SOURCE_LIMIT`. */
	limit: number;
	summary: InventorySummaryView;
	/** Some source is `running` or `pending`: the page refreshes itself every 10 s. */
	refreshing: boolean;
}

/**
 * Form actions of `/account/inventory` (all `POST`, work without JS):
 * - `?/add`: field `source` = an `InventoryAddOption.value`.
 * - `?/sync`: field `sourceId`.
 * - `?/remove`: field `sourceId`.
 * - `?/removeReader`: fields `sourceId`, `characterId` (a reader of a corporation source's pool).
 * - `?/select`: field `sourceId`, repeated field `place` = `<locationId>:<bucket>` (the checked buckets),
 *   optional `mode` = `all` | `none` (the "Select all" / "Select none" submit buttons; ignore `place`).
 * Results: `{ notice: { ok: boolean, text: string } }` or `fail(status, { error: string, allow?: InventoryAllowLink })`.
 */
export type InventoryAction = 'add' | 'sync' | 'remove' | 'removeReader' | 'select';
