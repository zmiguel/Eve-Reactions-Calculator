import { fail } from '@sveltejs/kit';
import { formatNumber } from '#lib/format.js';
import type { ReconcileActionResult, ReconcilePageData } from '#lib/ledger/types.js';
import { pageParam } from '#lib/paging.js';
import { TOO_MANY, correctionAction, profitsActionContext, throttled } from '#lib/server/ledger-actions.js';
import {
	confirmAllBuyValues,
	confirmBuyValue,
	emptyReconcilePage,
	reconcilePage
} from '#lib/server/ledger-reconcile.js';
import { correctionNotice, parseCorrectionTarget } from '#lib/server/price-corrections.js';
import { profitsContext } from '#lib/server/profits-access.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event): Promise<ReconcilePageData> => {
	const context = await profitsContext(event);
	if (!context) return emptyReconcilePage();
	return reconcilePage(context.env, context.user.userId, {
		inputs: pageParam(event.url, 'inputs'),
		contracts: pageParam(event.url, 'contracts')
	});
};

export const actions: Actions = {
	/** A unit price for a job input or a contract item (fields `kind`, `ref`, `unitPrice`, `note`). */
	correct: (event) => correctionAction(event, 'correct', ['job_input', 'contract_item']),

	/** "Use buy value": the estimate of one job input becomes the user's price (field `ref`). */
	confirm: async (event) => {
		const { env, user } = await profitsActionContext(event);
		const raw = (await event.request.formData()).get('ref');
		const ref = typeof raw === 'string' ? raw : '';
		const target = parseCorrectionTarget('job_input', raw);
		if (!target || target.kind !== 'job_input') {
			return fail(404, {
				action: 'confirm',
				ref,
				error: 'That price is not in your ledger.'
			} satisfies ReconcileActionResult);
		}
		if (await throttled(env, user.userId)) {
			return fail(429, { action: 'confirm', ref, error: TOO_MANY } satisfies ReconcileActionResult);
		}
		const outcome = await confirmBuyValue(env, user.userId, target);
		if (!outcome.ok) {
			return fail(outcome.status, {
				action: 'confirm',
				ref,
				error: outcome.message
			} satisfies ReconcileActionResult);
		}
		return {
			action: 'confirm',
			ref,
			notice: correctionNotice('saved', outcome.rebuilt)
		} satisfies ReconcileActionResult;
	},

	/** "Use buy value for all": every estimated input of one item (field `typeId`), one rebuild. */
	confirmAll: async (event) => {
		const { env, user } = await profitsActionContext(event);
		const raw = (await event.request.formData()).get('typeId');
		const typeId = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : 0;
		const ref = `type:${typeId}`;
		if (!Number.isSafeInteger(typeId) || typeId <= 0) {
			return fail(404, {
				action: 'confirmAll',
				ref,
				error: 'There is no buy value left to use for this item.'
			} satisfies ReconcileActionResult);
		}
		if (await throttled(env, user.userId)) {
			return fail(429, { action: 'confirmAll', ref, error: TOO_MANY } satisfies ReconcileActionResult);
		}
		const outcome = await confirmAllBuyValues(env, user.userId, typeId);
		if (!outcome.ok) {
			return fail(outcome.status, {
				action: 'confirmAll',
				ref,
				error: outcome.message
			} satisfies ReconcileActionResult);
		}
		const what = `${formatNumber(outcome.count)} ${outcome.count === 1 ? 'price' : 'prices'} confirmed.`;
		return {
			action: 'confirmAll',
			ref,
			notice: outcome.rebuilt
				? `${what} Results recalculated.`
				: `${what} Results are recalculated within 10 minutes.`
		} satisfies ReconcileActionResult;
	}
};
