import { error, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from './session.ts';

/**
 * Who may see the profits pages: `login` (anonymous visitor), `enable` (logged in, but no connection
 * has Profit tracking on) or `ok`. The `/profits` layout shows a message instead of the page for the
 * first two; page loads skip their work then (`profitsContext` returns null).
 */
export type ProfitsAccess = 'login' | 'enable' | 'ok';

/** Whether `userId` has at least one connection with Profit tracking on. */
export async function hasTrackingConnection(env: Pick<Env, 'DB'>, userId: string): Promise<boolean> {
	const row = await env.DB.prepare(
		'SELECT 1 AS ok FROM inventory_sources WHERE user_id = ? AND tracking_enabled = 1 LIMIT 1'
	)
		.bind(userId)
		.first<{ ok: number }>();
	return row !== null;
}

export async function profitsAccess(event: Pick<RequestEvent, 'locals'>): Promise<ProfitsAccess> {
	const user = event.locals.user;
	if (!user) return 'login';
	return (await hasTrackingConnection(event.locals.env, user.userId)) ? 'ok' : 'enable';
}

/**
 * The env and user of a profits page load when the visitor may see it (`ok`), else null: the layout
 * shows the login / enable message and the page returns its empty data.
 */
export async function profitsContext(
	event: Pick<RequestEvent, 'locals'>
): Promise<{ env: Env; user: SessionUser } | null> {
	if ((await profitsAccess(event)) !== 'ok') return null;
	return { env: event.locals.env, user: event.locals.user! };
}

/**
 * The env and user of a profits JSON endpoint (the `PagedTable` data of `/profits/data/*`): 401 for an
 * anonymous visitor, 403 when no connection has Profit tracking on.
 */
export async function profitsApiContext(
	event: Pick<RequestEvent, 'locals'>
): Promise<{ env: Env; user: SessionUser }> {
	const access = await profitsAccess(event);
	if (access === 'login') error(401, 'Log in to see your profits.');
	if (access === 'enable') error(403, 'Switch Profit tracking on for a connection first.');
	return { env: event.locals.env, user: event.locals.user! };
}
/** `/auth/login` returning to `url` (path and query). */
export const profitsLoginHref = (url: URL) =>
	`/auth/login?purpose=login&returnTo=${encodeURIComponent(url.pathname + url.search)}`;
