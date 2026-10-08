import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import { plannerData } from '../../test/planner';
import { resetPage, setPage } from '../../test/shims/app/state';
import Page from './+page.svelte';

afterEach(() => resetPage());

function ssr(data: object, path = '/planner') {
	setPage({ url: `https://reactions.coalition.space${path}` });
	return render(Page, { props: { data, params: {} } as never });
}

describe('/planner (server-rendered)', () => {
	it('has the planner title, description and a canonical URL without the query', () => {
		const { head } = ssr(plannerData(), '/planner?s=abc&inputsDaysAgo=4');
		expect(head).toContain('<title>Planner | EVE Reactions Calculator</title>');
		expect(head).toMatch(/<meta name="description" content="Plan EVE Online reaction slots[^"]+"/);
		expect(head).toContain('<link rel="canonical" href="https://reactions.coalition.space/planner"');
		expect(head).not.toContain('noindex');
	});

	it('renders the planner form and the empty state before the client loads a plan', () => {
		const { body } = ssr(plannerData());
		expect(body).toContain('Reaction planner</h1>');
		expect(body).toMatch(/id="planner-slots"[^>]*value="11"/);
		expect(body).toMatch(/id="planner-cycle"[^>]*value="7"/);
		expect(body).toContain('+ Add target');
		expect(body).toContain('Auto-fill best');
		expect(body).toMatch(/<form[^>]*method="GET"[^>]*action="\/planner"/);
		expect(body).toContain('name="inputsDaysAgo"');
		expect(body).toContain('data-empty');
		expect(body).toContain('add a target or use Auto-fill best');
	});

	it('explains missing reference data', () => {
		const { body } = ssr({ available: false });
		expect(body).toContain('Data not available yet');
		expect(body).not.toContain('planner-slots');
	});
});
