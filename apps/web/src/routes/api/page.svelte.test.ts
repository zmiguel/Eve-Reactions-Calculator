import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

const scalar = vi.hoisted(() => {
	const destroy = vi.fn();
	return { destroy, createApiReference: vi.fn(() => ({ destroy })) };
});
vi.mock('@scalar/api-reference', () => ({ createApiReference: scalar.createApiReference }));
vi.mock('@scalar/api-reference/style.css', () => ({}));

const FORMULAS = [
	'=IMPORTDATA("https://reactions.coalition.space/api/v2/profits?reactor=composite&format=csv")',
	'=IMPORTDATA("https://reactions.coalition.space/api/v2/prices?hub=jita&types=16663,16671&format=csv")',
	'=IMPORTDATA("https://reactions.coalition.space/api/v2/profits?reactor=composite&view=chain&slots=optimal&system=671-ST&broker=1.5&format=csv")',
	'=IMPORTDATA("https://reactions.coalition.space/api/v2/prices/history?hub=jita&type=16663&format=csv")'
];

function mockClipboard(writeText: (data: string) => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
	return writeText;
}

/** Renders the page and waits until the (mocked) Scalar reference is mounted. */
async function renderMounted() {
	const view = render(Page);
	await vi.waitFor(() => expect(scalar.createApiReference).toHaveBeenCalledTimes(1));
	await vi.waitFor(() => expect(screen.queryByText(/Loading the API reference/)).toBeNull());
	return view;
}

beforeEach(() => {
	document.documentElement.className = 'dark';
});

afterEach(() => {
	cleanup(); // unmount (Scalar cleanup) before the mocks are cleared
	Reflect.deleteProperty(navigator, 'clipboard');
	document.head.innerHTML = '';
	document.documentElement.className = '';
	document.body.className = '';
	vi.clearAllMocks();
});

describe('/api page shell', () => {
	it('renders the intro and the OpenAPI document link', () => {
		const { container } = render(Page);
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('API v2');
		const text = container.textContent ?? '';
		expect(text).toContain('https://reactions.coalition.space');
		expect(text).toContain('120 requests per minute per IP');
		expect(text).toContain('public market hubs');
		expect(text).toContain('Access-Control-Allow-Origin: *');
		expect(text).toContain('API v1 was removed');
		expect(screen.getByRole('link', { name: '/api/v2/openapi.json' }).getAttribute('href')).toBe(
			'/api/v2/openapi.json'
		);
	});

	it('lists every Google Sheets formula with the caching, rate limit and parameter notes', () => {
		render(Page);
		for (const formula of FORMULAS) expect(screen.getByText(formula).tagName).toBe('CODE');
		const sheets = document.getElementById('google-sheets')!.textContent ?? '';
		expect(sheets).toMatch(/caches\s+IMPORTDATA results for about an hour/);
		expect(sheets).toContain('120 requests per minute');
		expect(screen.getByRole('link', { name: 'GET /api/v2/profits' }).getAttribute('href')).toBe(
			'#tag/profits/GET/api/v2/profits'
		);
	});

	it('copies a formula to the clipboard', async () => {
		const writeText = mockClipboard(vi.fn().mockResolvedValue(undefined));
		render(Page);
		const button = screen.getByRole('button', { name: /Copy formula: Composite full chains/ });
		await fireEvent.click(button);
		await vi.waitFor(() => expect(button.textContent!.trim()).toBe('Copied'));
		expect(writeText).toHaveBeenCalledWith(FORMULAS[2]);
		expect(screen.getByRole('status').textContent).toMatch(/copied to the clipboard/);
	});

	it('selects the formula when the clipboard is blocked', async () => {
		mockClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
		render(Page);
		await fireEvent.click(screen.getByRole('button', { name: 'Copy formula: Composite profits' }));
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Clipboard unavailable/));
		expect(getSelection()!.toString()).toBe(FORMULAS[0]);
	});
});

describe('/api Scalar reference', () => {
	it('mounts Scalar on the OpenAPI document with the site theme', async () => {
		await renderMounted();
		const [element, config] = scalar.createApiReference.mock.calls[0] as unknown as [
			HTMLElement,
			Record<string, unknown>
		];
		expect(element.closest('section')!.getAttribute('aria-label')).toBe('API reference');
		expect(config).toMatchObject({
			url: '/api/v2/openapi.json',
			layout: 'modern',
			theme: 'none',
			withDefaultFonts: false,
			forceDarkModeState: 'dark',
			hideDarkModeToggle: true,
			telemetry: false,
			showDeveloperTools: 'never',
			agent: { disabled: true },
			mcp: { disabled: true }
		});
		expect(config).not.toHaveProperty('proxyUrl');
		// Sky accent (Tailwind sky-400 / sky-700) and the site's font stack.
		expect(config.customCss).toContain('--scalar-color-accent: oklch(74.6% 0.16 232.661)');
		expect(config.customCss).toContain('--scalar-color-accent: oklch(50% 0.134 242.749)');
		expect(config.customCss).toContain('--scalar-font: var(--font-sans');
		// Off production, "Test request" targets the page's own origin first.
		expect(config.servers).toEqual([
			{ url: location.origin, description: 'This server' },
			{ url: 'https://reactions.coalition.space', description: 'Production' }
		]);
	});

	it('starts light when the site is light and follows the site theme toggle', async () => {
		document.documentElement.className = '';
		await renderMounted();
		expect(scalar.createApiReference.mock.calls[0]).toContainEqual(
			expect.objectContaining({ forceDarkModeState: 'light' })
		);
		expect(document.body.classList.contains('light-mode')).toBe(true);
		document.documentElement.classList.add('dark');
		await vi.waitFor(() => expect(document.body.classList.contains('dark-mode')).toBe(true));
		expect(document.body.classList.contains('light-mode')).toBe(false);
	});

	it("keeps SvelteKit's history keys on Scalar's history writes and cleans up on unmount", async () => {
		const { pushState, replaceState } = history;
		history.replaceState({ 'sveltekit:history': 7, 'sveltekit:navigation': 3 }, '', '/api');
		const { unmount } = await renderMounted();
		history.pushState({}, '', '/api#tag/market');
		expect(history.state).toEqual({ 'sveltekit:history': 7, 'sveltekit:navigation': 3 });
		history.replaceState({ 'sveltekit:history': 8 }, '', '/api');
		expect(history.state).toEqual({ 'sveltekit:history': 8 });
		unmount();
		expect(scalar.destroy).toHaveBeenCalledTimes(1);
		expect(history.pushState).toBe(pushState);
		expect(history.replaceState).toBe(replaceState);
		expect(document.body.classList.contains('dark-mode')).toBe(false);
	});
});
