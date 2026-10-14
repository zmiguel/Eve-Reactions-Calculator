/**
 * The form action URL `?/<name>` keeping the page's query string (filters, table pages), without a
 * previous action, so the page comes back the same after a submit without JS.
 */
export function actionHref(url: URL, name: string): string {
	const query = [...url.searchParams]
		.filter(([key]) => !key.startsWith('/'))
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('&');
	return `?/${name}${query ? `&${query}` : ''}`;
}

/** `path` with the non-empty `params` as its query string (a GET form also submits its empty fields). */
export function withoutEmptyParams(path: string, params: Iterable<[string, FormDataEntryValue]>): string {
	const kept = [...params].filter((p): p is [string, string] => typeof p[1] === 'string' && p[1] !== '');
	const query = new URLSearchParams(kept).toString();
	return query ? `${path}?${query}` : path;
}

/** Whether a query string has an empty parameter (a GET form submitted without JS). */
export const hasEmptyParams = (params: URLSearchParams): boolean =>
	[...params].some(([key, value]) => value === '' && !key.startsWith('/'));
