import type { NavUser } from '$lib/components/AccountMenu.svelte';
import { defaultTabsOf } from '$lib/components/listing/links';
import type { LayoutServerLoad } from './$types';

/**
 * Navbar identity: the session's login character (never the user id or other account data), and the
 * visitor's preferred reaction tabs that every reaction link follows.
 */
export const load: LayoutServerLoad = ({ locals }) => {
	const user = locals.user;
	const character = user?.characters.find((c) => c.characterId === user.characterId) ?? user?.characters[0];
	const navUser: NavUser | null =
		user && character
			? { characterId: character.characterId, name: character.name, isAdmin: user.isAdmin }
			: null;
	return {
		user: navUser,
		defaultTabs: defaultTabsOf(locals.settings)
	};
};
