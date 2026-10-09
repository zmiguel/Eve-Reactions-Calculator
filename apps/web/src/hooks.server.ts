import { DEFAULT_SETTINGS } from '@reactions/engine';
import type { Handle } from '@sveltejs/kit';
import { THEME_COOKIE } from '$lib/server/cookies';
import { loadSession } from '$lib/server/session';
import { resolveSettings } from '$lib/server/settings';

export const SECURITY_HEADERS: Record<string, string> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Content-Security-Policy': "frame-ancestors 'none'",
	'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

/** Largest form post the pages accept (settings, account and admin forms are a few KiB). */
export const MAX_FORM_BYTES = 64 * 1024;

/**
 * Page form posts must declare a body of at most {@link MAX_FORM_BYTES}, so actions never buffer large
 * bodies (API v2 bounds its own JSON bodies).
 */
function oversizedForm(request: Request, pathname: string): Response | null {
	if (request.method === 'GET' || request.method === 'HEAD' || pathname.startsWith('/api/v2/')) return null;
	const length = request.headers.get('content-length');
	if (length === null) return request.body ? new Response('Length Required', { status: 411 }) : null;
	return Number(length) > MAX_FORM_BYTES ? new Response('Payload Too Large', { status: 413 }) : null;
}

export const handle: Handle = async ({ event, resolve }) => {
	const rejected = oversizedForm(event.request, event.url.pathname);
	if (rejected) return rejected;
	const theme = event.cookies.get(THEME_COOKIE) === 'light' ? 'light' : 'dark';
	event.locals.theme = theme;
	// `platform` is absent while prerendering: pages then render anonymous with default settings.
	const env = event.platform?.env;
	if (event.url.pathname.startsWith('/api/')) {
		// The API (v2 and the removed v1) is anonymous: no session lookup, no settings cookie, no cookie writes.
		event.locals.user = null;
		event.locals.account = null;
		event.locals.settings = DEFAULT_SETTINGS;
	} else {
		const session = env ? await loadSession(env, event.cookies) : null;
		event.locals.user = session?.user ?? null;
		event.locals.account = session?.account ?? null;
		event.locals.settings = await resolveSettings(env, event.cookies, session);
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%theme%', theme)
	});
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	// The preview (preview.reactions.coalition.space) shows the same pages as production: keep it out of search
	// engines (Cloudflare adds this header only on workers.dev preview URLs, not on custom domains).
	const deployEnv: string | undefined = env?.DEPLOY_ENV;
	if (deployEnv === 'preview') response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	return response;
};
