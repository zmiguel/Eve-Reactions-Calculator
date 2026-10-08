import { ESI_FEATURES, buildAuthorizeUrl, isGrantableFeature, scopesForFeature } from '@reactions/eve';
import { error, redirect } from '@sveltejs/kit';
import { OAUTH_MAX_AGE, setOauthCookie } from '$lib/server/cookies';
import { getCharacter } from '$lib/server/auth/accounts';
import { OFFERED_FEATURES } from '$lib/account/features';
import { LOGIN_PURPOSES, safeReturnTo, signOauthState, type LoginPurpose } from '$lib/server/auth/oauth';
import { SSO_NOT_CONFIGURED, ssoConfig } from '$lib/server/auth/sso';
import { randomToken } from '$lib/server/crypto';
import type { PageServerLoad } from './$types';

/**
 * `GET /auth/login?purpose=login|add_character|feature&feature=&characterId=&returnTo=` → EVE SSO.
 * `login` and `add_character` ask for no scopes; `feature` asks for the feature's scopes plus the
 * character's current ones. `add_character`/`feature` need a session (else: log in first, then resume).
 * `purpose=structures` (the plan's name) is an alias of `purpose=feature&feature=structures`.
 */
export const load: PageServerLoad = async ({ url, locals, platform, cookies }) => {
	const params = url.searchParams;
	if (params.get('purpose') === 'structures') {
		const alias = new URLSearchParams({ purpose: 'feature', feature: 'structures' });
		if (params.get('characterId')) alias.set('characterId', params.get('characterId')!);
		alias.set('returnTo', safeReturnTo(params.get('returnTo'), '/account/structures'));
		redirect(303, `/auth/login?${alias}`);
	}
	const purpose = (params.get('purpose') ?? 'login') as LoginPurpose;
	if (!LOGIN_PURPOSES.includes(purpose)) error(400, 'Unknown login purpose.');
	const returnTo = safeReturnTo(params.get('returnTo'));

	const featureParam = params.get('feature');
	// Only features a page uses can be granted (data minimisation: no wallet/assets scopes before they are needed).
	const feature =
		purpose === 'feature' && OFFERED_FEATURES.some((f) => f === featureParam) ? featureParam : null;
	if (purpose === 'feature' && !isGrantableFeature(feature)) error(400, 'Unknown feature.');

	const user = locals.user;
	if (purpose !== 'login' && !user) {
		// Adding a character without an account is a plain login; a feature grant resumes after logging in.
		const resume = purpose === 'feature' ? url.pathname + url.search : returnTo;
		redirect(303, `/auth/login?purpose=login&returnTo=${encodeURIComponent(resume)}`);
	}

	let characterId: number | null = null;
	if (purpose === 'feature' && params.get('characterId')) {
		characterId = Number(params.get('characterId'));
		if (!user?.characters.some((c) => c.characterId === characterId)) {
			error(400, 'That character is not on your account.');
		}
	}

	const env = platform?.env;
	const config = env ? ssoConfig(env) : null;
	if (!env || !config) error(503, SSO_NOT_CONFIGURED);

	let scopes: string[] = [];
	if (isGrantableFeature(feature)) {
		scopes =
			characterId === null
				? [...ESI_FEATURES[feature]].sort()
				: scopesForFeature(feature, (await getCharacter(env, characterId))?.scopes);
	}

	const state = randomToken(16);
	const signed = await signOauthState(config.sessionSecret, {
		state,
		purpose,
		feature: isGrantableFeature(feature) ? feature : null,
		characterId,
		returnTo,
		exp: Date.now() + OAUTH_MAX_AGE * 1000
	});
	setOauthCookie(cookies, signed);
	redirect(
		302,
		buildAuthorizeUrl({ clientId: config.clientId, redirectUri: config.callbackUrl, scopes, state })
	);
};
