/**
 * Test shim for `$app/navigation` (web-components project). Navigations are recorded instead of
 * performed; tests import `gotoCalls`/`shallowUrls`/`refreshAllCalls`/`resetNavigation` from this
 * file by relative path.
 */
export interface GotoCall {
	url: string;
	opts?: Record<string, unknown>;
}

/** `goto` navigations (not shallow). */
export const gotoCalls: GotoCall[] = [];
/** URLs passed to `goto(url, { shallow: true })` (shallow routing). */
export const shallowUrls: string[] = [];
/** One entry (the fake-able `Date.now()`) per `refreshAll()` call. */
export const refreshAllCalls: number[] = [];

export function resetNavigation() {
	gotoCalls.length = 0;
	shallowUrls.length = 0;
	refreshAllCalls.length = 0;
}

export async function goto(url: string | URL, opts?: Record<string, unknown>): Promise<void> {
	if (opts?.shallow) shallowUrls.push(String(url));
	else gotoCalls.push({ url: String(url), opts });
}

export async function refreshAll(): Promise<void> {
	refreshAllCalls.push(Date.now());
}
