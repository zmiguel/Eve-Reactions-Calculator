/**
 * Error texts users may see: stored in user-visible columns (`characters.last_error`,
 * `inventory_sources.last_error`, `market_hubs.last_error` on user pages) or shown as notices. Details of
 * the failure (exception text, SQL, ids) go to the worker logs (`console.error`) only. Import from
 * `@reactions/eve/errors` in browser code: this module has no dependencies.
 */

/** Any failure without a better user-facing sentence. */
export const ERROR_INTERNAL = 'Something went wrong on our side; it will be retried.';

/** `characters.last_error`: refresh token revoked, expired or unreadable (`token_status = 'invalid'`). */
export const TOKEN_ERROR_REVOKED =
	'The login of this character expired or was revoked; enable the feature again.';
/** `characters.last_error`: token issued by an EVE SSO application this deployment has no credentials for. */
export const TOKEN_ERROR_APP_RETIRED =
	'This character logged in through an EVE application this site no longer uses; enable the feature again.';
/** `characters.last_error`: EVE SSO could not be reached or answered 5xx. */
export const TOKEN_ERROR_SSO_DOWN = 'EVE Online did not answer; it will be retried.';

/** `characters.last_error`: EVE SSO refused the refresh with another HTTP status. */
export const tokenErrorHttp = (status: number) => `EVE Online answered HTTP ${status}; it will be retried.`;

/** Texts that only come from code, logs or the database, never from a sentence written for users. */
const INTERNAL_MARKERS = [
	/Failed query/i,
	/SQLITE/i,
	/\bD1_/,
	/\bparams:/i,
	/^\s*at .+[:(]/m,
	/(^|\s)[A-Za-z]*(Error|Exception):/,
	/\bcharacter \d+\b/,
	/\bSSO_APP_UNKNOWN\b/,
	/[{}<>]|\n/
];
/** Longer texts are not one of our sentences (a list of reader notes stays well below this). */
const MAX_USER_ERROR_LENGTH = 400;

/**
 * A stored error text as users may see it: known sentences and notes pass through; anything that looks
 * internal (SQL, D1/SQLite errors, stack frames, `Error:` prefixes, internal ids, overlong texts, e.g.
 * rows written before the writers stored only user sentences) becomes {@link ERROR_INTERNAL}.
 */
export function userFacingError(text: string): string;
export function userFacingError(text: string | null): string | null;
export function userFacingError(text: string | null): string | null {
	if (text === null || text === '') return text;
	if (text.length > MAX_USER_ERROR_LENGTH || INTERNAL_MARKERS.some((m) => m.test(text)))
		return ERROR_INTERNAL;
	return text;
}
