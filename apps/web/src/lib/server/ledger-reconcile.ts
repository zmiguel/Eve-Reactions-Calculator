import type {
	ReconcileContractRow,
	ReconcileCounts,
	ReconcileInputRow,
	ReconcilePageData
} from '#lib/ledger/types.js';
import { paginate, type Paged } from '#lib/paging.js';
import { getDataset } from './data.ts';
import { ledgerJobName, ledgerJobSql, materialBlueprintIds } from './ledger-item.ts';
import { requestLedgerRebuild } from './ledger-rebuild.ts';
import { saveCorrection, type CorrectionOutcome } from './price-corrections.ts';

/** Note of a correction made by "Use buy value": the estimate is kept as the confirmed price. */
export const CONFIRMED_NOTE = 'Buy value at job start, confirmed';

/**
 * Job inputs the rebuild had no purchase for (`ledger_lots` origin `market`, ref `job:<id>`) of the
 * user's reaction and fuel block jobs (`?1`; `?2` = `materialBlueprintIds`) on connections with Profit
 * tracking on, with the user's saved price when the ledger was not recalculated since.
 */
const INPUTS = `SELECT l.type_id, CAST(substr(l.origin_ref, 5) AS INTEGER) AS job_id, SUM(l.quantity) AS quantity,
		MAX(l.unit_cost) AS unit_cost, MAX(l.price_source) AS price_source, j.blueprint_type_id, j.start_date,
		pc.unit_price AS saved_price, pc.note AS saved_note, pc.target_ref AS saved_ref
	FROM ledger_lots l
	JOIN tracked_jobs j ON j.user_id = l.user_id AND j.job_id = CAST(substr(l.origin_ref, 5) AS INTEGER)
		AND ${ledgerJobSql('j', '?2')}
	JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = l.user_id AND s.tracking_enabled = 1
	LEFT JOIN price_corrections pc ON pc.user_id = l.user_id AND pc.target_kind = 'job_input'
		AND pc.target_ref = l.origin_ref || ':' || l.type_id
	WHERE l.user_id = ?1 AND l.origin = 'market' AND l.origin_ref GLOB 'job:*'
	GROUP BY l.origin_ref, l.type_id`;

/** Contract items needing review, of tracking-on connections, newest first. */
const CONTRACTS = `SELECT c.contract_id, lp.type_id, lp.incoming, lp.quantity, lp.at, lp.unit_price, lp.source_text,
		c.title, pc.unit_price AS saved_price, pc.note AS saved_note, pc.target_ref AS saved_ref
	FROM ledger_prices lp
	JOIN tracked_contracts c ON c.user_id = lp.user_id AND lp.ref = 'contract:' || c.contract_id
	JOIN inventory_sources s ON s.source_id = c.source_id AND s.user_id = lp.user_id AND s.tracking_enabled = 1
	LEFT JOIN price_corrections pc ON pc.user_id = lp.user_id AND pc.target_kind = 'contract_item'
		AND pc.target_ref = lp.ref || ':' || lp.type_id
	WHERE lp.user_id = ?1 AND lp.ref GLOB 'contract:*' AND lp.needs_review = 1
	ORDER BY lp.at DESC, c.contract_id DESC, lp.incoming DESC, lp.type_id`;

/**
 * "Use buy value for all" of item `?2`: a correction equal to the estimate (note `?3`, time `?4`) for each
 * of the item's estimated inputs (`?5` = `materialBlueprintIds`); inputs the user already saved a price
 * for keep it.
 */
const CONFIRM_ALL = `INSERT INTO price_corrections (user_id, target_kind, target_ref, unit_price, note, created_at)
	SELECT l.user_id, 'job_input', l.origin_ref || ':' || l.type_id, MAX(l.unit_cost), ?3, ?4
	FROM ledger_lots l
	JOIN tracked_jobs j ON j.user_id = l.user_id AND j.job_id = CAST(substr(l.origin_ref, 5) AS INTEGER)
		AND ${ledgerJobSql('j', '?5')}
	JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = l.user_id AND s.tracking_enabled = 1
	WHERE l.user_id = ?1 AND l.type_id = ?2 AND l.origin = 'market' AND l.origin_ref GLOB 'job:*'
		AND l.unit_cost > 0
	GROUP BY l.origin_ref, l.type_id
	ON CONFLICT (user_id, target_kind, target_ref) DO NOTHING`;

interface Saved {
	saved_price: number | null;
	saved_note: string | null;
	saved_ref: string | null;
}

