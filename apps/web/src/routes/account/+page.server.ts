import { getCoreDb, users } from '@reactions/db';
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { FEATURE_LABELS, OFFERED_FEATURES, parseFeatureList } from '#lib/account/features.js';
import {
	deleteAccount,
	listCharacters,
	removeCharacter,
	type CharacterRow
} from '#lib/server/auth/accounts.js';
import { heldFeatures } from '#lib/server/auth/feature-change.js';
import { SESSION_COOKIE, deleteCookie } from '#lib/server/cookies.js';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount';

function requireAccount({ locals }: Pick<RequestEvent, 'locals'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	return { env: locals.env, user: locals.user };
}

/** The success notice named by the query string (`notice=removed|permissions`), else null. */
function noticeOf(params: URLSearchParams, rows: readonly CharacterRow[]): string | null {
	const notice = params.get('notice');
	if (notice === 'removed') return 'Character removed.';
	if (notice !== 'permissions') return null;
	const character = rows.find((c) => c.characterId === Number(params.get('characterId')));
	if (!character) return null;
	const changes = [
		['added', 'Added'],
		['removed', 'Removed']
	].flatMap(([param, label]) => {
		const names = (parseFeatureList([params.get(param) ?? '']) ?? []).map((f) => FEATURE_LABELS[f]);
		return names.length ? [`${label}: ${names.join(', ')}.`] : [];
	});
	return `Permissions updated for ${character.name}. ${changes.length ? changes.join(' ') : 'No changes.'}`;
}

export const load: PageServerLoad = async (event) => {
	const { env, user } = requireAccount(event);
	const [rows, [account]] = await Promise.all([
		listCharacters(env, user.userId),
		getCoreDb(env.DB)
			.select({ createdAt: users.createdAt, settingsUpdatedAt: users.settingsUpdatedAt })
			.from(users)
			.where(eq(users.userId, user.userId))
	]);
	return {
		characters: rows.map((c) => ({
			characterId: c.characterId,
			name: c.name,
			isLogin: c.characterId === user.characterId,
			features: heldFeatures(c.scopes),
			tokenStatus: c.tokenStatus as 'none' | 'ok' | 'invalid',
			lastRefreshedAt: c.lastRefreshedAt,
			lastError: c.lastError
		})),
		offeredFeatures: OFFERED_FEATURES,
		createdAt: account?.createdAt ?? null,
		settingsUpdatedAt: account?.settingsUpdatedAt ?? null,
		notice: noticeOf(event.url.searchParams, rows)
	};
};

export const actions: Actions = {
	remove: async (event) => {
		const { env, user } = requireAccount(event);
		const characterId = Number((await event.request.formData()).get('characterId'));
		if (!user.characters.some((c) => c.characterId === characterId)) {
			return fail(400, { error: 'That character is not on your account.' });
		}
		const removed = await removeCharacter(env, characterId);
		if (removed?.accountDeleted) {
			deleteCookie(event.cookies, SESSION_COOKIE);
			redirect(303, '/');
		}
		redirect(303, '/account?notice=removed');
	},

	deleteAccount: async (event) => {
		const { env, user } = requireAccount(event);
		await deleteAccount(env, user.userId);
		deleteCookie(event.cookies, SESSION_COOKIE);
		redirect(303, '/');
	}
};
