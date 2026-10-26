import type { Dataset } from '@reactions/engine';
import { formatNumber } from '#lib/format.js';
import type {
	ManualEntryView,
	ManualImportError,
	ManualImportPreview,
	ManualImportRow,
	ManualItemChoice
} from '#lib/ledger/types.js';
import { PAGE_SIZE, type Paged } from '#lib/paging.js';
import { getDataset } from './data.ts';
import { requestLedgerRebuild } from './ledger-rebuild.ts';
import { MAX_CORRECTION_PRICE, MAX_NOTE_LENGTH } from './price-corrections.ts';

/** Purchases one form submit may add. */
export const MAX_ENTRIES_PER_SUBMIT = 500;
/** Purchases one user may have entered in all. */
export const MAX_ENTRIES_PER_USER = 5000;
export const MAX_QUANTITY = 1e12;
export const MAX_UNIT_PRICE = MAX_CORRECTION_PRICE;
/** No purchase is older than EVE Online (released 2003). */
export const EARLIEST_DATE = Date.UTC(2003, 0, 1);

/** A purchase to store: acquired at `at` (unix ms). */
export interface ManualEntryInput {
	at: number;
	typeId: number;
	quantity: number;
	unitPrice: number;
	note?: string | null;
}

export type ManualOutcome =
	{ ok: true; added: number; rebuilt: boolean } | { ok: false; status: 400 | 404; message: string };

