import { error, fail, type RequestEvent } from '@sveltejs/kit';
import type { JobActionResult, JobDetailData } from '$lib/jobs/types';
import { isTrackedJob, jobDetailPage } from '$lib/server/jobs';
import { TOO_MANY, profitsActionContext, throttled, typedValues } from '$lib/server/ledger-actions';
import {
	correctionNotice,
	parseCorrectionTarget,
	saveCorrection,
	undoCorrection,
	type CorrectionOutcome
} from '$lib/server/price-corrections';
import { profitsContext } from '$lib/server/profits-access';
import type { Actions, PageServerLoad } from './$types';

const UNKNOWN_INPUT = 'That price is not in your ledger.';

/**
 * Both actions correct an input of this job only (`job_input`, ref `job:<jobId>:<typeId>`), a job of a
 * connection with Profit tracking on. Anonymous visitors are sent to log in; without a tracking
 * connection there is nothing to correct (404).
 */
async function correction(event: RequestEvent, action: 'correct' | 'undo') {
	const { env, user } = await profitsActionContext(event);
	const form = await event.request.formData();
	const rawRef = form.get('ref');
	const ref = typeof rawRef === 'string' ? rawRef : '';
	const target = parseCorrectionTarget(form.get('kind'), rawRef);
	if (
		!target ||
		target.kind !== 'job_input' ||
		String(target.jobId) !== event.params.jobId ||
		!(await isTrackedJob(env, user.userId, target.jobId))
	) {
		return fail(404, { action, ref, error: UNKNOWN_INPUT } satisfies JobActionResult);
	}
	if (await throttled(env, user.userId)) {
		return fail(429, { action, ref, error: TOO_MANY } satisfies JobActionResult);
	}
	const outcome: CorrectionOutcome =
		action === 'correct'
			? await saveCorrection(env, user.userId, target, {
					unitPrice: form.get('unitPrice'),
					note: form.get('note')
				})
			: await undoCorrection(env, user.userId, target);
	if (!outcome.ok) {
		return fail(outcome.status, {
			action,
			ref,
			error: outcome.message,
			...(action === 'correct' && { values: typedValues(form) })
		} satisfies JobActionResult);
	}
	return {
		action,
		ref,
		notice: correctionNotice(action === 'correct' ? 'saved' : 'removed', outcome.rebuilt)
	} satisfies JobActionResult;
}

/**
 * The job page; `detail` is null when the visitor may not see profits (the layout shows the login /
 * switch-on message instead). Unknown jobs, other users' jobs and jobs of connections with Profit
 * tracking off are a 404.
 */
export const load: PageServerLoad = async (event): Promise<{ detail: JobDetailData | null }> => {
	const context = await profitsContext(event);
	if (!context) return { detail: null };
	const detail = await jobDetailPage(
		context.env,
		{ user: context.user, settings: event.locals.settings },
		Number(event.params.jobId)
	);
	if (!detail) error(404, 'Not Found');
	return { detail };
};

export const actions: Actions = {
	correct: (event) => correction(event, 'correct'),
	undo: (event) => correction(event, 'undo')
};
