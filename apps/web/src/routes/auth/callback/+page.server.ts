import { handleCallback } from '$lib/server/auth/sso';
import type { PageServerLoad } from './$types';

/** `GET /auth/callback` (EVE SSO redirect target): always redirects or renders the auth error page. */
export const load: PageServerLoad = (event) => handleCallback(event);
