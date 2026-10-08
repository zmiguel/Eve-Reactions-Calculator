/**
 * Test shim for `$app/state` (web-components project). `page` is a plain object; tests set the current
 * URL with `setPage({ url })` before rendering and call `resetPage()` afterwards (import by relative path).
 */
type PageState = {
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
	status: number;
	error: App.Error | null;
	data: Record<string, unknown>;
	form: unknown;
	state: App.PageState;
};

const initial = (): PageState => ({
	url: new URL('http://localhost/'),
	params: {},
	route: { id: null },
	status: 200,
	error: null,
	data: {},
	form: null,
	state: {}
});

export const page: PageState = initial();

export function setPage(next: Partial<Omit<PageState, 'url'>> & { url?: string | URL }) {
	const { url, ...rest } = next;
	Object.assign(page, rest);
	if (url !== undefined) page.url = new URL(url, 'http://localhost/');
}

export function resetPage() {
	Object.assign(page, initial());
}

export const navigating = { from: null, to: null, type: null, willUnload: null, delta: null, complete: null };

export const updated = {
	current: false,
	check: async () => false
};