export const MESSAGES = {
	date: 'Enter the date as YYYY-MM-DD or YYYY-MM-DD HH:MM (UTC).',
	future: 'The date is in the future.',
	early: 'The date is before 2003.',
	item: 'Pick an item from the list.',
	quantity: `Enter a quantity from 1 to ${formatNumber(MAX_QUANTITY)} (whole units).`,
	price: `Enter a unit price from 0 to ${formatNumber(MAX_UNIT_PRICE)} ISK.`,
	note: `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
	shape: 'Expected a date, an item, a quantity and a unit price.',
	none: 'There is nothing to add.',
	tooMany: `At most ${MAX_ENTRIES_PER_SUBMIT} purchases at a time: split the list.`,
	full: `You can enter at most ${formatNumber(MAX_ENTRIES_PER_USER)} purchases in all: delete some you no longer need first.`
} as const;

const DATE =
	/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
/** A time token after the date token of an import line (`12:30`, `12:30:05`, `12:30Z`). */
const TIME = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Reads a date: ISO 8601 (`2026-10-01`, `2026-10-01T12:30:00Z`, with an offset) or `YYYY-MM-DD HH:MM`
 * (dots or slashes also separate the date, as in EVE's `2026.10.01 12:30`). Without an offset the
 * time is UTC (EVE time), without a time it is midnight UTC. Null when unreadable or not a real date.
 */
export function parseManualDate(text: string): number | null {
	const m = DATE.exec(text.trim());
	if (!m) return null;
	const [year, month, day, hour, minute, second] = m.slice(1, 7).map((v) => (v ? Number(v) : 0));
	if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
	const utc = Date.UTC(year, month - 1, day, hour, minute, second);
	if (new Date(utc).getUTCDate() !== day) return null;
	const zone = m[7]?.toUpperCase();
	if (!zone || zone === 'Z') return utc;
	const sign = zone.startsWith('-') ? -1 : 1;
	const digits = zone.slice(1).replace(':', '');
	const offset = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
	return utc - sign * offset * 60_000;
}

/** The message for a date outside what a purchase may have, else null. */
function dateProblem(at: number, now: number): string | null {
	if (!Number.isFinite(at)) return MESSAGES.date;
	if (at > now) return MESSAGES.future;
	if (at < EARLIEST_DATE) return MESSAGES.early;
	return null;
}

const AMOUNT = /^(\d{1,3}(?:[,\s\u00a0\u202f]\d{3})+|\d+)(\.\d+)?$/;

/**
 * Reads an amount: digits with an optional dot decimal part and optional thousands separators
 * (commas or spaces: `1,234.5`, `1 234.5`), an optional trailing `ISK`. Null when unreadable.
 */
export function parseAmount(text: string): number | null {
	const t = text
		.trim()
		.replace(/\s*isk$/i, '')
		.trim();
	if (!AMOUNT.test(t)) return null;
	const n = Number(t.replace(/[,\s\u00a0\u202f]/g, ''));
	return Number.isFinite(n) ? n : null;
}

const quantityOk = (n: number | null): n is number =>
	n !== null && Number.isSafeInteger(n) && n >= 1 && n <= MAX_QUANTITY;
const priceOk = (n: number | null): n is number =>
	n !== null && Number.isFinite(n) && n >= 0 && n <= MAX_UNIT_PRICE;

const formulaIds = (dataset: Dataset) => new Set(dataset.reactions.map((r) => r.blueprintTypeId));

/** Whether `typeId` may be bought: a dataset type that is not a reaction formula. */
export function isPurchasable(dataset: Dataset, typeId: number): boolean {
	return (
		Number.isSafeInteger(typeId) && dataset.types[typeId] !== undefined && !formulaIds(dataset).has(typeId)
	);
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Lower-cased type name (single spaces) → type id, formulas left out. */
export function typesByName(dataset: Dataset): Map<string, number> {
	const formulas = formulaIds(dataset);
	const map = new Map<string, number>();
	for (const t of Object.values(dataset.types)) {
		if (!formulas.has(t.typeId)) map.set(normalizeName(t.name), t.typeId);
	}
	return map;
}

/**
 * The item choices of the purchase form: the dataset's types except formulas, reaction materials first,
 * then reaction products, then the rest, each group by name.
 */
export function itemChoices(dataset: Dataset): ManualItemChoice[] {
	const formulas = formulaIds(dataset);
	const materials = new Set(dataset.reactions.flatMap((r) => r.materials.map((m) => m.typeId)));
	const products = new Set(dataset.reactions.map((r) => r.product.typeId));
	const order = { material: 0, product: 1, other: 2 } as const;
	return Object.values(dataset.types)
		.filter((t) => !formulas.has(t.typeId))
		.map((t): ManualItemChoice => ({
			typeId: t.typeId,
			name: t.name,
			group: materials.has(t.typeId) ? 'material' : products.has(t.typeId) ? 'product' : 'other'
		}))
		.sort((a, b) => order[a.group] - order[b.group] || a.name.localeCompare(b.name) || a.typeId - b.typeId);
}

/**
 * The type of the purchase form: the picked `typeId` when it still names the typed item, else the type
 * whose name is the typed text (case-insensitive). Null when neither is a purchasable type.
 */
export function resolveItem(dataset: Dataset, typeIdField: unknown, itemField: unknown): number | null {
	const text = typeof itemField === 'string' ? normalizeName(itemField) : '';
	const picked = typeof typeIdField === 'string' && /^\d+$/.test(typeIdField) ? Number(typeIdField) : null;
	if (picked !== null && isPurchasable(dataset, picked)) {
		if (text === '' || normalizeName(dataset.types[picked].name) === text) return picked;
	}
	return text ? (typesByName(dataset).get(text) ?? null) : null;
}

/** The single purchase form's fields, checked: the entry to store or the first problem. */
export function readManualForm(
	dataset: Dataset,
	fields: {
		item: unknown;
		typeId: unknown;
		date: unknown;
		quantity: unknown;
		unitPrice: unknown;
		note: unknown;
	},
	now = Date.now()
): { entry: ManualEntryInput } | { error: string } {
	const typeId = resolveItem(dataset, fields.typeId, fields.item);
	if (typeId === null) return { error: MESSAGES.item };
	const at = typeof fields.date === 'string' ? parseManualDate(fields.date) : null;
	if (at === null) return { error: MESSAGES.date };
	const problem = dateProblem(at, now);
	if (problem) return { error: problem };
	const quantity = typeof fields.quantity === 'string' ? parseAmount(fields.quantity) : null;
	if (!quantityOk(quantity)) return { error: MESSAGES.quantity };
	const unitPrice = typeof fields.unitPrice === 'string' ? parseAmount(fields.unitPrice) : null;
	if (!priceOk(unitPrice)) return { error: MESSAGES.price };
	const note = typeof fields.note === 'string' ? fields.note.trim() : '';
	if (note.length > MAX_NOTE_LENGTH) return { error: MESSAGES.note };
	return { entry: { at, typeId, quantity, unitPrice, note: note || null } };
}

/**
 * Reads pasted purchases, one per non-empty line: `<date> <item> <quantity> <unit price>`. Fields are
 * separated by tabs (spreadsheets) or else by spaces; the date may be followed by a time token, the item
 * is everything between the date and the last two fields, the unit price may end with `ISK`. Items match
 * a type name exactly (case-insensitive). Each line either becomes a row or an error with its line
 * number; lines after the first `MAX_ENTRIES_PER_SUBMIT` purchases are reported, not read.
 */
export function parseManualImport(text: string, dataset: Dataset, now = Date.now()): ManualImportPreview {
	const names = typesByName(dataset);
	const rows: ManualImportRow[] = [];
	const errors: ManualImportError[] = [];
	const lines = text.split(/\r\n|\r|\n/);
	let read = 0;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw.trim() === '') continue;
		const line = i + 1;
		if (read === MAX_ENTRIES_PER_SUBMIT) {
			errors.push({ line, message: MESSAGES.tooMany });
			break;
		}
		read++;
		const tokens = (raw.includes('\t') ? raw.split('\t') : raw.trim().split(/\s+/))
			.map((t) => t.trim())
			.filter((t) => t !== '');
		if (tokens.length > 1 && /^isk$/i.test(tokens[tokens.length - 1])) tokens.pop();
		if (tokens.length > 1 && TIME.test(tokens[1])) tokens.splice(0, 2, `${tokens[0]} ${tokens[1]}`);
		if (tokens.length < 4) {
			errors.push({ line, message: MESSAGES.shape });
			continue;
		}
		const at = parseManualDate(tokens[0]);
		const name = tokens.slice(1, -2).join(' ').replace(/\s+/g, ' ');
		const typeId = names.get(name.toLowerCase());
		const quantity = parseAmount(tokens[tokens.length - 2]);
		const unitPrice = parseAmount(tokens[tokens.length - 1]);
		const problem =
			at === null
				? MESSAGES.date
				: (dateProblem(at, now) ??
					(typeId === undefined
						? `Unknown item "${name}".`
						: !quantityOk(quantity)
							? MESSAGES.quantity
							: !priceOk(unitPrice)
								? MESSAGES.price
								: null));
		if (problem || at === null || typeId === undefined || quantity === null || unitPrice === null) {
			errors.push({ line, message: problem ?? MESSAGES.shape });
			continue;
		}
		rows.push({ line, at, typeId, name: dataset.types[typeId].name, quantity, unitPrice });
	}
	return { rows, errors };
}

/**
 * Stores `rows` as the user's purchases and asks for a ledger rebuild. Every row is checked again
 * (purchasable type, date from 2003 to now, quantity, unit price, note); one bad row rejects all, and
 * so do rows that would take the user over `MAX_ENTRIES_PER_USER`.
 */
export async function addManualEntries(
	env: Env,
	userId: string,
	rows: readonly ManualEntryInput[],
	now = Date.now()
): Promise<ManualOutcome> {
	if (rows.length === 0) return { ok: false, status: 400, message: MESSAGES.none };
	if (rows.length > MAX_ENTRIES_PER_SUBMIT) return { ok: false, status: 400, message: MESSAGES.tooMany };
	const dataset = await getDataset(env);
	if (!dataset)
		return { ok: false, status: 400, message: 'Item data is not available right now. Try again later.' };
	const formulas = formulaIds(dataset);
	for (const r of rows) {
		const problem =
			!Number.isSafeInteger(r.typeId) || !dataset.types[r.typeId] || formulas.has(r.typeId)
				? MESSAGES.item
				: (dateProblem(r.at, now) ??
					(!quantityOk(r.quantity)
						? MESSAGES.quantity
						: !priceOk(r.unitPrice)
							? MESSAGES.price
							: (r.note ?? '').length > MAX_NOTE_LENGTH
								? MESSAGES.note
								: null));
		if (problem) return { ok: false, status: 400, message: problem };
	}
	const payload = JSON.stringify(
		rows.map((r) => ({ at: r.at, t: r.typeId, q: r.quantity, p: r.unitPrice, n: r.note?.trim() || null }))
	);
	// The limit is checked in the insert itself, so two submits at once cannot pass it together.
	const inserted = await env.DB.prepare(
		`INSERT INTO manual_entries (user_id, date, type_id, quantity, unit_price, note, created_at)
		SELECT ?1, json_extract(j.value, '$.at'), json_extract(j.value, '$.t'), json_extract(j.value, '$.q'),
			json_extract(j.value, '$.p'), json_extract(j.value, '$.n'), ?3
		FROM json_each(?2) j
		WHERE (SELECT COUNT(*) FROM manual_entries WHERE user_id = ?1) + json_array_length(?2) <= ?4
		ORDER BY j.key`
	)
		.bind(userId, payload, now, MAX_ENTRIES_PER_USER)
		.run();
	if (!inserted.meta.changes) return { ok: false, status: 400, message: MESSAGES.full };
	return { ok: true, added: rows.length, ...(await requestLedgerRebuild(env, userId)) };
}

/** Removes one of the user's purchases (404 when it is not theirs) and asks for a ledger rebuild. */
export async function deleteManualEntry(env: Env, userId: string, entryId: number): Promise<ManualOutcome> {
	if (!Number.isSafeInteger(entryId) || entryId <= 0) {
		return { ok: false, status: 404, message: 'That purchase is not in your list.' };
	}
	const result = await env.DB.prepare('DELETE FROM manual_entries WHERE user_id = ?1 AND entry_id = ?2')
		.bind(userId, entryId)
		.run();
	if (!result.meta.changes) return { ok: false, status: 404, message: 'That purchase is not in your list.' };
	return { ok: true, added: 0, ...(await requestLedgerRebuild(env, userId)) };
}

interface EntryRow {
	entry_id: number;
	date: number;
	type_id: number;
	quantity: number;
	unit_price: number;
	note: string | null;
	remaining: number | null;
}

/**
 * One page (`PAGE_SIZE`, newest date first, clamped to the last page) of the user's purchases, each with
 * what is left of its batch (null until the ledger is recalculated): the list on "Add purchases" and
 * its endpoint `/profits/data/manual-entries`.
 */
export async function listManualEntries(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	page: number
): Promise<Paged<ManualEntryView>> {
	const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM manual_entries WHERE user_id = ?1')
		.bind(userId)
		.first<{ n: number }>();
	const total = count?.n ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
	if (total === 0) return { rows: [], page: current, pageCount, total };
	const [result, dataset] = await Promise.all([
		env.DB.prepare(
			`SELECT m.entry_id, m.date, m.type_id, m.quantity, m.unit_price, m.note,
				(SELECT SUM(l.remaining) FROM ledger_lots l WHERE l.user_id = m.user_id AND l.origin = 'manual'
					AND l.origin_ref = 'manual:' || m.entry_id) AS remaining
			FROM manual_entries m WHERE m.user_id = ?1
			ORDER BY m.date DESC, m.entry_id DESC LIMIT ?2 OFFSET ?3`
		)
			.bind(userId, PAGE_SIZE, (current - 1) * PAGE_SIZE)
			.all<EntryRow>(),
		getDataset(env)
	]);
	return {
		rows: result.results.map((r): ManualEntryView => ({
			entryId: r.entry_id,
			at: r.date,
			typeId: r.type_id,
			name: dataset?.types[r.type_id]?.name ?? `Type ${r.type_id}`,
			formula: false,
			quantity: r.quantity,
			unitPrice: r.unit_price,
			total: r.unit_price * r.quantity,
			note: r.note,
			remaining: r.remaining
		})),
		page: current,
		pageCount,
		total
	};
}

/** Notice after purchases were added or removed (the ledger may only be recalculated at the next tick). */
export function manualNotice(what: string, rebuilt: boolean): string {
	return rebuilt ? `${what} Results recalculated.` : `${what} Results are recalculated within 10 minutes.`;
}
