import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { MIRROR_HISTORY_START, fetchMirrorTypeHistory } from '@reactions/eve';
import { BACKFILL_TYPES_PER_STEP, MIRROR_CONCURRENCY, STEP_CONFIG } from '../config.ts';
import { utcDate } from '../dates.ts';
import { httpFetch, userAgent } from '../http.ts';
import { errorMessage, failJobRun, finishJobRun, startJobRun } from '../jobs.ts';
import { forEachConcurrent } from '../pool.ts';
import { StepTracker } from '../progress.ts';
import { HISTORY_SQL, historyRows, historyTypeIds, planDaily, recomputeMarketStats } from './daily.ts';

export interface BackfillChunk {
	types: number;
	/** Region/type histories replaced. */
	series: number;
	rows: number;
	failed: number;
}

export interface BackfillResult {
	status: 'ok' | 'partial';
	regions: number;
	types: number;
	series: number;
	rows: number;
	failed: number;
	stats: number;
}

/**
 * Replaces the stored `esi_market_history` of `typeIds` in `regionIds` with the market.coalition.space
 * mirror (one request per type covers every region, days from `MIRROR_HISTORY_START` up to `today`).
 * Per region/type only the dates the mirror returned are replaced; regions the mirror has no data for
 * keep their rows (the daily ESI job keeps filling them).
 */
export async function backfillTypes(
	env: Env,
	regionIds: number[],
	typeIds: number[],
	today: string,
	fetchFn = httpFetch
): Promise<BackfillChunk> {
	const regions = new Set(regionIds);
	let series = 0;
	const ua = userAgent(env);
	let rows = 0;
	let failed = 0;
	await forEachConcurrent(typeIds, MIRROR_CONCURRENCY, async (typeId) => {
		let history;
		try {
			history = await fetchMirrorTypeHistory(fetchFn, ua, typeId, MIRROR_HISTORY_START, today);
		} catch (error) {
			console.error(`[history-backfill] type ${typeId}: ${errorMessage(error)}`);
			failed++;
			return;
		}
		const statements: D1PreparedStatement[] = [];
		for (const { regionId, days } of history) {
			if (!regions.has(regionId) || days.length === 0) continue;
			const dates = days.map((d) => d.date).sort();
			statements.push(
				env.HISTORY_DB.prepare(
					'DELETE FROM esi_market_history WHERE region_id = ? AND type_id = ? AND date >= ? AND date <= ?'
				).bind(regionId, typeId, dates[0], dates.at(-1)),
				env.HISTORY_DB.prepare(HISTORY_SQL).bind(JSON.stringify(historyRows(regionId, typeId, days)))
			);
			series++;
			rows += days.length;
		}
		if (statements.length > 0) await env.HISTORY_DB.batch(statements);
	});
	return { types: typeIds.length, series, rows, failed };
}

/** One-off import of older market history (admin): instance `history-backfill-manual-<ms>`. */
export class HistoryBackfillWorkflow extends WorkflowEntrypoint<Env, Record<string, never>> {
	override async run(
		event: Readonly<WorkflowEvent<Record<string, never>>>,
		step: WorkflowStep
	): Promise<BackfillResult> {
		const runId = event.instanceId;
		const startedAt = event.timestamp.getTime();
		const env = this.env;
		await startJobRun(env, runId, 'history', startedAt);
		const steps = new StepTracker(env, step, runId);
		try {
			const today = utcDate(startedAt);
			const { regionIds, typeIds } = await steps.do('plan', STEP_CONFIG, async () => ({
				...(await planDaily(env)),
				typeIds: await historyTypeIds(env)
			}));
			steps.total = 1 + Math.ceil(typeIds.length / BACKFILL_TYPES_PER_STEP) + regionIds.length;
			const chunks: BackfillChunk[] = [];
			for (let i = 0; i < typeIds.length; i += BACKFILL_TYPES_PER_STEP) {
				const slice = typeIds.slice(i, i + BACKFILL_TYPES_PER_STEP);
				chunks.push(
					await steps.do(`types-${i / BACKFILL_TYPES_PER_STEP}`, STEP_CONFIG, () =>
						backfillTypes(env, regionIds, slice, today)
					)
				);
			}
			let stats = 0;
			for (const regionId of regionIds)
				stats += await steps.do(`stats-${regionId}`, STEP_CONFIG, () =>
					recomputeMarketStats(env, regionId, Date.now())
				);
			const sum = (key: keyof BackfillChunk) => chunks.reduce((a, c) => a + c[key], 0);
			const result: BackfillResult = {
				status: sum('failed') > 0 ? 'partial' : 'ok',
				regions: regionIds.length,
				types: typeIds.length,
				series: sum('series'),
				rows: sum('rows'),
				failed: sum('failed'),
				stats
			};
			await finishJobRun(env, runId, result.status, result);
			return result;
		} catch (error) {
			await failJobRun(env, runId, 'history', startedAt, error);
			throw error;
		}
	}
}
