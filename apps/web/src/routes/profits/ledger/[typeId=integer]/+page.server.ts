import { error } from '@sveltejs/kit';
import type { LedgerItemPageData } from '$lib/ledger/types';
import { pageParam } from '$lib/paging';
import { correctionAction } from '$lib/server/ledger-actions';
import { emptyItemPage, ledgerItemPage } from '$lib/server/ledger-item';
import { profitsContext } from '$lib/server/profits-access';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event): Promise<LedgerItemPageData> => {
	const typeId = Number(event.params.typeId);
	const context = await profitsContext(event);
	if (!context) return emptyItemPage(typeId);
	const page = await ledgerItemPage(context.env, event.locals, context.user.userId, typeId, {
		batches: pageParam(event.url, 'batches'),
		trades: pageParam(event.url, 'trades')
	});
	if (!page) error(404, 'Not Found');
	return page;
};

/** Job inputs without a purchase (the batches this page offers to correct). */
const KINDS = ['job_input'] as const;

export const actions: Actions = {
	correct: (event) => correctionAction(event, 'correct', KINDS),
	undo: (event) => correctionAction(event, 'undo', KINDS)
};
