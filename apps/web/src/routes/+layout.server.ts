import type { AnalyticsIdentity } from '$lib/analytics';
import type { NavUser } from '$lib/components/AccountMenu.svelte';
import { defaultTabsOf } from '$lib/components/listing/links';
import type { LayoutServerLoad } from './$types';

/**
 * Navbar identity: the session's login character and admin flag. Analytics identity: the account id
 * and the main character's name (the account's first character, `characters` is ordered by creation),
 * nothing else. Plus the visitor's preferred reaction tabs that every reaction link follows.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	const character = user?.characters.find((c) => c.characterId === user.characterId) ?? user?.characters[0];
	const main = user?.characters[0];
	const navUser: NavUser | null =
		user && character
			? { characterId: character.characterId, name: character.name, isAdmin: user.isAdmin }
			: null;
	const analytics: AnalyticsIdentity | null =
		user && main ? { userId: user.userId, username: main.name } : null;
	return {
		user: navUser,
		analytics,
		defaultTabs: defaultTabsOf(locals.settings)
	};
};
