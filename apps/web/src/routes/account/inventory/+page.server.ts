import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import type { InventoryPageData } from '$lib/inventory/types';
import { getCharacter } from '$lib/server/auth/accounts';
import { loadCalc } from '$lib/server/context';
import {
	addSource,
	getSource,
	inventoryPage,
	isInventoryBucket,
	removeReader,
	removeSource,
	requestInventorySync,
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

/**
 * Adding a source and "Sync now" each start an updater workflow (adding may also ask ESI for the
 * corporation), so they are limited per account (`ACCOUNT_RATE_LIMITER`, 10 per minute); skipped when the
 * binding is absent.
 */
async function throttled(env: Env, userId: string): Promise<boolean> {
	const limiter = env.ACCOUNT_RATE_LIMITER as RateLimit | undefined;
	if (!limiter) return false;
	return !(await limiter.limit({ key: `inventory:${userId}` })).success;
}

const TOO_MANY = 'Too many requests. Wait a minute and try again.';
const NOT_YOURS = 'That inventory is not on your list.';
const BAD_PLACES = 'Pick places of this inventory.';

export const load: PageServerLoad = async (event): Promise<InventoryPageData> => {
	const { env, user } = requireAccount(event);
	const calc = await loadCalc(env, event.locals);
	return inventoryPage(env, event.fetch, user.userId, calc?.ctx ?? null);
};

export const actions: Actions = {
	add: async (event) => {
		const { env, user } = requireAccount(event);
		const value = String((await event.request.formData()).get('source') ?? '');
		const match = /^(character|corporation):(\d+)$/.exec(value);
		const character = match ? await getCharacter(env, Number(match[2])) : undefined;
		if (!match || !character || character.userId !== user.userId) {
			return fail(400, { error: 'Pick one of your characters.' });
		}
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		const kind = match[1] as 'character' | 'corporation';
		const outcome = await addSource(env, event.fetch, user.userId, character, kind);
		if (outcome.joined) return { notice: { ok: true, text: outcome.message } };
		if (!outcome.ok) {
			return fail(
				400,
				outcome.allow ? { error: outcome.message, allow: outcome.allow } : { error: outcome.message }
			);
		}
		const sync = await requestInventorySync(env, {
			sourceId: outcome.sourceId,
			ownerName: outcome.ownerName,
			dataExpiresAt: null
		});
		return {
			notice: sync.started
				? { ok: true, text: `${outcome.label} added. Sync started.` }
				: {
						ok: false,
						text: `${outcome.label} added, but the sync could not be started. Use Sync now to try again.`
					}
		};
	},

	sync: async (event) => {
		const { env, user } = requireAccount(event);
		const sourceId = positiveInt((await event.request.formData()).get('sourceId'));
		const source = sourceId === null ? undefined : await getSource(env, user.userId, sourceId);
		if (!source) return fail(404, { error: NOT_YOURS });
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		return { notice: (await requestInventorySync(env, source)).notice };
	},

	remove: async (event) => {
		const { env, user } = requireAccount(event);
		const sourceId = positiveInt((await event.request.formData()).get('sourceId'));
		if (sourceId === null || !(await removeSource(env, user.userId, sourceId))) {
			return fail(404, { error: NOT_YOURS });
		}
		return { notice: { ok: true, text: 'Inventory removed.' } };
	},

	removeReader: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const sourceId = positiveInt(form.get('sourceId'));
		const characterId = positiveInt(form.get('characterId'));
		if (sourceId === null) return fail(404, { error: NOT_YOURS });
		if (characterId === null) return fail(400, { error: 'Pick a character reading this inventory.' });
		const outcome = await removeReader(env, user.userId, sourceId, characterId);
		if (!outcome.ok) return fail(outcome.status, { error: outcome.message });
		return { notice: { ok: true, text: outcome.message } };
	},

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
