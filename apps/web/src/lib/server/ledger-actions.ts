import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { LedgerActionResult } from '$lib/ledger/types';
import {
	correctionNotice,
	parseCorrectionTarget,
	saveCorrection,
	undoCorrection,
	type CorrectionTarget
} from './price-corrections.ts';
import { profitsContext, profitsLoginHref } from './profits-access.ts';

/**
 * Actions that start updater work (a sync, a ledger rebuild, an ESI lookup) are limited per account
 * (`ACCOUNT_RATE_LIMITER`, 10 per minute, one key for the account and profits pages); skipped when the
 * binding is absent.
 */
export async function throttled(env: Env, userId: string): Promise<boolean> {
	const limiter = env.ACCOUNT_RATE_LIMITER as RateLimit | undefined;
	if (!limiter) return false;
	return !(await limiter.limit({ key: `inventory:${userId}` })).success;
}

export const TOO_MANY = 'Too many requests. Wait a minute and try again.';
const UNKNOWN_PRICE = 'That price is not in your ledger.';

/** Added to the notice of a contract item: the other items of the contract share the rest of its total. */
const RESPLIT: Record<'correct' | 'undo', string> = {
	correct: 'The other items of this contract share the rest of its total.',
	undo: 'The contract total is split over all its items again.'
};

/**
 * The env and user of a form action of the profits pages: anonymous visitors are sent to log in,
 * accounts without Profit tracking get a 404.
 */
export async function profitsActionContext(event: RequestEvent) {
	const context = await profitsContext(event);
	if (!context) {
		if (!event.locals.user) redirect(303, profitsLoginHref(event.url));
		error(404, 'Not Found');
	}
	return context;
}

/**
 * The `correct` / `undo` form actions of the ledger pages (fields `kind`, `ref`, `unitPrice`, `note`):
 * stores or removes the user's price and asks for a rebuild. Only targets of `kinds` are accepted (404
 * otherwise). Anonymous visitors are sent to log in; accounts without Profit tracking get a 404. The
 * result carries the target `ref` so the page shows the message next to its price.
 */
export async function correctionAction(
	event: RequestEvent,
	action: 'correct' | 'undo',
	kinds: readonly CorrectionTarget['kind'][]
) {
	const { env, user } = await profitsActionContext(event);
	const form = await event.request.formData();
	const rawRef = form.get('ref');
	const ref = typeof rawRef === 'string' ? rawRef : '';
	const target = parseCorrectionTarget(form.get('kind'), rawRef);
	if (!target || !kinds.includes(target.kind)) {
		return fail(404, { action, ref, error: UNKNOWN_PRICE } satisfies LedgerActionResult);
	}
	if (await throttled(env, user.userId)) {
		return fail(429, { action, ref, error: TOO_MANY } satisfies LedgerActionResult);
	}
	const outcome =
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
		} satisfies LedgerActionResult);
	}
	const notice = correctionNotice(action === 'correct' ? 'saved' : 'removed', outcome.rebuilt);
	return {
		action,
		ref,
		notice: target.kind === 'contract_item' ? `${notice} ${RESPLIT[action]}` : notice
	} satisfies LedgerActionResult;
}

/** The `unitPrice` and `note` fields as typed, for a rejected correction form. */
export function typedValues(form: FormData): NonNullable<LedgerActionResult['values']> {
	const text = (name: string) => {
		const v = form.get(name);
		return typeof v === 'string' ? v : '';
	};
	return { unitPrice: text('unitPrice'), note: text('note') };
}
