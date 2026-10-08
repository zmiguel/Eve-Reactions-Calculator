import { render } from 'svelte/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDataMemo } from '$lib/server/data';
import { loadDetail, type DetailData } from '$lib/server/detail';
import { asEnv, fakeEnv } from '../../../test/fakes';
import { NOW, defaults, insertSystems, loadSde, putKv } from '../../../test/fixtures';
import Page from './+page.svelte';

beforeEach(() => clearDataMemo());

async function ssr(path: string) {
	const env = fakeEnv();
	await putKv(env, await loadSde());
	insertSystems(env.DB);
	const url = new URL(`https://reactions.coalition.space${path}`);
	const [, reactor, slug] = url.pathname.split('/');
	const data = (await loadDetail(
		asEnv(env),
		{ settings: defaults(), user: null },
		{ reactor: reactor as 'composite', slug },
		url,
		NOW
	)) as DetailData;
	const { head, body } = render(Page, { props: { data, params: { reactor, slug } } as never });
	return { data, body, head };
}

/** Trimmed text right after every element carrying `attr` (SSR markup, no DOM in the node env). */
const after = (body: string, attr: string) =>
	[...body.matchAll(new RegExp(`${attr}[^>]*>([^<]*)<`, 'g'))].map((m) => m[1].trim());
const count = (body: string, needle: string) => body.split(needle).length - 1;

