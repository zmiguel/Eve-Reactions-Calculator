import { error, redirect } from '@sveltejs/kit';
import { completeLogin, getCharacter } from '#lib/server/auth/accounts.js';
import { safeReturnTo } from '#lib/server/auth/oauth.js';
import type { PageServerLoad } from './$types';

/**
 * `GET /auth/dev-login?characterId=&name=&purpose=login|add_character&returnTo=` — local/e2e only
 * (`DEV_LOGIN=1`, else 404): the SSO login steps without EVE SSO. Scope-less like a real login.
 */
export const load: PageServerLoad = async ({ url, locals, cookies }) => {
	const env = locals.env;
	if (env.DEV_LOGIN !== '1') error(404, 'Not Found');
	const params = url.searchParams;
	const characterId = Number(params.get('characterId'));
	if (!Number.isSafeInteger(characterId) || characterId <= 0)
		error(400, 'characterId must be a positive integer.');
	const purpose = params.get('purpose') ?? 'login';
	if (purpose !== 'login' && purpose !== 'add_character')
		error(400, 'purpose must be login or add_character.');

	// Reuse a stored owner hash so a dev login never looks like a character transfer, and the stored
	// name unless `name` is given: only a new character gets the placeholder name.
	const stored = await getCharacter(env, characterId);
	const ownerHash = stored?.ownerHash ?? `dev-${characterId}`;
	const name = params.get('name') || stored?.name || `Dev Pilot ${characterId}`;
	const result = await completeLogin(
		{ env, cookies, user: locals.user },
		{
			purpose,
			feature: null,
			features: null,
			characterId: null,
			returnTo: safeReturnTo(params.get('returnTo'))
		},
		{ characterId, name, scopes: [], ownerHash },
		null
	);
	if (!result.ok) error(result.status, result.message);
	redirect(303, result.location);
};
