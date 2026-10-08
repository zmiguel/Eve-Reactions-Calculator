/**
 * Test shim for `$app/navigation` (web-components project). Navigations are recorded instead of
 * performed; tests import `gotoCalls`/`replaceStateCalls`/`invalidateAllCalls`/`resetNavigation` from this
 * file by relative path.
 */
export interface GotoCall {
	url: string;
	opts?: Record<string, unknown>;
}

export const gotoCalls: GotoCall[] = [];
/** URLs passed to `replaceState` (shallow routing). */
export const replaceStateCalls: string[] = [];
/** One entry (the fake-able `Date.now()`) per `invalidateAll()` call. */
export const invalidateAllCalls: number[] = [];

export function resetNavigation() {
	gotoCalls.length = 0;
	replaceStateCalls.length = 0;
	invalidateAllCalls.length = 0;
}

export async function goto(url: string | URL, opts?: Record<string, unknown>): Promise<void> {
	gotoCalls.push({ url: String(url), opts });
}

export async function invalidate(): Promise<void> {}

export async function invalidateAll(): Promise<void> {
	invalidateAllCalls.push(Date.now());
}

export function replaceState(url: string | URL, _state: App.PageState): void {
	replaceStateCalls.push(String(url));
}