describe('detail page (server-rendered)', () => {
	it('renders the chain as two build steps, the summary, the multibuy list and the flowchart', async () => {
		const { data, body } = await ssr('/composite/titanium-carbide?view=chain');
		expect(count(body, 'data-step=')).toBe(2);
		expect(after(body, 'data-field="name"')).toEqual([
			'Titanium Chromide',
			'Silicon Diborite',
			'Titanium Carbide'
		]);
		expect(count(body, 'aria-label="Buy for step 1"')).toBe(1);
		expect(count(body, 'aria-label="Buy for step 2"')).toBe(1);
		expect(count(body, 'data-step-subtotal')).toBe(2);
		expect(count(body, 'data-step-row=')).toBe(0);
		expect(count(body, 'data-summary-field="profit"')).toBe(1);
		expect(body).not.toContain('All purchases');

		const multibuy = body.match(/<textarea[^>]*>([^<]*)<\/textarea>/)![1];
		expect(
			multibuy
				.split('\n')
				.map((l) => l.split('\t')[0])
				.sort()
		).toEqual(data.result.inputs.map((i) => i.name).sort());
		for (const line of multibuy.split('\n')) expect(line).toMatch(/^[^\t]+\t\d+$/);

		expect(body).toMatch(/<svg[^>]*role="img"/);
		expect(body).toContain('Material flow for Titanium Carbide</title>');
		expect(count(body, 'data-kind="intermediate"')).toBe(2);
		expect(count(body, 'data-kind="bought"')).toBe(data.result.inputs.length);
		expect(count(body, 'data-flow-edge=')).toBe(9);
	});

	it('renders a single reaction as one step plus the summary', async () => {
		const { data, body } = await ssr('/composite/caesarium-cadmide');
		expect(count(body, 'data-step=')).toBe(1);
		expect(after(body, 'data-field="name"')).toEqual(['Caesarium Cadmide']);
		expect(count(body, 'aria-label="Buy for step 1"')).toBe(1);
		expect(count(body, 'data-summary-field="profit"')).toBe(1);
		expect(count(body, 'data-kind="final"')).toBe(1);
		const multibuy = body.match(/<textarea[^>]*>([^<]*)<\/textarea>/)![1];
		expect(multibuy.split('\n')).toHaveLength(data.result.inputs.length);
	});

	it('offers a Using unrefined tab on chains with an unrefined route and renders that view', async () => {
		const chain = await ssr('/composite/titanium-carbide?view=chain');
		expect(chain.body).toContain('href="/composite/titanium-carbide?view=unrefined"');
		expect((await ssr('/composite/caesarium-cadmide')).body).not.toContain('Using unrefined');

		const { data, body, head } = await ssr('/composite/fermionic-condensates?view=unrefined');
		expect(body).toMatch(/aria-current="page"[^>]*>Using unrefined</);
		expect(head).toContain(
			'<link rel="canonical" href="https://reactions.coalition.space/composite/fermionic-condensates"'
		);
		expect(body).toMatch(/role="note"[^>]*data-unrefined-note/);
		const note = body.match(/data-unrefined-note[^>]*>([\s\S]*?)<\/p>/)![1].replace(/<[^>]+>|\s+/g, ' ');
		if (data.result.viaUnrefined.length > 0) {
			expect(note).toContain('Unrefined reactions replace the');
			expect(note).not.toContain('Full chain uses them');
		} else expect(note).toContain('No unrefined reaction raises');
		expect(count(body, 'data-step=')).toBe(data.result.chainDepth);
	});

	it('renders the slot toggle and, with optimal slots, the allocation before steps sized per slot', async () => {
		const single = await ssr('/composite/titanium-carbide?view=chain');
		const toggle = (body: string) => body.match(/data-slot-toggle[\s\S]*?<\/nav>/)![0];
		const canonical =
			'<link rel="canonical" href="https://reactions.coalition.space/composite/titanium-carbide"';
		const singleToggle = toggle(single.body);
		expect(singleToggle).toContain('href="/composite/titanium-carbide?view=chain&amp;slots=optimal"');
		expect(singleToggle).toMatch(/aria-current="page"[^>]*>Single slot</);
		expect(single.body).not.toContain('data-allocation');
		expect(single.head).toContain(canonical);

		const { data, body, head } = await ssr('/composite/titanium-carbide?view=chain&slots=optimal');
		const optimalToggle = toggle(body);
		expect(optimalToggle).toContain('href="/composite/titanium-carbide?view=chain"');
		expect(optimalToggle).toMatch(/aria-current="page"[^>]*>Optimal slots</);
		expect(head).toContain(canonical);
		expect(body.indexOf('data-allocation')).toBeGreaterThan(body.indexOf('Material flow'));
		expect(body.indexOf('data-allocation')).toBeLessThan(body.indexOf('id="steps-title"'));
		expect(after(body, 'data-allocation-reaction="46204"[^>]*>[\\s\\S]*?data-field="slots"')).toEqual(['2']);
		expect(count(body, 'data-phase=')).toBe(2);
		expect(after(body, 'data-field="slots"').slice(-3)).toEqual(['1', '1', '2']);
		expect(body).toContain('name="slots" value="optimal"');

		// Start-up: cycle 1 runs the intermediates and buys their inputs; cycle 2 onward are the steps.
		expect(count(body, 'data-startup-phase=')).toBe(1);
		const startup = body.slice(body.indexOf('data-startup-phase="1"'), body.indexOf('id="steps-title"'));
		expect(startup).toContain('Cycle 1, start-up');
		expect(startup).toContain('aria-label="Buy for cycle 1"');
		const firstCycle = Object.fromEntries(
			startup
				.match(/<textarea[^>]*>([^<]*)<\/textarea>/)![1]
				.split('\n')
				.map((l) => l.split('\t'))
		);
		expect(firstCycle['Titanium']).toBeDefined();
		expect(body).not.toContain('data-startup-choice');

		const steps = body.slice(body.indexOf('id="steps-title"'));
		expect(steps).toContain('Every cycle from cycle 2');
		const multibuy = steps.match(/<textarea[^>]*>([^<]*)<\/textarea>/)![1];
		const quantities = Object.fromEntries(multibuy.split('\n').map((l) => l.split('\t')));
		for (const input of data.result.inputs)
			expect(Number(quantities[input.name])).toBe(Math.ceil(input.quantity));

		const buyInputs = await ssr('/composite/titanium-carbide');
		expect(buyInputs.body).not.toContain('data-slot-toggle');
	});

	it('offers a no-JS Lines selector (Auto shows the picked count) with optimal slots only', async () => {
		const form = (body: string) => body.match(/<form[^>]*data-lines-form[\s\S]*?<\/form>/)?.[0];
		expect(form((await ssr('/composite/titanium-carbide?view=chain')).body)).toBeUndefined();

		const auto = form((await ssr('/composite/titanium-carbide?view=chain&slots=optimal')).body)!;
		expect(auto).toMatch(/method="GET"/);
		expect(auto).toContain('action="/composite/titanium-carbide"');
		expect(auto).toContain('name="view" value="chain"');
		expect(auto).toContain('name="slots" value="optimal"');
		expect(auto.replace(/\s+/g, ' ')).toMatch(/<option value=""[^>]*selected[^>]*>Auto \(2 lines\)/);
		expect(auto.match(/<option /g)).toHaveLength(11);

		const { body, data } = await ssr('/composite/titanium-carbide?view=chain&slots=optimal&lines=3');
		expect(form(body)).toMatch(/<option value="3"[^>]*selected/);
		expect(data.result.allocation!.lines).toBe(3);
		expect(body).toContain('name="lines" value="3"');
		expect(body).toContain('href="/composite/titanium-carbide?view=chain"');
	});
});
