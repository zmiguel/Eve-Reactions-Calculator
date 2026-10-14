import type { FetchFn } from './esi.ts';

export const JANICE_API_URL = 'https://janice.e-351.com/api/rest/v2';

/**
 * `janice.e-351.com/a/<code>` with or without scheme and `www.`; the lookbehind rejects other hosts
 * ending in the name (`notjanice.e-351.com`) and the name inside another URL's path.
 */
const JANICE_LINK = /(?<![\w.\-/@])(?:https?:\/\/)?(?:www\.)?janice\.e-351\.com\/a\/([A-Za-z0-9]+)/gi;

/** Appraisal codes linked in `text` (a contract title), distinct, in order of appearance. */
export function parseJaniceCodes(text: string | null | undefined): string[] {
	if (!text) return [];
	return [...new Set(Array.from(text.matchAll(JANICE_LINK), (m) => m[1]!))];
}

export interface JaniceAppraisalItem {
	typeId: number;
	name: string;
	amount: number;
	buyPrice: number;
	splitPrice: number;
	sellPrice: number;
}

/** A Janice appraisal with its effective unit prices. Dates are unix ms. */
export interface JaniceAppraisal {
	code: string;
	created: number;
	/** When the prices were taken. */
	datasetTime: number;
	marketId: number;
	marketName: string;
	/** `buy`, `split`, `sell` or `purchase`. */
	pricing: string;
	pricingVariant: string;
	/** Stored only: the item prices are not scaled by it. */
	pricePercentage: number | null;
	items: JaniceAppraisalItem[];
}

/** A Janice request is aborted after this long. */
export const JANICE_TIMEOUT_MS = 15_000;

export interface JaniceOptions {
	/** Empty or absent: no request is made. */
	apiKey: string | null | undefined;
	userAgent: string;
}

/**
 * `status`: the HTTP status of a non-2XX answer (404 for an unknown code), or 0 when nothing usable
 * came back (no API key, network failure or timeout, or a body that is not a valid appraisal).
 */
export type JaniceAppraisalResult = { ok: true; appraisal: JaniceAppraisal } | { ok: false; status: number };

/** The fields of a Janice appraisal body the ledger uses, before they are checked (`toAppraisal`). */
interface JaniceAppraisalBody {
	code?: unknown;
	created?: unknown;
	datasetTime?: unknown;
	market?: { id?: unknown; name?: unknown } | null;
	pricing?: unknown;
	pricingVariant?: unknown;
	pricePercentage?: unknown;
	items?: unknown;
}

interface JaniceItemBody {
	amount?: unknown;
	itemType?: { eid?: unknown; name?: unknown } | null;
	effectivePrices?: { buyPrice?: unknown; splitPrice?: unknown; sellPrice?: unknown } | null;
}

/** A finite number ≥ 0. */
const isAmount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A Janice date (ISO 8601) as unix ms; null when absent or unreadable. */
function parseDate(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/** One appraisal item with its effective unit prices; null unless every field is valid. */
function toItem(raw: unknown): JaniceAppraisalItem | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const { amount, itemType, effectivePrices } = raw as JaniceItemBody;
	if (typeof itemType !== 'object' || itemType === null) return null;
	if (typeof effectivePrices !== 'object' || effectivePrices === null) return null;
	const { eid, name } = itemType;
	const { buyPrice, splitPrice, sellPrice } = effectivePrices;
	if (typeof eid !== 'number' || !Number.isSafeInteger(eid) || eid <= 0) return null;
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
	if (!isAmount(buyPrice) || !isAmount(splitPrice) || !isAmount(sellPrice)) return null;
	return { typeId: eid, name: typeof name === 'string' ? name : '', amount, buyPrice, splitPrice, sellPrice };
}

/**
 * The appraisal of a Janice `GET /appraisal/{code}` body with its effective unit prices; null unless
 * every field the ledger uses is there: dates, market, pricing, and items with a positive integer
 * type id, a non-negative integer amount and finite prices ≥ 0.
 */
function toAppraisal(raw: unknown): JaniceAppraisal | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const body = raw as JaniceAppraisalBody;
	const { code, pricing, pricingVariant, pricePercentage, market } = body;
	const created = parseDate(body.created);
	const datasetTime = parseDate(body.datasetTime);
	if (typeof code !== 'string' || typeof pricing !== 'string' || typeof pricingVariant !== 'string')
		return null;
	if (created === null || datasetTime === null || !Array.isArray(body.items)) return null;
	if (typeof market !== 'object' || market === null) return null;
	if (typeof market.id !== 'number' || typeof market.name !== 'string') return null;
	if (pricePercentage != null && !isAmount(pricePercentage)) return null;
	const items: JaniceAppraisalItem[] = [];
	for (const entry of body.items as unknown[]) {
		const item = toItem(entry);
		if (!item) return null;
		items.push(item);
	}
	return {
		code,
		created,
		datasetTime,
		marketId: market.id,
		marketName: market.name,
		pricing,
		pricingVariant,
		pricePercentage: pricePercentage ?? null,
		items
	};
}

/**
 * `GET /appraisal/{code}`, aborted after `JANICE_TIMEOUT_MS`. Never throws: without an API key nothing
 * is requested; a non-2XX answer, a failed request or an invalid body is `{ ok: false }`
 * (`JaniceAppraisalResult`).
 */
export async function fetchJaniceAppraisal(
	fetch: FetchFn,
	{ apiKey, userAgent }: JaniceOptions,
	code: string
): Promise<JaniceAppraisalResult> {
	if (!apiKey) return { ok: false, status: 0 };
	try {
		const res = await fetch(`${JANICE_API_URL}/appraisal/${encodeURIComponent(code)}`, {
			headers: { 'X-ApiKey': apiKey, 'User-Agent': userAgent, Accept: 'application/json' },
			signal: AbortSignal.timeout(JANICE_TIMEOUT_MS)
		});
		if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status };
		const appraisal = toAppraisal(await res.json());
		return appraisal ? { ok: true, appraisal } : { ok: false, status: 0 };
	} catch {
		return { ok: false, status: 0 };
	}
}
