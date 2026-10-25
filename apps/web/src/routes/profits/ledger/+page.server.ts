import { redirect } from '@sveltejs/kit';
import { hasEmptyParams, withoutEmptyParams } from '$lib/ledger/forms';
import type { LedgerPageData } from '$lib/ledger/types';
import { emptyLedgerPage, ledgerPage, parseLedgerQuery } from '$lib/server/ledger';
import { contractJaniceAction, correctionAction } from '$lib/server/ledger-actions';
import { profitsContext } from '$lib/server/profits-access';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event): Promise<LedgerPageData> => {
	// The filter form without JS submits its empty fields too: drop them from the address.
	if (event.request.method === 'GET' && hasEmptyParams(event.url.searchParams)) {
		redirect(303, withoutEmptyParams(event.url.pathname, event.url.searchParams));
	}
	const { filters, page } = parseLedgerQuery(event.url);
	const context = await profitsContext(event);
	if (!context) return emptyLedgerPage(filters);
	return ledgerPage(context.env, context.user.userId, filters, page);
};

/** Trade and contract item prices (job inputs are corrected on the item and job pages). */
const KINDS = ['transaction', 'contract_item'] as const;

export const actions: Actions = {
	correct: (event) => correctionAction(event, 'correct', KINDS),
	undo: (event) => correctionAction(event, 'undo', KINDS),
	contractJanice: (event) => contractJaniceAction(event, 'contractJanice'),
	removeContractJanice: (event) => contractJaniceAction(event, 'removeContractJanice')
};
