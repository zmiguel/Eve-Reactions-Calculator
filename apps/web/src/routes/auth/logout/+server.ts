import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteCookie } from '$lib/server/cookies';
import { endSession } from '$lib/server/session';
import type { RequestHandler } from './$types';

/** `POST /auth/logout`: deletes the session row and expires `rc_session`; the settings cookie stays. */
export const POST: RequestHandler = async ({ platform, cookies }) => {
	if (platform) await endSession(platform.env, cookies);
	else deleteCookie(cookies, SESSION_COOKIE);
	redirect(303, '/');
};
