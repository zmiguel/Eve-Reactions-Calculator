import { redirect } from '@sveltejs/kit';
import { endSession } from '#lib/server/session.js';
import type { RequestHandler } from './$types';

/** `POST /auth/logout`: deletes the session row and expires `rc_session`; the settings cookie stays. */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	await endSession(locals.env, cookies);
	redirect(303, '/');
};
