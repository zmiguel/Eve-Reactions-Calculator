import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { getCharacter, listCharacters } from '$lib/server/auth/accounts';
import {
	STRUCTURE_LINK_LIMIT,
	addStructureLink,
	canUseStructures,
	listStructureLinks,
	removeStructureLink,
	searchUserStructures,
	setStructureSharing
} from '$lib/server/structures';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount%2Fstructures';

function requireAccount({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	if (!platform) error(503, 'Your account is not available right now.');
	return { env: platform.env, user: locals.user };
}

const positiveInt = (value: FormDataEntryValue | null) => {
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The posted character, when it is on the session's account. */
async function postedCharacter(env: Env, userId: string, form: FormData) {
	const characterId = positiveInt(form.get('characterId'));
	const character = characterId === null ? undefined : await getCharacter(env, characterId);
	return character?.userId === userId ? character : null;
}

/**
 * Structure search and add each refresh an SSO token and make several ESI calls, so they are limited
 * per account (`ACCOUNT_RATE_LIMITER`, 10 per minute); skipped when the binding is absent.
 */
async function throttled(env: Env, userId: string): Promise<boolean> {
	const limiter = env.ACCOUNT_RATE_LIMITER as RateLimit | undefined;
	if (!limiter) return false;
	return !(await limiter.limit({ key: `structures:${userId}` })).success;
}

const TOO_MANY = 'Too many requests. Wait a minute and try again.';

export const load: PageServerLoad = async (event) => {
	const { env, user } = requireAccount(event);
	const [rows, links] = await Promise.all([
		listCharacters(env, user.userId),
		listStructureLinks(env, user.userId)
	]);
	return {
		now: Date.now(),
		limit: STRUCTURE_LINK_LIMIT,
		characters: rows.map((c) => ({
			characterId: c.characterId,
			name: c.name,
			ready: canUseStructures(c),
			tokenStatus: c.tokenStatus as 'none' | 'ok' | 'invalid'
		})),
		links
	};
};

export const actions: Actions = {
	search: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const query = String(form.get('q') ?? '').trim();
		const character = await postedCharacter(env, user.userId, form);
		const characterId = character?.characterId ?? null;
		const failed = (error: string) => fail(400, { search: { query, characterId, error, results: [] } });
		if (!character) return failed('Pick one of your characters.');
		if (query.length < 3) return failed('Type at least 3 characters.');
		if (await throttled(env, user.userId))
			return fail(429, { search: { query, characterId, error: TOO_MANY, results: [] } });
		const outcome = await searchUserStructures(env, event.fetch, user.userId, character, query);
		if (!outcome.ok) return failed(outcome.message);
		return { search: { query, characterId, error: null, results: outcome.results } };
	},

	add: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const character = await postedCharacter(env, user.userId, form);
		const structureId = positiveInt(form.get('structureId'));
		if (!character || structureId === null) return fail(400, { error: 'Pick a structure and a character.' });
		if (await throttled(env, user.userId)) return fail(429, { error: TOO_MANY });
		const outcome = await addStructureLink(env, event.fetch, user.userId, character, structureId);
		if (!outcome.ok) return fail(400, { error: outcome.message });
		return { notice: `${outcome.name} added. Prices arrive with the next price refresh.` };
	},

	share: async (event) => {
		const { env, user } = requireAccount(event);
		const form = await event.request.formData();
		const structureId = positiveInt(form.get('structureId'));
		const share = form.get('share') === '1';
		if (structureId === null || !(await setStructureSharing(env, user.userId, structureId, share))) {
			return fail(400, { error: 'That market is not on your list.' });
		}
		return { notice: share ? 'Sharing requested.' : 'Sharing turned off.' };
	},

	remove: async (event) => {
		const { env, user } = requireAccount(event);
		const structureId = positiveInt((await event.request.formData()).get('structureId'));
		if (structureId === null || !(await removeStructureLink(env, user.userId, structureId))) {
			return fail(400, { error: 'That market is not on your list.' });
		}
		return { notice: 'Market removed.' };
	}
};