interface InputRow extends Saved {
	type_id: number;
	job_id: number;
	quantity: number;
	unit_cost: number;
	price_source: string;
	blueprint_type_id: number;
	start_date: number;
}

interface ContractRow extends Saved {
	contract_id: number;
	type_id: number;
	incoming: number;
	quantity: number;
	at: number;
	unit_price: number;
	source_text: string;
	title: string | null;
}

/** A job input row before paging (the item heading fields are added per page). */
type LoadedInput = Omit<ReconcileInputRow, 'first' | 'itemRows' | 'itemQuantity' | 'itemConfirmable'>;

interface Loaded {
	inputs: LoadedInput[];
	contracts: ReconcileContractRow[];
}

/** Every reconcile row of the user (inputs by item name then job start, contracts newest first). */
async function loadAll(env: Pick<Env, 'DB' | 'CACHE'>, userId: string): Promise<Loaded> {
	const db = env.DB;
	// Plain statements, not a batch: the ledger page runs this next to its own batch.
	const dataset = await getDataset(env);
	const [inputsRes, contractsRes] = await Promise.all([
		db.prepare(INPUTS).bind(userId, materialBlueprintIds(dataset)).all<InputRow>(),
		db.prepare(CONTRACTS).bind(userId).all<ContractRow>()
	]);
	const inputs = inputsRes.results
		.map((r): LoadedInput => {
			const name = ledgerJobName(dataset, r.blueprint_type_id);
			return {
				ref: `job:${r.job_id}:${r.type_id}`,
				item: {
					typeId: r.type_id,
					name: dataset?.types[r.type_id]?.name ?? `Type ${r.type_id}`,
					formula: false
				},
				jobId: r.job_id,
				formula: name ? { blueprintTypeId: r.blueprint_type_id, name } : null,
				startedAt: r.start_date,
				quantity: r.quantity,
				estimate: r.unit_cost > 0 ? r.unit_cost : null,
				estimateText: r.price_source,
				saved: r.saved_ref === null ? null : { unitPrice: r.saved_price ?? 0, note: r.saved_note }
			};
		})
		.sort(
			(a, b) =>
				a.item.name.localeCompare(b.item.name) ||
				a.item.typeId - b.item.typeId ||
				a.startedAt - b.startedAt ||
				a.jobId - b.jobId
		);
	const contracts = contractsRes.results.map((r): ReconcileContractRow => ({
		ref: `contract:${r.contract_id}:${r.type_id}`,
		item: {
			typeId: r.type_id,
			name: dataset?.types[r.type_id]?.name ?? `Type ${r.type_id}`,
			formula: false
		},
		contractId: r.contract_id,
		at: r.at,
		title: r.title || null,
		incoming: Boolean(r.incoming),
		quantity: r.quantity,
		unitPrice: r.unit_price,
		sourceText: r.source_text,
		saved: r.saved_ref === null ? null : { unitPrice: r.saved_price ?? 0, note: r.saved_note }
	}));
	return { inputs, contracts };
}

/** One page of `inputs` with the item headings: totals per item over every page, `first` per page. */
function pageInputs(inputs: LoadedInput[], page: number): Paged<ReconcileInputRow> {
	const totals = new Map<number, { rows: number; quantity: number; confirmable: number }>();
	for (const r of inputs) {
		const t = totals.get(r.item.typeId) ?? { rows: 0, quantity: 0, confirmable: 0 };
		t.rows++;
		t.quantity += r.quantity;
		if (r.estimate !== null && !r.saved) t.confirmable++;
		totals.set(r.item.typeId, t);
	}
	const paged = paginate(inputs, page);
	return {
		...paged,
		rows: paged.rows.map((r, i): ReconcileInputRow => {
			const t = totals.get(r.item.typeId)!;
			return {
				...r,
				first: i === 0 || paged.rows[i - 1].item.typeId !== r.item.typeId,
				itemRows: t.rows,
				itemQuantity: t.quantity,
				itemConfirmable: t.confirmable
			};
		})
	};
}

function countsOf(all: Loaded): ReconcileCounts {
	const open = all.inputs.filter((r) => !r.saved);
	const estimated = open.filter((r) => r.estimate !== null).length;
	const unpriced = open.length - estimated;
	const contracts = all.contracts.filter((r) => !r.saved).length;
	return {
		estimated,
		unpriced,
		items: new Set(open.map((r) => r.item.typeId)).size,
		contracts,
		total: estimated + unpriced + contracts
	};
}

