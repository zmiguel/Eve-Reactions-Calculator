import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { InventoryPageData } from '$lib/inventory/types';
import { loadCalc } from '$lib/server/context';
import {
	inventoryPage,
	isInventoryBucket,
	saveSelection,
	type InventoryPlaceKey
} from '$lib/server/inventory';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount%2Finventory';

function requireAccount({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	if (!platform) error(503, 'Your account is not available right now.');
	return { env: platform.env, user: locals.user };
}

const positiveInt = (value: FormDataEntryValue | null) => {
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const NOT_YOURS = 'That connection is not on your list.';
const BAD_PLACES = 'Pick places of this inventory.';

export const load: PageServerLoad = async (event): Promise<InventoryPageData> => {
	const { env, user } = requireAccount(event);
	const calc = await loadCalc(env, event.locals);
	return inventoryPage(env, user.userId, calc?.ctx ?? null);
};

export const actions: Actions = {
	select: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const sourceId = positiveInt(form.get('sourceId'));
		if (sourceId === null) return fail(404, { error: NOT_YOURS });
		const mode = form.get('mode');
		const places: InventoryPlaceKey[] = [];
		if (mode !== 'all' && mode !== 'none') {
			for (const entry of form.getAll('place')) {
				const [, locationId, bucket = ''] = /^(\d+):(\w+)$/.exec(String(entry)) ?? [];
				if (!locationId || !isInventoryBucket(bucket)) return fail(400, { error: BAD_PLACES });
				places.push({ locationId: Number(locationId), bucket });
			}
		}
		const saved = await saveSelection(
			env,
			user.userId,
			sourceId,
			mode === 'all' || mode === 'none' ? { mode } : { places }
		);
		if (saved === 'missing') return fail(404, { error: NOT_YOURS });
		if (saved === 'invalid') return fail(400, { error: BAD_PLACES });
		return { notice: { ok: true, text: 'Selection saved.' } };
	}
};
