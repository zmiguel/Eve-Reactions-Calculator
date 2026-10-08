import { getCoreDb, users } from '@reactions/db';
import { grantedFeatures } from '@reactions/eve';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { OFFERED_FEATURES } from '$lib/account/features';
import { deleteAccount, listCharacters, removeCharacter } from '$lib/server/auth/accounts';
import { SESSION_COOKIE, deleteCookie } from '$lib/server/cookies';
import type { Actions, PageServerLoad } from './$types';

const LOGIN_URL = '/auth/login?purpose=login&returnTo=%2Faccount';

function requireAccount({ locals, platform }: Pick<RequestEvent, 'locals' | 'platform'>) {
	if (!locals.user) redirect(303, LOGIN_URL);
	if (!platform) error(503, 'Your account is not available right now.');
	return { env: platform.env, user: locals.user };
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
			features: grantedFeatures(c.scopes),
			tokenStatus: c.tokenStatus as 'none' | 'ok' | 'invalid',
			lastRefreshedAt: c.lastRefreshedAt,
			lastError: c.lastError
		})),
		offeredFeatures: OFFERED_FEATURES,
		createdAt: account?.createdAt ?? null,
		settingsUpdatedAt: account?.settingsUpdatedAt ?? null,
		notice: event.url.searchParams.get('notice') === 'removed' ? 'Character removed.' : null
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