/** One page of the job inputs without a purchase (the reconcile page and `/profits/data/reconcile-inputs`). */
export async function reconcileInputs(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	page: number
): Promise<Paged<ReconcileInputRow>> {
	return pageInputs((await loadAll(env, userId)).inputs, page);
}

/** One page of the contract items needing review (the reconcile page and `/profits/data/reconcile-contracts`). */
export async function reconcileContracts(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	page: number
): Promise<Paged<ReconcileContractRow>> {
	return paginate((await loadAll(env, userId)).contracts, page);
}

/** What `/profits/ledger/reconcile` still asks for (the ledger's "Missing prices (N)"). */
export async function reconcileCounts(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string
): Promise<ReconcileCounts> {
	return countsOf(await loadAll(env, userId));
}

/** The `/profits/ledger/reconcile` page: counts, one page of each list and the recalculation state. */
export async function reconcilePage(
	env: Pick<Env, 'DB' | 'CACHE'>,
	userId: string,
	pages: { inputs: number; contracts: number }
): Promise<ReconcilePageData> {
	const [all, state] = await Promise.all([
		loadAll(env, userId),
		env.DB.prepare('SELECT dirty FROM ledger_state WHERE user_id = ?1')
			.bind(userId)
			.first<{ dirty: number }>()
	]);
	return {
		counts: countsOf(all),
		inputs: pageInputs(all.inputs, pages.inputs),
		contracts: paginate(all.contracts, pages.contracts),
		dirty: Boolean(state?.dirty)
	};
}

/** Page data while the profits layout shows its login / enable message instead of the page. */
export function emptyReconcilePage(): ReconcilePageData {
	return {
		counts: { estimated: 0, unpriced: 0, items: 0, contracts: 0, total: 0 },
		inputs: paginate([], 1),
		contracts: paginate([], 1),
		dirty: false
	};
}

const NOT_FOUND = 'That price is not in your ledger.';

/**
 * "Use buy value": stores the estimate of the user's job input (`jobId`, `typeId`) as their price with
 * `CONFIRMED_NOTE`, so it is no longer an estimate, and asks for a rebuild. 404 when the input has no
 * estimate in the ledger; 400 when there was no buy value to use.
 */
export async function confirmBuyValue(
	env: Env,
	userId: string,
	target: { jobId: number; typeId: number }
): Promise<CorrectionOutcome> {
	const lot = await env.DB.prepare(
		`SELECT MAX(l.unit_cost) AS unit_cost FROM ledger_lots l
		JOIN tracked_jobs j ON j.user_id = l.user_id AND j.job_id = ?2 AND ${ledgerJobSql('j', '?5')}
		JOIN inventory_sources s ON s.source_id = j.source_id AND s.user_id = l.user_id AND s.tracking_enabled = 1
		WHERE l.user_id = ?1 AND l.origin = 'market' AND l.origin_ref = ?4 AND l.type_id = ?3`
	)
		.bind(
			userId,
			target.jobId,
			target.typeId,
			`job:${target.jobId}`,
			materialBlueprintIds(await getDataset(env))
		)
		.first<{ unit_cost: number | null }>();
	if (lot?.unit_cost == null) return { ok: false, status: 404, message: NOT_FOUND };
	if (lot.unit_cost <= 0) {
		return { ok: false, status: 400, message: 'There is no buy value to use: enter a unit price.' };
	}
	return saveCorrection(
		env,
		userId,
		{ kind: 'job_input', ...target },
		{ unitPrice: String(lot.unit_cost), note: CONFIRMED_NOTE }
	);
}

/**
 * "Use buy value for all" of item `typeId`: confirms every estimated input of it at once (inputs with a
 * saved price keep theirs) and asks for one rebuild. 404 when nothing was left to confirm.
 */
export async function confirmAllBuyValues(
	env: Env,
	userId: string,
	typeId: number,
	now = Date.now()
): Promise<{ ok: true; count: number; rebuilt: boolean } | { ok: false; status: 404; message: string }> {
	const result = await env.DB.prepare(CONFIRM_ALL)
		.bind(userId, typeId, CONFIRMED_NOTE, now, materialBlueprintIds(await getDataset(env)))
		.run();
	const count = result.meta.changes ?? 0;
	if (count === 0)
		return { ok: false, status: 404, message: 'There is no buy value left to use for this item.' };
	return { ok: true, count, ...(await requestLedgerRebuild(env, userId)) };
}
