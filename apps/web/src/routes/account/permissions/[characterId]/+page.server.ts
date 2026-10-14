import { ESI_FEATURES, parseScopes } from '@reactions/eve';
import { error, redirect } from '@sveltejs/kit';
import { OFFERED_FEATURES, parseFeatureList } from '$lib/account/features';
import { NOT_YOUR_CHARACTER, listCharacters } from '$lib/server/auth/accounts';
import { heldFeatures } from '$lib/server/auth/feature-change';
import { SSO_NOT_CONFIGURED, ssoConfig, startSso } from '$lib/server/auth/sso';
import type { Actions, PageServerLoad } from './$types';

/** `/account/permissions/<characterId>`: the permissions form of the account page's dialog, as a page (no JS). */
export const load: PageServerLoad = async ({ locals, platform, params, url }) => {
	if (!locals.user) {
		redirect(303, `/auth/login?purpose=login&returnTo=${encodeURIComponent(url.pathname)}`);
	}
	if (!platform) error(503, 'Your account is not available right now.');
	const characterId = Number(params.characterId);
	const character = (await listCharacters(platform.env, locals.user.userId)).find(
		(c) => c.characterId === characterId
	);
	if (!character) error(404, NOT_YOUR_CHARACTER);
	return {
		character: {
			characterId: character.characterId,
			name: character.name,
			features: heldFeatures(character.scopes)
		},
		offeredFeatures: OFFERED_FEATURES
	};
};

export const actions: Actions = {
	/**
	 * `POST ?/save` (`features` values, comma-separated or repeated; none = no scopes) → EVE SSO asking
	 * for exactly the scopes of those features for this character of the session account
	 * (`purpose=features`, back to `/account` with the permissions notice). A POST so the SvelteKit
	 * origin check keeps other sites from starting it: the login can drop scopes and switch off what
	 * they enabled.
	 */
	save: async ({ locals, platform, params, request, cookies, url }) => {
		if (!locals.user) {
			redirect(303, `/auth/login?purpose=login&returnTo=${encodeURIComponent(url.pathname)}`);
		}
		const characterId = Number(params.characterId);
		if (!locals.user.characters.some((c) => c.characterId === characterId)) error(404, NOT_YOUR_CHARACTER);
		const form = await request.formData();
		const features = parseFeatureList(
			form.getAll('features').filter((v): v is string => typeof v === 'string')
		);
		if (!features) error(400, 'Unknown feature.');

		const config = platform ? ssoConfig(platform.env) : null;
		if (!config) error(503, SSO_NOT_CONFIGURED);
		const scopes = parseScopes(features.flatMap((f) => ESI_FEATURES[f])).sort();
		redirect(
			303,
			await startSso(
				config,
				cookies,
				{ purpose: 'features', feature: null, features, characterId, returnTo: '/account' },
				scopes
			)
		);
	}
};
