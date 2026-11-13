import type { FakeD1 } from './fakes.ts';

/** One refresh's `price_snapshots` row of a (hub, type) pair. */
export interface SnapshotRow {
	at: number;
	hubId: string;
	typeId: number;
	buy: number | null;
	sell: number | null;
	buyVolume?: number;
	sellVolume?: number;
}

const DAY_MS = 86_400_000;

/**
 * The rows the updater keeps of dense refreshes: a pair's first row of each UTC day and afterwards only
 * rows whose values differ from the pair's previous row.
 */
export function changeOnly(rows: readonly SnapshotRow[]): SnapshotRow[] {
	const previous = new Map<string, SnapshotRow>();
	const kept: SnapshotRow[] = [];
	for (const r of [...rows].sort((a, b) => a.at - b.at)) {
		const pair = `${r.hubId}\u0000${r.typeId}`;
		const prev = previous.get(pair);
		previous.set(pair, r);
		const unchanged =
			prev !== undefined &&
			Math.floor(prev.at / DAY_MS) === Math.floor(r.at / DAY_MS) &&
			prev.buy === r.buy &&
			prev.sell === r.sell &&
			(prev.buyVolume ?? 1) === (r.buyVolume ?? 1) &&
			(prev.sellVolume ?? 1) === (r.sellVolume ?? 1);
		if (!unchanged) kept.push(r);
	}
	return kept;
}

export function insertSnapshots(db: FakeD1, rows: readonly SnapshotRow[]) {
	const insert = db.sqlite.prepare(
		`INSERT INTO price_snapshots (snapshot_at, hub_id, type_id, buy_max, sell_min, buy_p5, sell_p5, buy_volume, sell_volume, source)
		VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'esi')`
	);
	for (const r of rows)
		insert.run(r.at, r.hubId, r.typeId, r.buy, r.sell, r.buyVolume ?? 1, r.sellVolume ?? 1);
}
