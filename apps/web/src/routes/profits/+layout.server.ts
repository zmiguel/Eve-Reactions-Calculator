import { profitsAccess, profitsLoginHref } from '#lib/server/profits-access.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => ({
	access: await profitsAccess(event),
	loginHref: profitsLoginHref(event.url)
});
