import type { NavUser } from '$lib/components/AccountMenu.svelte';
import { defaultTabsOf } from '$lib/components/listing/links';
import { analyticsIdentity } from '$lib/server/analytics';
import type { LayoutServerLoad } from './$types';

/**
 * Navbar identity: the session's login character and admin flag. Analytics identity: the account id
 * and Rybbit traits (`analyticsIdentity`). Plus the visitor's preferred reaction tabs that every
 * reaction link follows.
 */
export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	const character = user?.characters.find((c) => c.characterId === user.characterId) ?? user?.characters[0];
	const navUser: NavUser | null =
		user && character
			? { characterId: character.characterId, name: character.name, isAdmin: user.isAdmin }
			: null;
	return {
		user: navUser,
		analytics: await analyticsIdentity(platform?.env, user, locals.account, locals.settings),
		defaultTabs: defaultTabsOf(locals.settings)
	};
};
