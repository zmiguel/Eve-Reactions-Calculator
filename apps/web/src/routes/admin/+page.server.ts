import { getCoreDb, jobRuns, latestPrices, marketHubs, sdeState } from '@reactions/db';
import { error, fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { and, asc, count, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { JOBS, type UpdaterAction } from '$lib/admin/jobs';
import {
	triggerUpdater,
	workflowStatuses,
	type UpdaterNotice,
	type WorkflowStatus
} from '$lib/server/updater';
import type { Actions, PageServerLoad } from './$types';

/** Runs per job kind (newest first) loaded for its history; the first one is the job's latest run. */
const HISTORY_RUNS = 25;

/** Admins only (a character in `ADMIN_CHARACTER_IDS`); everyone else gets a plain 404. */
function requireAdmin({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>): Env {
	if (!locals.user?.isAdmin || !platform) error(404, 'Not Found');
	return platform.env;
}

export const load: PageServerLoad = async (event) => {
	const env = requireAdmin(event);
	const db = getCoreDb(env.DB);
	const ranked = db
		.select({
			runId: jobRuns.runId,
			kind: jobRuns.kind,
			status: jobRuns.status,
			startedAt: jobRuns.startedAt,
			finishedAt: jobRuns.finishedAt,
			detailJson: jobRuns.detailJson,
			progressJson: jobRuns.progressJson,
			progressAt: jobRuns.progressAt,
			rank: sql<number>`row_number() over (partition by ${jobRuns.kind} order by ${jobRuns.startedAt} desc, ${jobRuns.runId} desc)`.as(
				'rank'
			)
		})
		.from(jobRuns)
		.as('ranked');
	const [runs, [sde], prices, hubErrors] = await Promise.all([
		// The `HISTORY_RUNS` newest runs (by `started_at`) of every kind, in one query.
		db
			.select({
				runId: ranked.runId,
				kind: ranked.kind,
				status: ranked.status,
				startedAt: ranked.startedAt,
				finishedAt: ranked.finishedAt,
				detailJson: ranked.detailJson,
				progressJson: ranked.progressJson,
				progressAt: ranked.progressAt
			})
			.from(ranked)
			.where(lte(ranked.rank, HISTORY_RUNS))
			.orderBy(asc(ranked.kind), desc(ranked.startedAt), desc(ranked.runId)),
		db
			.select({
				buildNumber: sdeState.buildNumber,
				releaseDate: sdeState.releaseDate,
				importedAt: sdeState.importedAt
			})
			.from(sdeState),
		db
			.select({ source: latestPrices.source, rows: count() })
			.from(latestPrices)
			.groupBy(latestPrices.source)
			.orderBy(asc(latestPrices.source)),
		db
			.select({
				hubId: marketHubs.hubId,
				name: marketHubs.name,
				lastError: marketHubs.lastError,
				lastSuccessAt: marketHubs.lastSuccessAt
			})
			.from(marketHubs)
			.where(and(eq(marketHubs.kind, 'structure'), isNotNull(marketHubs.lastError)))
			.orderBy(asc(marketHubs.name))
	]);
	// One RPC for the live instance status of every running workflow row loaded (latest or history).
	const workflowKinds = new Set(JOBS.filter((job) => job.workflow).map((job) => job.kind));
	const live: Record<string, WorkflowStatus | undefined> = await workflowStatuses(
		env,
		runs
			.filter((r) => r.status === 'running' && workflowKinds.has(r.kind))
			.map((r) => ({ kind: r.kind, runId: r.runId }))
	);
	return {
		now: Date.now(),
		// Every job of the registry, also those that never ran.
		jobs: JOBS.map((job) => ({
			...job,
			runs: runs.filter((r) => r.kind === job.kind).map((r) => ({ ...r, workflow: live[r.runId] ?? null }))
		})),
		sde: sde ?? null,
		prices,
		hubErrors
	};
};

/** Form action of one updater trigger: its notice, as a 503 failure when it did not start or failed. */
type TriggerAction = (
	event: RequestEvent
) => Promise<{ notice: UpdaterNotice } | ActionFailure<{ notice: UpdaterNotice }>>;

function run(action: UpdaterAction): TriggerAction {
	return async (event) => {
		const env = requireAdmin(event);
		const notice = await triggerUpdater(env, action, new Date().toISOString().slice(0, 10));
		return notice.ok ? { notice } : fail(503, { notice });
	};
}

/** `?/<action>` for every action of the job registry. */
export const actions = Object.fromEntries(
	JOBS.flatMap((job) => job.actions.map(({ action }) => [action, run(action)]))
) as Record<UpdaterAction, TriggerAction> satisfies Actions;
